/**
 * Executes an ImportPlan against Supabase — the ONLY service-role batch
 * writer in the codebase. Everything the plan decides (create/merge/link/
 * skip) was decided by pure, tested code in book-import.ts; this file just
 * carries it out and reports honestly, row by row, what happened.
 *
 * Import stamps (create only — merge/link never touch these):
 *   source           'funeral_book'
 *   status           'client'            (existing policyholder, not a web lead)
 *   consent_basis    'existing_customer' (POPIA: own-book direct marketing)
 *   channel_consent  {phone}             (s69: electronic channels start OFF)
 *   consent_privacy_at NULL              (they never saw the web notice)
 *
 * Priority is computed and stamped at enrolment (campaign-priority.ts); a
 * member already enrolled keeps their original stamp — the same
 * write-time-stamping rule events.points follows.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ImportPlan, PlannedAction, RowResult } from './book-import';
import { computePriority, type AgeBand } from './campaign-priority';
import type { ScoredEvent } from './lead-scoring';

const CHUNK = 200;

type OkRow = Extract<RowResult, { ok: true }>;
type CreateAction = Extract<PlannedAction, { action: 'create' }>;

export interface ImportFailure {
  rowNumber: number;
  stage: 'lead' | 'policy' | 'enrolment';
  message: string;
}

export interface ExecutionReport {
  leadsCreated: number;
  leadsMerged: number;
  leadsLinked: number;
  policiesUpserted: number;
  membersEnrolled: number;
  failures: ImportFailure[];
}

export interface CampaignRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  max_attempts: number;
}

export async function fetchCampaignBySlug(
  service: SupabaseClient,
  slug: string,
): Promise<{ ok: true; campaign: CampaignRow } | { ok: false; error: string }> {
  const { data, error } = await service
    .from('campaigns')
    .select('id, slug, name, status, max_attempts')
    .eq('slug', slug)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: `No campaign with slug "${slug}"` };
  return { ok: true, campaign: data as CampaignRow };
}

/** Existing leads keyed by phone + existing policy keys, for planImport. */
export async function fetchExistingForImport(
  service: SupabaseClient,
  phones: string[],
  policyNumbers: string[],
): Promise<
  | {
      ok: true;
      leadsByPhone: Map<string, { id: string; source: string }>;
      policyKeys: Set<string>;
    }
  | { ok: false; error: string }
> {
  const leadsByPhone = new Map<string, { id: string; source: string }>();
  const policyKeys = new Set<string>();

  for (let i = 0; i < phones.length; i += CHUNK) {
    const { data, error } = await service
      .from('leads')
      .select('id, phone, source')
      .in('phone', phones.slice(i, i + CHUNK));
    if (error) return { ok: false, error: error.message };
    for (const row of data ?? []) {
      if (row.phone) {
        leadsByPhone.set(row.phone as string, {
          id: row.id as string,
          source: row.source as string,
        });
      }
    }
  }

  for (let i = 0; i < policyNumbers.length; i += CHUNK) {
    const { data, error } = await service
      .from('policies')
      .select('policy_number, product_type')
      .in('policy_number', policyNumbers.slice(i, i + CHUNK));
    if (error) return { ok: false, error: error.message };
    for (const row of data ?? []) {
      policyKeys.add(`${row.policy_number}::${row.product_type}`);
    }
  }

  return { ok: true, leadsByPhone, policyKeys };
}

function leadInsertRow(row: OkRow) {
  return {
    full_name: row.lead.fullName,
    phone: row.lead.phoneE164,
    email: row.lead.email,
    source: 'funeral_book',
    status: 'client',
    consent_basis: 'existing_customer',
    consent_marketing: false,
    channel_consent: ['phone'],
    age_band: row.lead.ageBand,
    tags: ['funeral_book'],
    attribution: { source: 'funeral_book' },
  };
}

export async function executeImportPlan(
  service: SupabaseClient,
  plan: ImportPlan,
  campaign: CampaignRow,
  asOf: Date = new Date(),
): Promise<ExecutionReport> {
  const report: ExecutionReport = {
    leadsCreated: 0,
    leadsMerged: 0,
    leadsLinked: 0,
    policiesUpserted: 0,
    membersEnrolled: 0,
    failures: [],
  };

  // Every action that survives lead-writing lands here with its lead id, and
  // flows on to the policy upsert and enrolment stages.
  const settled: Array<{ row: OkRow; leadId: string; preexisting: boolean }> = [];

  /* ---- 1 · Leads --------------------------------------------------------- */

  const creates = plan.actions.filter((a): a is CreateAction => a.action === 'create');

  for (let i = 0; i < creates.length; i += CHUNK) {
    const chunk = creates.slice(i, i + CHUNK);
    const { data, error } = await service
      .from('leads')
      .insert(chunk.map((a) => leadInsertRow(a.row)))
      .select('id, phone');

    if (!error && data) {
      const byPhone = new Map(data.map((d) => [d.phone as string, d.id as string]));
      for (const action of chunk) {
        const leadId = byPhone.get(action.row.lead.phoneE164);
        if (leadId) {
          settled.push({ row: action.row, leadId, preexisting: false });
          report.leadsCreated += 1;
        } else {
          report.failures.push({
            rowNumber: action.row.rowNumber,
            stage: 'lead',
            message: 'Insert returned no row',
          });
        }
      }
      continue;
    }

    // Chunk failed (typically one bad row — a duplicate email from the web
    // funnel). Retry row by row so one bad record costs one record.
    for (const action of chunk) {
      const { data: one, error: oneError } = await service
        .from('leads')
        .insert(leadInsertRow(action.row))
        .select('id')
        .single();

      if (oneError || !one) {
        report.failures.push({
          rowNumber: action.row.rowNumber,
          stage: 'lead',
          message: oneError?.message ?? 'Insert returned no row',
        });
      } else {
        settled.push({ row: action.row, leadId: one.id as string, preexisting: false });
        report.leadsCreated += 1;
      }
    }
  }

  for (const action of plan.actions) {
    if (action.action === 'merge') {
      // Book re-run: refresh what the book knows better than we do. Consent
      // columns, DNC and attribution are deliberately untouched.
      const patch: Record<string, unknown> = { full_name: action.row.lead.fullName };
      if (action.row.lead.ageBand) patch.age_band = action.row.lead.ageBand;

      const { error } = await service.from('leads').update(patch).eq('id', action.leadId);
      if (error) {
        report.failures.push({
          rowNumber: action.row.rowNumber,
          stage: 'lead',
          message: error.message,
        });
      } else {
        settled.push({ row: action.row, leadId: action.leadId, preexisting: true });
        report.leadsMerged += 1;
      }
    } else if (action.action === 'link') {
      // A web lead who is also a policyholder: attach the policy and enrol,
      // but never overwrite their web identity, consent or attribution.
      settled.push({ row: action.row, leadId: action.leadId, preexisting: true });
      report.leadsLinked += 1;
    }
  }

  /* ---- 2 · Policies ------------------------------------------------------ */

  for (let i = 0; i < settled.length; i += CHUNK) {
    const chunk = settled.slice(i, i + CHUNK);
    const { error } = await service.from('policies').upsert(
      chunk.map((s) => ({
        lead_id: s.leadId,
        product_type: 'funeral',
        policy_number: s.row.policy.policyNumber,
        premium_cents: s.row.policy.premiumCents,
        start_date: s.row.policy.startDate,
        status: 'active',
      })),
      { onConflict: 'policy_number,product_type' },
    );

    if (error) {
      for (const s of chunk) {
        report.failures.push({
          rowNumber: s.row.rowNumber,
          stage: 'policy',
          message: error.message,
        });
      }
    } else {
      report.policiesUpserted += chunk.length;
    }
  }

  /* ---- 3 · Engagement lookup (pre-existing leads may have quiz history) --- */

  const engagementByLead = new Map<string, ScoredEvent[]>();
  const preexistingIds = settled.filter((s) => s.preexisting).map((s) => s.leadId);

  for (let i = 0; i < preexistingIds.length; i += CHUNK) {
    const { data, error } = await service
      .from('events')
      .select('lead_id, event_type, created_at')
      .in('lead_id', preexistingIds.slice(i, i + CHUNK))
      .in('event_type', ['quiz_completed', 'quiz_assisted']);

    if (error) {
      // Engagement only boosts priority; a failed lookup must not sink the run.
      console.error('[import] engagement lookup failed', error.message);
      break;
    }
    for (const row of data ?? []) {
      const list = engagementByLead.get(row.lead_id as string) ?? [];
      list.push({
        eventType: row.event_type as ScoredEvent['eventType'],
        createdAt: row.created_at as string,
      });
      engagementByLead.set(row.lead_id as string, list);
    }
  }

  /* ---- 4 · Enrolment with priority stamped at write ----------------------- */

  for (let i = 0; i < settled.length; i += CHUNK) {
    const chunk = settled.slice(i, i + CHUNK);
    const rows = chunk.map((s) => {
      const priority = computePriority(
        {
          ageBand: (s.row.lead.ageBand ?? null) as AgeBand | null,
          premiumCents: s.row.policy.premiumCents,
          startDate: s.row.policy.startDate,
          events: engagementByLead.get(s.leadId),
        },
        asOf,
      );
      return {
        campaign_id: campaign.id,
        lead_id: s.leadId,
        priority_score: priority.score,
        priority_reasons: priority.reasons,
        status: 'queued',
      };
    });

    // ignoreDuplicates: an already-enrolled member keeps their stamp and
    // their call history — a re-run must never reset attempts or status.
    const { error, data } = await service
      .from('campaign_members')
      .upsert(rows, { onConflict: 'campaign_id,lead_id', ignoreDuplicates: true })
      .select('id');

    if (error) {
      for (const s of chunk) {
        report.failures.push({
          rowNumber: s.row.rowNumber,
          stage: 'enrolment',
          message: error.message,
        });
      }
    } else {
      report.membersEnrolled += (data ?? []).length;
    }
  }

  return report;
}
