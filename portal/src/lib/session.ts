/**
 * Anonymous session id — browser only.
 *
 * Lets us attribute pre-capture events (quiz completed before the visitor
 * gives us their email) to a lead once they identify themselves. It is a
 * random opaque id: no personal information, nothing derived from the device.
 */

const SESSION_KEY = 'pfl.sessionId';
const RESULT_KEY = 'pfl.quizResult';
const LEAD_KEY = 'pfl.leadId';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh = randomId();
    window.localStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    // Private browsing with storage disabled — fall back to a per-page id.
    return randomId();
  }
}

/* -------------------------------------------------------------------------- */
/* Quiz result handoff between /quiz and /report                              */
/*                                                                            */
/* The visitor's own answers, held in their own browser. The email gate on the */
/* full report is a conversion mechanism, not a security boundary — treat it   */
/* as such and never put anything here that isn't already theirs.              */
/* -------------------------------------------------------------------------- */

export interface StoredQuizResult {
  score: number;
  band: string;
  bandLabel: string;
  bandSummary: string;
  breakdown: Array<{
    dimension: string;
    label: string;
    points: number;
    max: number;
    ratio: number;
  }>;
  tags: string[];
  insights: string[];
  disclaimer: string;
  answers: Record<string, string>;
  completedAt: string;
  fullName?: string;
}

export function storeQuizResult(result: StoredQuizResult): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(RESULT_KEY, JSON.stringify(result));
  } catch {
    /* storage unavailable — the report page shows a re-take prompt */
  }
}

export function readQuizResult(): StoredQuizResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(RESULT_KEY);
    return raw ? (JSON.parse(raw) as StoredQuizResult) : null;
  } catch {
    return null;
  }
}

/** Clears a stored result so the visitor can start a genuinely fresh quiz. */
export function clearQuizResult(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(RESULT_KEY);
    window.sessionStorage.removeItem(LEAD_KEY);
  } catch {
    /* ignore */
  }
}

export function storeLeadId(leadId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(LEAD_KEY, leadId);
  } catch {
    /* ignore */
  }
}

export function readLeadId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(LEAD_KEY);
  } catch {
    return null;
  }
}

/** Fire-and-forget interaction tracking. Never blocks the UI. */
export function track(
  eventType: string,
  metadata: Record<string, unknown> = {},
  leadId?: string,
): void {
  if (typeof window === 'undefined') return;
  const body = JSON.stringify({ eventType, sessionId: getSessionId(), leadId, metadata });
  void fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    /* tracking must never surface an error to the visitor */
  });
}
