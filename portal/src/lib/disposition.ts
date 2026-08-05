/**
 * Call dispositions — the state machine for campaign members.
 *
 * Pure logic: what an agent action does to the member, which events it logs,
 * and what it patches on the lead. The API route applies the result in a
 * deliberate order — lead patch first, member second, events last — so a
 * mid-write failure leaves the COMPLIANT state (a suppression recorded, an
 * attempt possibly uncounted), never the reverse.
 */

import type { EventType } from './lead-scoring';

export type MemberStatus =
  | 'queued'
  | 'assigned'
  | 'contacted'
  | 'callback'
  | 'interested'
  | 'converted'
  | 'opted_out'
  | 'exhausted';

export type DispositionAction =
  | 'no_answer'
  | 'connected_not_interested'
  | 'callback'
  | 'interested'
  | 'converted'
  | 'opt_out'
  | 'link_sent_whatsapp'
  | 'link_sent_sms';

export const TERMINAL_STATUSES: readonly MemberStatus[] = [
  'converted',
  'opted_out',
  'exhausted',
];

/** Which statuses an action may be applied from. */
const ACTIONABLE_FROM: readonly MemberStatus[] = ['queued', 'assigned', 'callback', 'contacted', 'interested'];

interface DispositionSpec {
  /** Events logged, in order. Points come from EVENT_POINTS server-side. */
  events: EventType[];
  /** null = status unchanged (link sends don't move the member). */
  nextStatus: MemberStatus | null;
  /** Counts against the campaign attempt cap. */
  touchesAttempt: boolean;
  /** Requires a future callbackAt timestamp. */
  requiresCallbackAt?: boolean;
  /** POPIA s69: electronic sends require the customer's recorded request. */
  requiresCustomerRequest?: boolean;
  /** Adds a channel to leads.channel_consent. */
  grantsChannel?: 'whatsapp' | 'sms';
  /** Sets the do-not-contact suppression on the lead. */
  suppressesLead?: boolean;
}

export const DISPOSITIONS: Record<DispositionAction, DispositionSpec> = {
  no_answer: {
    events: ['call_attempted', 'call_no_answer'],
    nextStatus: null, // stays workable until the attempt cap exhausts it
    touchesAttempt: true,
  },
  connected_not_interested: {
    // "Not interested" is a choice to stop calling, not an opt-out: the lead
    // is not suppressed, but this campaign stops trying.
    events: ['call_attempted', 'call_connected'],
    nextStatus: 'exhausted',
    touchesAttempt: true,
  },
  callback: {
    events: ['call_attempted', 'call_connected', 'callback_scheduled'],
    nextStatus: 'callback',
    touchesAttempt: true,
    requiresCallbackAt: true,
  },
  interested: {
    // Hand-off to a licensed advisor; leaves the calling queue.
    events: ['call_attempted', 'call_connected'],
    nextStatus: 'interested',
    touchesAttempt: true,
  },
  converted: {
    // Conversion for this funnel = a booked discovery call (call_booked, 60).
    events: ['call_attempted', 'call_connected', 'call_booked'],
    nextStatus: 'converted',
    touchesAttempt: true,
  },
  opt_out: {
    events: ['call_attempted', 'call_connected', 'opted_out'],
    nextStatus: 'opted_out',
    touchesAttempt: true,
    suppressesLead: true,
  },
  link_sent_whatsapp: {
    events: ['whatsapp_link_sent'],
    nextStatus: null,
    touchesAttempt: false,
    requiresCustomerRequest: true,
    grantsChannel: 'whatsapp',
  },
  link_sent_sms: {
    events: ['sms_link_sent'],
    nextStatus: null,
    touchesAttempt: false,
    requiresCustomerRequest: true,
    grantsChannel: 'sms',
  },
};

export interface DispositionContext {
  /** Required for the callback action. */
  callbackAt?: Date | string | null;
  /** The customer asked for the link on this call (s69 gate for link sends). */
  customerRequested?: boolean;
  /** Free-text reason, stored with opt-outs. */
  reason?: string;
}

/**
 * Only the fields the action changes are present — an absent key must not be
 * written, or a link send would null out last_attempt_at and defeat the
 * cooldown. The route spreads this object into the UPDATE as-is.
 */
export interface MemberPatch {
  status?: MemberStatus;
  attempts?: number;
  last_attempt_at?: string;
  callback_at?: string | null;
}

export interface LeadPatch {
  do_not_contact?: boolean;
  do_not_contact_reason?: string;
  do_not_contact_at?: string;
  /** Channel to append to channel_consent (route merges, never replaces). */
  add_channel?: 'whatsapp' | 'sms';
}

export type DispositionResult =
  | { ok: true; member: MemberPatch; events: EventType[]; leadPatch?: LeadPatch }
  | { ok: false; error: string };

export function applyDisposition(
  member: { status: MemberStatus; attempts: number; callback_at?: string | null },
  campaign: { maxAttempts: number },
  action: DispositionAction,
  ctx: DispositionContext = {},
  now: Date = new Date(),
): DispositionResult {
  const spec = DISPOSITIONS[action];
  if (!spec) return { ok: false, error: `Unknown disposition: ${action}` };

  if (TERMINAL_STATUSES.includes(member.status)) {
    return { ok: false, error: `Member is ${member.status}; no further dispositions allowed` };
  }
  if (!ACTIONABLE_FROM.includes(member.status)) {
    return { ok: false, error: `Cannot apply ${action} from status ${member.status}` };
  }

  if (spec.requiresCallbackAt) {
    const when =
      ctx.callbackAt instanceof Date
        ? ctx.callbackAt
        : ctx.callbackAt
          ? new Date(ctx.callbackAt)
          : null;
    if (!when || Number.isNaN(when.getTime())) {
      return { ok: false, error: 'A callback needs a date and time' };
    }
    if (when.getTime() <= now.getTime()) {
      return { ok: false, error: 'The callback time must be in the future' };
    }
  }

  if (spec.requiresCustomerRequest && ctx.customerRequested !== true) {
    return {
      ok: false,
      error: 'Links may only be sent when the customer asked for one on this call',
    };
  }

  const attempts = spec.touchesAttempt ? member.attempts + 1 : member.attempts;

  // Attempt cap: a non-terminal outcome that lands on the cap exhausts the
  // member. Terminal outcomes keep their own status.
  let status: MemberStatus = spec.nextStatus ?? member.status;
  if (
    spec.touchesAttempt &&
    attempts >= campaign.maxAttempts &&
    !TERMINAL_STATUSES.includes(status) &&
    status !== 'interested'
  ) {
    status = 'exhausted';
  }

  const patch: MemberPatch = {};
  if (status !== member.status) patch.status = status;
  if (spec.touchesAttempt) {
    patch.attempts = attempts;
    patch.last_attempt_at = now.toISOString();
  }
  if (action === 'callback') {
    patch.callback_at = new Date(ctx.callbackAt as Date | string).toISOString();
  } else if (member.status === 'callback' && status !== 'callback') {
    // Leaving callback state: clear the stale due time.
    patch.callback_at = null;
  }

  let leadPatch: LeadPatch | undefined;
  if (spec.suppressesLead) {
    leadPatch = {
      do_not_contact: true,
      do_not_contact_reason: ctx.reason?.trim() || 'Asked not to be contacted (call centre)',
      do_not_contact_at: now.toISOString(),
    };
  }
  if (spec.grantsChannel) {
    leadPatch = { ...(leadPatch ?? {}), add_channel: spec.grantsChannel };
  }

  return { ok: true, member: patch, events: spec.events, leadPatch };
}
