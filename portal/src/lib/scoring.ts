/**
 * Retirement Health Score — pure scoring logic.
 *
 * No I/O, no framework imports. Everything here is deterministic so it can be
 * unit-tested and so the compliance officer can audit exactly how a score is
 * produced. See tests/scoring.test.ts.
 *
 * The score is out of 100, split across five weighted dimensions:
 *
 *   Savings adequacy (age-adjusted) .... 30
 *   Monthly savings rate ............... 20
 *   Debt level ......................... 20
 *   Retirement vehicle ................. 15
 *   Life cover ......................... 15
 *                                       ----
 *                                        100
 *
 * Age band, employment type and biggest worry carry no points. Age sets the
 * benchmark savings adequacy is measured against; the other two drive
 * segmentation tags for nurture sequences and advisor context.
 */

import type { QuestionId } from './quiz-questions';

export const DIMENSION_WEIGHTS = {
  savings: 30,
  savingsRate: 20,
  debt: 20,
  retirementVehicle: 15,
  lifeCover: 15,
} as const;

export type Dimension = keyof typeof DIMENSION_WEIGHTS;

export const MAX_SCORE = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);

export type QuizAnswers = Record<QuestionId, string>;

export interface DimensionScore {
  dimension: Dimension;
  label: string;
  points: number;
  max: number;
  /** 0–1, used by the visual breakdown bars. */
  ratio: number;
}

export type ScoreBand = 'on_track' | 'solid' | 'needs_attention' | 'urgent';

export interface ScoreResult {
  score: number;
  band: ScoreBand;
  bandLabel: string;
  bandSummary: string;
  breakdown: DimensionScore[];
  /** Weakest-first dimension keys — drives what the insights lead with. */
  priorities: Dimension[];
  /** Segmentation tags for nurture sequences and advisor routing. */
  tags: string[];
}

/* -------------------------------------------------------------------------- */
/* Savings adequacy (age-adjusted)                                            */
/* -------------------------------------------------------------------------- */

/** Ordinal position of each savings band. Index is meaningful, order matters. */
const SAVINGS_LADDER = ['none', 'under_250k', '250k_1m', '1m_3m', '3m_plus'] as const;

/**
 * The rung on the savings ladder we'd expect someone in this age band to have
 * reached. Deliberately conservative — this is a directional health check, not
 * a financial needs analysis.
 */
const SAVINGS_BENCHMARK_BY_AGE: Record<string, number> = {
  under_30: 1,
  '30_39': 2,
  '40_49': 3,
  '50_59': 4,
  '60_plus': 4,
};

export function scoreSavings(savingsBand: string, ageBand: string): number {
  const actual = SAVINGS_LADDER.indexOf(savingsBand as (typeof SAVINGS_LADDER)[number]);
  if (actual < 0) return 0;

  const benchmark = SAVINGS_BENCHMARK_BY_AGE[ageBand] ?? 2;

  // Offsetting both sides by 0.5 keeps "nothing saved" from scoring a flat zero
  // for a 25-year-old while still penalising it heavily at 60.
  const ratio = (actual + 0.5) / (benchmark + 0.5);
  return Math.round(DIMENSION_WEIGHTS.savings * Math.min(1, ratio));
}

/* -------------------------------------------------------------------------- */
/* Straight lookup dimensions                                                 */
/* -------------------------------------------------------------------------- */

const SAVINGS_RATE_POINTS: Record<string, number> = {
  none: 0,
  under_5: 5,
  '5_10': 11,
  '10_15': 16,
  '15_plus': 20,
};

const RETIREMENT_VEHICLE_POINTS: Record<string, number> = {
  none: 0,
  unsure: 4,
  employer_fund_only: 9,
  ra_only: 9,
  both: 15,
};

const LIFE_COVER_POINTS: Record<string, number> = {
  none: 0,
  unsure: 4,
  group_only: 7,
  personal: 12,
  personal_reviewed: 15,
};

/** Inverse: less debt scores higher. */
const DEBT_POINTS: Record<string, number> = {
  overwhelming: 0,
  high: 3,
  moderate: 9,
  manageable: 15,
  none: 20,
};

function lookup(table: Record<string, number>, value: string): number {
  return table[value] ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Bands                                                                       */
/* -------------------------------------------------------------------------- */

const BANDS: Array<{
  band: ScoreBand;
  min: number;
  label: string;
  summary: string;
}> = [
  {
    band: 'on_track',
    min: 80,
    label: 'On track',
    summary:
      'Your answers point to a well-established retirement position. The value now is in refinement — checking that the structure, costs and cover still match your plans.',
  },
  {
    band: 'solid',
    min: 60,
    label: 'Solid foundation',
    summary:
      'You have the building blocks in place. There are one or two areas where a change now would compound meaningfully over the years ahead.',
  },
  {
    band: 'needs_attention',
    min: 40,
    label: 'Needs attention',
    summary:
      'Parts of your plan are working, but there are gaps that tend to widen with time. Addressing the largest one first usually makes the biggest difference.',
  },
  {
    band: 'urgent',
    min: 0,
    label: 'Time to act',
    summary:
      'Your answers suggest several areas need attention. That is a common starting point, and the earliest steps are usually the ones that move the score most.',
  },
];

export function bandFor(score: number): (typeof BANDS)[number] {
  return BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1];
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                        */
/* -------------------------------------------------------------------------- */

const WORRY_TAGS: Record<string, string> = {
  outliving_savings: 'retirement',
  not_saving_enough: 'retirement',
  family_protection: 'risk',
  debt: 'debt',
  not_knowing: 'general',
};

export function deriveTags(answers: QuizAnswers, breakdown: DimensionScore[]): string[] {
  const tags = new Set<string>();

  if (answers.employmentType === 'public_sector_gepf') tags.add('gepf');
  if (answers.employmentType === 'self_employed') tags.add('self_employed');

  const worryTag = WORRY_TAGS[answers.biggestWorry];
  if (worryTag) tags.add(worryTag);

  // A dimension scoring under half its weight is a genuine gap worth tagging.
  for (const d of breakdown) {
    if (d.ratio >= 0.5) continue;
    if (d.dimension === 'lifeCover') tags.add('risk');
    if (d.dimension === 'debt') tags.add('debt');
    if (d.dimension === 'savings' || d.dimension === 'savingsRate') tags.add('retirement');
    if (d.dimension === 'retirementVehicle') tags.add('retirement');
  }

  if (answers.savingsBand === 'none' && answers.retirementVehicle === 'none') {
    tags.add('new_investor');
  }

  if (answers.ageBand === '50_59' || answers.ageBand === '60_plus') {
    tags.add('pre_retirement');
  }

  return [...tags].sort();
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

const DIMENSION_LABELS: Record<Dimension, string> = {
  savings: 'Retirement savings so far',
  savingsRate: 'Monthly contribution rate',
  debt: 'Debt position',
  retirementVehicle: 'Retirement structure',
  lifeCover: 'Life cover',
};

export function scoreQuiz(answers: QuizAnswers): ScoreResult {
  const points: Record<Dimension, number> = {
    savings: scoreSavings(answers.savingsBand, answers.ageBand),
    savingsRate: lookup(SAVINGS_RATE_POINTS, answers.monthlySavingsRate),
    debt: lookup(DEBT_POINTS, answers.debtLevel),
    retirementVehicle: lookup(RETIREMENT_VEHICLE_POINTS, answers.retirementVehicle),
    lifeCover: lookup(LIFE_COVER_POINTS, answers.lifeCover),
  };

  const breakdown: DimensionScore[] = (Object.keys(DIMENSION_WEIGHTS) as Dimension[]).map(
    (dimension) => {
      const max = DIMENSION_WEIGHTS[dimension];
      const pts = points[dimension];
      // Every weight is a non-zero literal in DIMENSION_WEIGHTS, so this
      // division is always safe.
      return {
        dimension,
        label: DIMENSION_LABELS[dimension],
        points: pts,
        max,
        ratio: pts / max,
      };
    },
  );

  const score = breakdown.reduce((total, d) => total + d.points, 0);
  const band = bandFor(score);

  // Weakest first. Ties break on the larger weight, so a 0/30 outranks a 0/15.
  const priorities = [...breakdown]
    .sort((a, b) => a.ratio - b.ratio || b.max - a.max)
    .map((d) => d.dimension);

  return {
    score,
    band: band.band,
    bandLabel: band.label,
    bandSummary: band.summary,
    breakdown,
    priorities,
    tags: deriveTags(answers, breakdown),
  };
}
