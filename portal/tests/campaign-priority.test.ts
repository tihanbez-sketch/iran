import { describe, expect, it } from 'vitest';

import {
  computePriority,
  MAX_PRIORITY,
  PRIORITY_WEIGHTS,
  priorityBand,
  reasonsToBreakdown,
  tenureYears,
  type AgeBand,
  type PriorityInput,
} from '@/lib/campaign-priority';

const NOW = new Date('2026-08-05T12:00:00Z');

const AGE_BANDS: Array<AgeBand | null> = ['under_30', '30_39', '40_49', '50_59', '60_plus', null];
const PREMIUMS: Array<number | null> = [null, 3_000, 7_500, 15_000, 25_000];
const START_DATES: Array<string | null> = [
  null,
  '2026-03-01', // < 1 year
  '2025-05-01', // ~1.25 years
  '2020-01-01', // ~6.5 years (sweet spot)
  '2010-01-01', // 16+ years
];

describe('weights', () => {
  it('sum to exactly 100', () => {
    expect(MAX_PRIORITY).toBe(100);
  });
});

describe('computePriority', () => {
  it('stays within 0-100 and equals the sum of its reasons, across all combinations', () => {
    let checked = 0;
    for (const ageBand of AGE_BANDS) {
      for (const premiumCents of PREMIUMS) {
        for (const startDate of START_DATES) {
          for (const events of [undefined, [{ eventType: 'quiz_completed' as const }]]) {
            const input: PriorityInput = { ageBand, premiumCents, startDate, events };
            const result = computePriority(input, NOW);
            expect(result.score).toBeGreaterThanOrEqual(0);
            expect(result.score).toBeLessThanOrEqual(100);
            expect(result.score).toBe(result.reasons.reduce((t, r) => t + r.points, 0));
            for (const reason of result.reasons) {
              expect(reason.points).toBeLessThanOrEqual(reason.max);
              expect(reason.max).toBe(PRIORITY_WEIGHTS[reason.dimension]);
            }
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(AGE_BANDS.length * PREMIUMS.length * START_DATES.length * 2);
  });

  it('ranks the 30-49 income years highest on age', () => {
    const at = (ageBand: AgeBand | null) =>
      computePriority({ ageBand, premiumCents: null, startDate: null }, NOW).reasons.find(
        (r) => r.dimension === 'ageBand',
      )!.points;
    expect(at('30_39')).toBeGreaterThan(at('40_49'));
    expect(at('40_49')).toBeGreaterThan(at('under_30'));
    expect(at('under_30')).toBeGreaterThan(at('50_59'));
    expect(at('50_59')).toBeGreaterThan(at('60_plus'));
  });

  it('treats the 2-10 year tenure as the sweet spot', () => {
    const at = (startDate: string | null) =>
      computePriority({ ageBand: null, premiumCents: null, startDate }, NOW).reasons.find(
        (r) => r.dimension === 'tenure',
      )!.points;
    expect(at('2020-01-01')).toBeGreaterThan(at('2010-01-01')); // 6y > 16y
    expect(at('2020-01-01')).toBeGreaterThan(at('2026-03-01')); // 6y > 5 months
    expect(at('2025-05-01')).toBeGreaterThan(at('2026-03-01')); // 1.25y > 5 months
  });

  it('only counts engagement when quiz events exist', () => {
    const base: PriorityInput = { ageBand: '30_39', premiumCents: 25_000, startDate: '2020-01-01' };
    const without = computePriority(base, NOW);
    const withQuiz = computePriority(
      { ...base, events: [{ eventType: 'quiz_completed' }] },
      NOW,
    );
    const withAssisted = computePriority(
      { ...base, events: [{ eventType: 'quiz_assisted' }] },
      NOW,
    );
    const withNoise = computePriority(
      { ...base, events: [{ eventType: 'email_opened' }] },
      NOW,
    );

    expect(withQuiz.score).toBe(without.score + PRIORITY_WEIGHTS.engagement);
    expect(withAssisted.score).toBe(withQuiz.score);
    expect(withNoise.score).toBe(without.score);
  });

  it('produces the maximum for the ideal profile', () => {
    const result = computePriority(
      {
        ageBand: '30_39',
        premiumCents: 25_000,
        startDate: '2020-01-01',
        events: [{ eventType: 'quiz_completed' }],
      },
      NOW,
    );
    expect(result.score).toBe(100);
  });

  it('is deterministic', () => {
    const input: PriorityInput = { ageBand: '40_49', premiumCents: 12_000, startDate: '2019-06-15' };
    expect(computePriority(input, NOW)).toEqual(computePriority(input, NOW));
  });

  it('keeps reason labels factual — no advice, no recommendations', () => {
    for (const ageBand of AGE_BANDS) {
      const result = computePriority(
        { ageBand, premiumCents: 15_000, startDate: '2020-01-01' },
        NOW,
      );
      for (const reason of result.reasons) {
        expect(reason.label).not.toMatch(/should|recommend|best|must/i);
      }
    }
  });
});

describe('tenureYears', () => {
  it('computes fractional years', () => {
    expect(tenureYears('2020-08-05', NOW)).toBeCloseTo(6, 1);
  });
  it('returns null for missing, invalid or future dates', () => {
    expect(tenureYears(null, NOW)).toBeNull();
    expect(tenureYears('not a date', NOW)).toBeNull();
    expect(tenureYears('2030-01-01', NOW)).toBeNull();
  });
});

describe('priorityBand', () => {
  it.each([
    [100, 'high'],
    [70, 'high'],
    [69, 'medium'],
    [40, 'medium'],
    [39, 'low'],
    [0, 'low'],
  ] as const)('maps %i to %s', (score, band) => {
    expect(priorityBand(score)).toBe(band);
  });
});

describe('reasonsToBreakdown', () => {
  it('produces the BreakdownBars shape with ratios', () => {
    const result = computePriority(
      { ageBand: '30_39', premiumCents: 25_000, startDate: '2020-01-01' },
      NOW,
    );
    const breakdown = reasonsToBreakdown(result);
    expect(breakdown).toHaveLength(result.reasons.length);
    for (const bar of breakdown) {
      expect(bar.ratio).toBeGreaterThanOrEqual(0);
      expect(bar.ratio).toBeLessThanOrEqual(1);
      expect(bar).toHaveProperty('label');
      expect(bar).toHaveProperty('points');
      expect(bar).toHaveProperty('max');
    }
  });
});
