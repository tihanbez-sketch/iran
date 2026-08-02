import { describe, expect, it } from 'vitest';

import { QUIZ_QUESTIONS } from '@/lib/quiz-questions';
import {
  bandFor,
  DIMENSION_WEIGHTS,
  MAX_SCORE,
  scoreQuiz,
  scoreSavings,
  type QuizAnswers,
} from '@/lib/scoring';

/** Every answer at its worst value. */
const WORST: QuizAnswers = {
  ageBand: '60_plus',
  employmentType: 'private_sector',
  savingsBand: 'none',
  monthlySavingsRate: 'none',
  retirementVehicle: 'none',
  lifeCover: 'none',
  debtLevel: 'overwhelming',
  biggestWorry: 'not_knowing',
};

/** Every answer at its best value. */
const BEST: QuizAnswers = {
  ageBand: '30_39',
  employmentType: 'private_sector',
  savingsBand: '3m_plus',
  monthlySavingsRate: '15_plus',
  retirementVehicle: 'both',
  lifeCover: 'personal_reviewed',
  debtLevel: 'none',
  biggestWorry: 'not_knowing',
};

function answersWith(overrides: Partial<QuizAnswers>): QuizAnswers {
  return { ...WORST, ...overrides };
}

describe('weights', () => {
  it('sums to exactly 100', () => {
    expect(MAX_SCORE).toBe(100);
  });

  it('covers every scored question exactly once', () => {
    const scoredQuestions = QUIZ_QUESTIONS.filter((q) => q.scored);
    expect(scoredQuestions).toHaveLength(Object.keys(DIMENSION_WEIGHTS).length);
  });
});

describe('scoreQuiz', () => {
  it('floors just above 0 for the worst possible answers', () => {
    // By design nobody is shown a literal zero: the +0.5 offset in
    // scoreSavings leaves 3 residual points even for a 60-year-old with
    // nothing saved. Every other dimension is a hard zero.
    const result = scoreQuiz(WORST);
    expect(result.score).toBe(3);
    expect(result.breakdown.filter((d) => d.dimension !== 'savings').every((d) => d.points === 0)).toBe(
      true,
    );
  });

  it('caps at 100 for the best possible answers', () => {
    expect(scoreQuiz(BEST).score).toBe(100);
  });

  it('never returns a score outside 0-100 across the full answer space', () => {
    // Exhaustive over the scored dimensions, for every age band.
    const ages = ['under_30', '30_39', '40_49', '50_59', '60_plus'];
    const savings = ['none', 'under_250k', '250k_1m', '1m_3m', '3m_plus'];
    const rates = ['none', 'under_5', '5_10', '10_15', '15_plus'];
    const vehicles = ['none', 'unsure', 'employer_fund_only', 'ra_only', 'both'];
    const covers = ['none', 'unsure', 'group_only', 'personal', 'personal_reviewed'];
    const debts = ['overwhelming', 'high', 'moderate', 'manageable', 'none'];

    let checked = 0;
    for (const ageBand of ages) {
      for (const savingsBand of savings) {
        for (const monthlySavingsRate of rates) {
          for (const retirementVehicle of vehicles) {
            for (const lifeCover of covers) {
              for (const debtLevel of debts) {
                const { score, breakdown } = scoreQuiz(
                  answersWith({
                    ageBand,
                    savingsBand,
                    monthlySavingsRate,
                    retirementVehicle,
                    lifeCover,
                    debtLevel,
                  }),
                );
                expect(score).toBeGreaterThanOrEqual(0);
                expect(score).toBeLessThanOrEqual(100);
                // Score must always equal the sum of its parts.
                expect(score).toBe(breakdown.reduce((t, d) => t + d.points, 0));
                checked += 1;
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(5 ** 6);
  });

  it('never lets a dimension exceed its weight', () => {
    const { breakdown } = scoreQuiz(BEST);
    for (const d of breakdown) {
      expect(d.points).toBeLessThanOrEqual(d.max);
      expect(d.ratio).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    const a = scoreQuiz(BEST);
    const b = scoreQuiz(BEST);
    expect(a).toEqual(b);
  });

  it('treats unknown answer values as zero rather than throwing', () => {
    // A tampered or stale payload must degrade to no points for that
    // dimension, never crash the scoring endpoint.
    const clean = scoreQuiz(answersWith({ ...BEST, debtLevel: 'none' }));
    const tampered = scoreQuiz(answersWith({ ...BEST, debtLevel: 'not_a_real_option' }));

    expect(tampered.breakdown.find((d) => d.dimension === 'debt')?.points).toBe(0);
    expect(tampered.score).toBe(clean.score - DIMENSION_WEIGHTS.debt);
  });
});

describe('scoreSavings — age adjustment', () => {
  it('scores the same balance higher for a younger person', () => {
    const young = scoreSavings('250k_1m', 'under_30');
    const old = scoreSavings('250k_1m', '60_plus');
    expect(young).toBeGreaterThan(old);
  });

  it('awards full marks once the age benchmark is met', () => {
    expect(scoreSavings('under_250k', 'under_30')).toBe(DIMENSION_WEIGHTS.savings);
    expect(scoreSavings('3m_plus', '60_plus')).toBe(DIMENSION_WEIGHTS.savings);
  });

  it('does not exceed the weight when the benchmark is beaten', () => {
    expect(scoreSavings('3m_plus', 'under_30')).toBe(DIMENSION_WEIGHTS.savings);
  });

  it('gives partial credit rather than zero to a young person with nothing saved', () => {
    const score = scoreSavings('none', 'under_30');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(DIMENSION_WEIGHTS.savings);
  });

  it('penalises nothing saved much more heavily near retirement', () => {
    expect(scoreSavings('none', '60_plus')).toBeLessThan(scoreSavings('none', 'under_30'));
  });

  it('is monotonic — more saved never scores less, at any age', () => {
    const ladder = ['none', 'under_250k', '250k_1m', '1m_3m', '3m_plus'];
    for (const age of ['under_30', '30_39', '40_49', '50_59', '60_plus']) {
      for (let i = 1; i < ladder.length; i += 1) {
        expect(scoreSavings(ladder[i], age)).toBeGreaterThanOrEqual(
          scoreSavings(ladder[i - 1], age),
        );
      }
    }
  });

  it('returns 0 for an unrecognised savings band', () => {
    expect(scoreSavings('nonsense', '40_49')).toBe(0);
  });
});

describe('bands', () => {
  it.each([
    [100, 'on_track'],
    [80, 'on_track'],
    [79, 'solid'],
    [60, 'solid'],
    [59, 'needs_attention'],
    [40, 'needs_attention'],
    [39, 'urgent'],
    [0, 'urgent'],
  ])('maps a score of %i to %s', (score, expected) => {
    expect(bandFor(score).band).toBe(expected);
  });
});

describe('priorities', () => {
  it('lists the weakest dimension first', () => {
    // Strong everywhere except life cover.
    const result = scoreQuiz(answersWith({ ...BEST, lifeCover: 'none' }));
    expect(result.priorities[0]).toBe('lifeCover');
  });

  it('breaks ties towards the more heavily weighted dimension', () => {
    // Contribution rate (20 pts) and life cover (15 pts) both score a hard
    // zero, so their ratios tie. The heavier dimension must rank first.
    const result = scoreQuiz(
      answersWith({ ...BEST, monthlySavingsRate: 'none', lifeCover: 'none' }),
    );

    const rate = result.breakdown.find((d) => d.dimension === 'savingsRate');
    const cover = result.breakdown.find((d) => d.dimension === 'lifeCover');
    expect(rate?.ratio).toBe(cover?.ratio); // genuine tie, not an ordering accident

    expect(result.priorities.indexOf('savingsRate')).toBeLessThan(
      result.priorities.indexOf('lifeCover'),
    );
  });

  it('includes every dimension exactly once', () => {
    const result = scoreQuiz(BEST);
    expect([...result.priorities].sort()).toEqual(Object.keys(DIMENSION_WEIGHTS).sort());
  });
});

describe('tags', () => {
  it('tags GEPF members from employment type', () => {
    expect(scoreQuiz(answersWith({ employmentType: 'public_sector_gepf' })).tags).toContain('gepf');
  });

  it('tags risk when life cover is a gap', () => {
    expect(scoreQuiz(answersWith({ ...BEST, lifeCover: 'none' })).tags).toContain('risk');
  });

  it('tags risk from the stated worry even when cover is strong', () => {
    const result = scoreQuiz(answersWith({ ...BEST, biggestWorry: 'family_protection' }));
    expect(result.tags).toContain('risk');
  });

  it('tags new investors with no savings and no structure', () => {
    expect(scoreQuiz(answersWith({ savingsBand: 'none', retirementVehicle: 'none' })).tags).toContain(
      'new_investor',
    );
  });

  it('tags pre-retirement for the older age bands', () => {
    expect(scoreQuiz(answersWith({ ageBand: '50_59' })).tags).toContain('pre_retirement');
    expect(scoreQuiz(answersWith({ ageBand: '30_39' })).tags).not.toContain('pre_retirement');
  });

  it('returns unique, sorted tags', () => {
    const tags = scoreQuiz(WORST).tags;
    expect(tags).toEqual([...new Set(tags)].sort());
  });
});
