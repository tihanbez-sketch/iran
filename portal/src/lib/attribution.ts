/**
 * Channel attribution — first-touch capture.
 *
 * Answers the question "which channel produced this lead?". On arrival we read
 * utm_* parameters (and a short `ref` code for offline QR/poster links) from
 * the URL and keep the first meaningful touch in localStorage. That record
 * rides along with quiz completion and lead capture, so channel → lead and
 * channel → score-quality analysis works from day one.
 *
 * First touch wins, with one exception: an organic first visit (no campaign
 * data) is upgraded if a later visit arrives with campaign parameters —
 * otherwise a WhatsApp click after a direct visit would report as "direct".
 *
 * No personal information is stored here: channel labels, a referrer
 * hostname, a landing path and a timestamp.
 */

const ATTR_KEY = 'pfl.attribution';
const MAX_VALUE_LENGTH = 150;

export interface Attribution {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  /** Short code for offline placements, e.g. ?ref=staffroom-poster */
  ref?: string;
  /** Referrer hostname only, and only when it is another site. */
  referrer?: string;
  /** Path the visitor landed on. */
  landing?: string;
  firstSeenAt?: string;
}

const PARAM_MAP: Record<string, keyof Attribution> = {
  utm_source: 'source',
  utm_medium: 'medium',
  utm_campaign: 'campaign',
  utm_content: 'content',
  utm_term: 'term',
  ref: 'ref',
};

function clean(value: string): string {
  // Control characters out, length capped. These strings end up in jsonb and
  // in advisor-facing views, never in HTML, but tidy in is tidy out.
  return value
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_VALUE_LENGTH);
}

/** Pure: URL search string -> campaign fields. Unknown parameters are ignored. */
export function parseAttributionParams(search: string): Partial<Attribution> {
  const out: Partial<Attribution> = {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return out;
  }

  for (const [param, field] of Object.entries(PARAM_MAP)) {
    const raw = params.get(param);
    if (raw === null) continue;
    const value = clean(raw);
    if (value.length > 0) out[field] = value;
  }
  return out;
}

/** True when the record identifies a channel rather than an organic visit. */
export function hasCampaignData(a: Partial<Attribution> | null | undefined): boolean {
  return Boolean(a && (a.source || a.medium || a.campaign || a.ref));
}

export function readAttribution(): Attribution | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ATTR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Attribution = {};
    for (const key of [
      'source',
      'medium',
      'campaign',
      'content',
      'term',
      'ref',
      'referrer',
      'landing',
      'firstSeenAt',
    ] as const) {
      const value = parsed[key];
      if (typeof value === 'string' && value.length > 0) out[key] = clean(value);
    }
    return out;
  } catch {
    return null;
  }
}

function externalReferrerHost(): string | undefined {
  try {
    if (!document.referrer) return undefined;
    const host = new URL(document.referrer).hostname;
    return host && host !== window.location.hostname ? host : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run once per page entry (mounted from the root layout). Stores the first
 * touch; upgrades an organic record when campaign parameters arrive later.
 */
export function captureAttribution(): void {
  if (typeof window === 'undefined') return;
  try {
    const incoming = parseAttributionParams(window.location.search);
    const existing = readAttribution();

    // Keep the stored record unless this visit adds channel information the
    // stored one lacks.
    if (existing && (hasCampaignData(existing) || !hasCampaignData(incoming))) return;

    const record: Attribution = {
      ...incoming,
      referrer: externalReferrerHost(),
      landing: clean(window.location.pathname),
      firstSeenAt: new Date().toISOString(),
    };

    window.localStorage.setItem(ATTR_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable — attribution is best-effort, never breaks a page */
  }
}
