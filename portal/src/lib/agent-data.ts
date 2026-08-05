/**
 * Data access for the agent workspace.
 *
 * Every function takes the caller's RLS-constrained client (from
 * supabase-server.ts) — nothing here touches the service role, so a bug in a
 * page or route cannot read or write more than 0005's policies allow. The
 * service-role batch writer for imports lives in import-executor.ts.
 *
 * Return style is the discriminated union the API routes standardise on:
 * `{ ok: true, … } | { ok: false, error }` — callers must look before they
 * leap and nothing throws across this boundary.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { applyDisposition, type DispositionAction, type MemberStatus } from './disposition';
import { EVENT_POINTS, type EventType } from './lead-scoring';
import type { PriorityReason } from './campaign-priority';

/* -------------------------------------------------------------------------- */
/* Queue                                                                       */
/* -------------------------------------------------------------------------- */

/** One row of the campaign_queue view (0004) — already compliance-filtered. */
export interface QueueMember {
  member_id: string;
  campaign_id: string;
  campaign_slug: string;
  status: MemberStatus;
  priority_score: number;
  priority_reasons: PriorityReason[];
  attempts: number;
  last_attempt_at: string | null;
  callback_at: string | null;
  assigned_to: string | null;
  callback_due: boolean;
  lead_id: string;
  full_name: string;
  phone: string | null;
  age_band: string | null;
  tags: string[];
  channel_consent: string[];
  engagement_score: number;
  last_event_at: string | null;
}

export type QueueResult = { ok: true; members: QueueMember[] } | { ok: false; error: string };

/**
 * The workable queue: callbacks that are due first, then priority, then the
 * least-recently-tried. The view has already excluded DNC, capped, cooling-off
 * and not-yet-due members — ordering is the only decision made here.
 */
export async function fetchQueue(
  client: SupabaseClient,
  opts: { campaignSlug?: string; limit?: number } = {},
): Promise<QueueResult> {
  let query = client
    .from('campaign_queue')
    .select('*')
    .order('callback_due', { ascending: false })
    .order('priority_score', { ascending: false })
    .order('last_attempt_at', { ascending: true, nullsFirst: true })
    .limit(opts.limit ?? 25);

  if (opts.campaignSlug) query = query.eq('campaign_slug', opts.campaignSlug);

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, members: (data ?? []) as QueueMember[] };
}

export async function fetchNextQueueMember(
  client: SupabaseClient,
  campaignSlug?: string,
): Promise<{ ok: true; member: QueueMember | null } | { ok: false; error: string }> {
  const result = await fetchQueue(client, { campaignSlug, limit: 1 });
  if (!result.ok) return result;
  return { ok: true, member: result.members[0] ?? null };
}

/* -------------------------------------------------------------------------- */
/* Lead detail                                                                 */
/* -------------------------------------------------------------------------- */

export interface LeadDetail {
  lead: {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    status: string;
    source: string;
    consent_basis: string;
    consent_marketing: boolean;
    channel_consent: string[];
    do_not_contact: boolean;
    do_not_contact_reason: string | null;
    do_not_contact_at: string | null;
    age_band: string | null;
    tags: string[];
    advisor_notes: string | null;
    created_at: string;
  };
  policies: Array<{
    id: string;
    product_type: string;
    policy_number: string;
    premium_cents: number | null;
    start_date: string | null;
    status: string;
  }>;
  events: Array<{
    id: string;
    event_type: string;
    points: number;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
  memberships: Array<{
    id: string;
    status: MemberStatus;
    priority_score: number;
    priority_reasons: PriorityReason[];
    attempts: number;
    callback_at: string | null;
    campaign: { slug: string; name: string };
  }>;
}

export async function fetchLeadDetail(
  client: SupabaseClient,
  leadId: string,
): Promise<{ ok: true; detail: LeadDetail } | { ok: false; error: string }> {
  const { data: lead, error: leadError } = await client
    .from('leads')
    .select(
      'id, full_name, email, phone, status, source, consent_basis, consent_marketing, channel_consent, do_not_contact, do_not_contact_reason, do_not_contact_at, age_band, tags, advisor_notes, created_at',
    )
    .eq('id', leadId)
    .maybeSingle();

  if (leadError) return { ok: false, error: leadError.message };
  if (!lead) return { ok: false, error: 'Lead not found' };

  const [policies, events, memberships] = await Promise.all([
    client
      .from('policies')
      .select('id, product_type, policy_number, premium_cents, start_date, status')
      .eq('lead_id', leadId)
      .order('start_date', { ascending: true }),
    client
      .from('events')
      .select('id, event_type, points, metadata, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(50),
    client
      .from('campaign_members')
      .select(
        'id, status, priority_score, priority_reasons, attempts, callback_at, campaign:campaigns (slug, name)',
      )
      .eq('lead_id', leadId),
  ]);

  const firstError = policies.error || events.error || memberships.error;
  if (firstError) return { ok: false, error: firstError.message };

  return {
    ok: true,
    detail: {
      lead: lead as LeadDetail['lead'],
      policies: (policies.data ?? []) as LeadDetail['policies'],
      events: (events.data ?? []) as LeadDetail['events'],
      memberships: (memberships.data ?? []).map((m) => {
        const raw = m as unknown as Omit<LeadDetail['memberships'][number], 'campaign'> & {
          campaign: { slug: string; name: string } | Array<{ slug: string; name: string }>;
        };
        return {
          ...raw,
          campaign: Array.isArray(raw.campaign) ? raw.campaign[0] : raw.campaign,
        };
      }),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Campaign stats                                                              */
/* -------------------------------------------------------------------------- */

export interface CampaignStats {
  campaign_id: string;
  slug: string;
  name: string;
  campaign_status: string;
  members: number;
  queued: number;
  callback: number;
  contacted: number;
  interested: number;
  converted: number;
  opted_out: number;
  exhausted: number;
  total_attempts: number | null;
}

export async function fetchCampaignStats(
  client: SupabaseClient,
): Promise<{ ok: true; stats: CampaignStats[] } | { ok: false; error: string }> {
  const { data, error } = await client.from('campaign_stats').select('*').order('slug');
  if (error) return { ok: false, error: error.message };
  return { ok: true, stats: (data ?? []) as CampaignStats[] };
}

/* -------------------------------------------------------------------------- */
/* Disposition — the one write path agents have                                */
/* -------------------------------------------------------------------------- */

export interface DispositionInput {
  memberId: string;
  action: DispositionAction;
  callbackAt?: string;
  customerRequested?: boolean;
  reason?: string;
  /** The signed-in agent (stamped onto the member and the event trail). */
  agentUserId: string;
}

export type DispositionOutcome =
  | { ok: true; memberStatus: MemberStatus; attempts: number }
  | { ok: false; error: string; status: number };

/**
 * Validates and applies one disposition. Write order is deliberate and
 * load-bearing: lead patch FIRST (suppression / channel grant), member
 * second, events last — if a later write fails, the state we are left with
 * is the compliant one (a recorded opt-out with an uncounted attempt), never
 * the reverse. True atomicity needs an RPC; noted for sprint 2.
 */
export async function recordDisposition(
  client: SupabaseClient,
  input: DispositionInput,
): Promise<DispositionOutcome> {
  // 1 · Load the member with its campaign policy and the lead's consent state.
  const { data: member, error: memberError } = await client
    .from('campaign_members')
    .select(
      'id, status, attempts, callback_at, lead_id, campaign:campaigns (id, slug, status, max_attempts)',
    )
    .eq('id', input.memberId)
    .maybeSingle();

  if (memberError) return { ok: false, error: memberError.message, status: 500 };
  if (!member) return { ok: false, error: 'Queue member not found', status: 404 };

  const campaignRaw = (member as { campaign: unknown }).campaign;
  const campaign = (Array.isArray(campaignRaw) ? campaignRaw[0] : campaignRaw) as {
    id: string;
    slug: string;
    status: string;
    max_attempts: number;
  } | null;
  if (!campaign) return { ok: false, error: 'Campaign not found for member', status: 500 };

  const { data: lead, error: leadError } = await client
    .from('leads')
    .select('id, do_not_contact, channel_consent')
    .eq('id', member.lead_id as string)
    .maybeSingle();

  if (leadError) return { ok: false, error: leadError.message, status: 500 };
  if (!lead) return { ok: false, error: 'Lead not found for member', status: 500 };

  if (lead.do_not_contact && input.action !== 'opt_out') {
    return {
      ok: false,
      error: 'This customer is marked do-not-contact. No further actions are allowed.',
      status: 409,
    };
  }

  // 2 · Run the state machine.
  const result = applyDisposition(
    {
      status: member.status as MemberStatus,
      attempts: member.attempts as number,
      callback_at: member.callback_at as string | null,
    },
    { maxAttempts: campaign.max_attempts },
    input.action,
    {
      callbackAt: input.callbackAt,
      customerRequested: input.customerRequested,
      reason: input.reason,
    },
  );

  if (!result.ok) return { ok: false, error: result.error, status: 400 };

  // 3 · Lead patch first: suppression and channel grants are the compliance
  //     record and must survive any later failure.
  if (result.leadPatch) {
    const { add_channel, ...suppression } = result.leadPatch;
    const patch: Record<string, unknown> = { ...suppression };

    if (add_channel) {
      const channels = new Set([...(lead.channel_consent as string[]), add_channel]);
      patch.channel_consent = Array.from(channels);
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await client.from('leads').update(patch).eq('id', lead.id as string);
      if (error) return { ok: false, error: `Suppression write failed: ${error.message}`, status: 500 };
    }
  }

  // 4 · Member second. assigned_to records the last agent who worked it.
  const memberPatch = { ...result.member, assigned_to: input.agentUserId };
  const { error: updateError } = await client
    .from('campaign_members')
    .update(memberPatch)
    .eq('id', input.memberId);
  if (updateError) {
    return { ok: false, error: `Member update failed: ${updateError.message}`, status: 500 };
  }

  // 5 · Events last — the audit/scoring trail. session_id groups an agent's
  //     recorded events the way a browser session groups a visitor's.
  const eventRows = result.events.map((eventType: EventType) => ({
    lead_id: lead.id as string,
    session_id: `agent:${input.agentUserId}`,
    event_type: eventType,
    points: EVENT_POINTS[eventType] ?? 0,
    metadata: {
      campaign: campaign.slug,
      member_id: input.memberId,
      action: input.action,
      ...(input.reason && input.action === 'opt_out' ? { reason: input.reason } : {}),
    },
  }));

  const { error: eventsError } = await client.from('events').insert(eventRows);
  if (eventsError) {
    // The member moved and any suppression is recorded; only history is short.
    console.error('[disposition] event insert failed', eventsError.message);
  }

  return {
    ok: true,
    memberStatus: (memberPatch.status ?? (member.status as MemberStatus)) as MemberStatus,
    attempts: (memberPatch.attempts ?? member.attempts) as number,
  };
}
