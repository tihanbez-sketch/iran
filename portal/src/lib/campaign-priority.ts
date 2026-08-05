/**
 * Campaign priority scoring — who does the call centre phone first?
 *
 * Pure and transparent, in the house style of scoring.ts: additive weights
 * that sum to 100, every point traceable to a reason the agent can read.
 * The score is stamped onto campaign_members.priority_score at enrolment
 * (import time), exactly as events.points is stamped at insert — weights live
 * here and only here, and retuning them never rewrites an existing queue.
 *
 * v1 uses only what the funeral-book export provides: age band, premium and
 * tenure — plus an engagement bump when quiz events exist. Reasons are
 * factual statements for the agent card, never advice.
 */

import type { ScoredEvent } from './lead-scoring';

export const PRIORITY_WEIGHTS = {
  ageBand: 35,
  premium: 30,
  tenure: 25,
  engagement: 10,
} as const;

export type PriorityDimension = keyof typeof PRIORITY_WEIGHTS;

export const MAX_PRIORITY = Object.values(PRIORITY_WEIGHTS).reduce((a, b) => a + b, 0);

export type AgeBand = 'under_30' | '30_39' | '40_49' | '50_59' | '60_plus';

export interface PriorityInput {
  ageBand: AgeBand | null;
  premiumCents: number | null;
  /** ISO date (yyyy-mm-dd) the funeral policy started, or null. */
  startDate: string | null;
  /** Lead's event history, if any — web quiz activity boosts priority. */
  events?: ScoredEvent[];
}

export interface PriorityReason {
  dimension: PriorityDimension;
  /** Factual, agent-card-ready. Never advice. */
  label: string;
  points: number;
  max: number;
}

export interface PriorityResult {
  score: number;
  reasons: PriorityReason[];
}

/* -------------------------------------------------------------------------- */
/* Age: life-cover need peaks in the dependant-raising, income-earning years. */
/* -------------------------------------------------------------------------- */

const AGE_POINTS: Record<AgeBand, number> = {
  '30_39': 35,
  '40_49': 30,
  under_30: 20,
  '50_59': 15,
  '60_plus': 5,
};

const AGE_LABEL: Record<AgeBand, string> = {
  under_30: 'Under 30',
  '30_39': 'Age band 30–39',
  '40_49': 'Age band 40–49',
  '50_59': 'Age band 50–59',
  '60_plus': 'Age 60 or older',
};

const UNKNOWN_AGE_POINTS = 10;

/* -------------------------------------------------------------------------- */
/* Premium: affordability proxy, thresholds in cents.                          */
/* -------------------------------------------------------------------------- */

function premiumPoints(premiumCents: number | null): { points: number; label: string } {
  if (premiumCents === null || !Number.isFinite(premiumCents)) {
    return { points: 8, label: 'Premium unknown' };
  }
  const rands = Math.round(premiumCents / 100);
  if (premiumCents >= 20_000) return { points: 30, label: `Premium about R${rands} per month` };
  if (premiumCents >= 10_000) return { points: 22, label: `Premium about R${rands} per month` };
  if (premiumCents >= 5_000) return { points: 15, label: `Premium about R${rands} per month` };
  return { points: 8, label: `Premium about R${rands} per month` };
}

/* -------------------------------------------------------------------------- */
/* Tenure: 2–10 years is the sweet spot — a proven payer with an established  */
/* relationship, past the too-soon-after-sale window.                          */
/* -------------------------------------------------------------------------- */

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export function tenureYears(startDate: string | null, now: Date): number | null {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;
  const years = (now.getTime() - start.getTime()) / MS_PER_YEAR;
  return years < 0 ? null : years;
}

function tenurePoints(years: number | null): { points: number; label: string } {
  if (years === null) return { points: 10, label: 'Policy start date unknown' };
  const rounded = Math.floor(years);
  if (years >= 2 && years < 10) {
    return { points: 25, label: `Funeral policyholder for ${rounded} years` };
  }
  if (years >= 10) return { points: 15, label: `Funeral policyholder for ${rounded}+ years` };
  if (years >= 1) return { points: 18, label: 'Funeral policyholder for about a year' };
  return { points: 8, label: 'Policy started less than a year ago' };
}

/* -------------------------------------------------------------------------- */
/* Engagement: they already interacted with the portal.                        */
/* -------------------------------------------------------------------------- */

function engagementPoints(events: ScoredEvent[] | undefined): { points: number; label: string } | null {
  const engaged = (events ?? []).some(
    (e) => e.eventType === 'quiz_completed' || e.eventType === 'quiz_assisted',
  );
  return engaged ? { points: 10, label: 'Completed the financial health quiz' } : null;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export function computePriority(input: PriorityInput, now: Date = new Date()): PriorityResult {
  const reasons: PriorityReason[] = [];

  if (input.ageBand && AGE_POINTS[input.ageBand] !== undefined) {
    reasons.push({
      dimension: 'ageBand',
      label: AGE_LABEL[input.ageBand],
      points: AGE_POINTS[input.ageBand],
      max: PRIORITY_WEIGHTS.ageBand,
    });
  } else {
    reasons.push({
      dimension: 'ageBand',
      label: 'Age unknown',
      points: UNKNOWN_AGE_POINTS,
      max: PRIORITY_WEIGHTS.ageBand,
    });
  }

  const premium = premiumPoints(input.premiumCents);
  reasons.push({
    dimension: 'premium',
    label: premium.label,
    points: premium.points,
    max: PRIORITY_WEIGHTS.premium,
  });

  const tenure = tenurePoints(tenureYears(input.startDate, now));
  reasons.push({
    dimension: 'tenure',
    label: tenure.label,
    points: tenure.points,
    max: PRIORITY_WEIGHTS.tenure,
  });

  const engagement = engagementPoints(input.events);
  if (engagement) {
    reasons.push({
      dimension: 'engagement',
      label: engagement.label,
      points: engagement.points,
      max: PRIORITY_WEIGHTS.engagement,
    });
  }

  const score = reasons.reduce((total, r) => total + r.points, 0);
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export type PriorityBand = 'high' | 'medium' | 'low';

export function priorityBand(score: number): PriorityBand {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/** Feeds the existing BreakdownBars component unchanged. */
export function reasonsToBreakdown(
  result: PriorityResult,
): Array<{ dimension: string; label: string; points: number; max: number; ratio: number }> {
  return result.reasons.map((r) => ({
    dimension: r.dimension,
    label: r.label,
    points: r.points,
    max: r.max,
    ratio: r.max === 0 ? 0 : r.points / r.max,
  }));
}
