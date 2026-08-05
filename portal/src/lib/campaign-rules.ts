/**
 * Outbound contact rules — how often the call centre may try someone.
 *
 * Pure logic. The campaign_queue view in 0004 mirrors these clauses in SQL
 * (the same pairing convention as lead-scoring.ts <-> lead_scores): the view
 * is what agents actually read, this module is the documented, tested source
 * of truth, and the disposition route uses it to explain WHY a member is not
 * callable rather than silently hiding them.
 */

export const ATTEMPT_POLICY = {
  /** Hard cap per campaign. Mirrored by campaigns.max_attempts. */
  maxAttempts: 3,
  /** The cap reads as "3 attempts in any 14 days" given the cooldown below. */
  windowDays: 14,
  /** Minimum days between attempts. Mirrored by campaigns.retry_cooldown_days. */
  retryCooldownDays: 4,
} as const;

export type WorkableStatus = 'queued' | 'assigned' | 'callback';

export interface CallableMember {
  status: string;
  attempts: number;
  lastAttemptAt: string | Date | null;
  callbackAt: string | Date | null;
}

export interface CallableCampaign {
  maxAttempts: number;
  retryCooldownDays: number;
}

export interface CallableVerdict {
  callable: boolean;
  reason?:
    | 'terminal_status'
    | 'callback_not_due'
    | 'attempt_cap_reached'
    | 'cooldown_active';
}

function toDate(value: string | Date | null): Date | null {
  if (value === null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isCallable(
  member: CallableMember,
  campaign: CallableCampaign,
  now: Date = new Date(),
): CallableVerdict {
  if (!['queued', 'assigned', 'callback'].includes(member.status)) {
    return { callable: false, reason: 'terminal_status' };
  }

  if (member.status === 'callback') {
    const due = toDate(member.callbackAt);
    if (!due || due.getTime() > now.getTime()) {
      return { callable: false, reason: 'callback_not_due' };
    }
  }

  if (member.attempts >= campaign.maxAttempts) {
    return { callable: false, reason: 'attempt_cap_reached' };
  }

  const last = toDate(member.lastAttemptAt);
  if (last) {
    const cooldownMs = campaign.retryCooldownDays * 24 * 60 * 60 * 1000;
    if (now.getTime() - last.getTime() < cooldownMs) {
      return { callable: false, reason: 'cooldown_active' };
    }
  }

  return { callable: true };
}
