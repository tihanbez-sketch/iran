/**
 * Pre-approved insight templates.
 *
 * These are the compliance officer's sign-off surface: general information
 * only, no products, no guarantees, no personal advice. They serve three jobs:
 *
 *   1. The portal keeps working when the Claude API is unavailable.
 *   2. They top up the set when a generated line fails compliance screening.
 *   3. They give the model concrete examples of the register we want.
 *
 * Keyed by the weakest dimension so the fallback is still relevant to the
 * person reading it, not generic filler.
 */

import type { Dimension } from './scoring';

export const INSIGHT_TEMPLATES: Record<Dimension, string[]> = {
  savings: [
    'Your accumulated retirement savings are the largest single driver of your score. Where the balance sits relative to your age is the number most worth understanding, because time is the input you cannot recover later.',
    'A common starting point is working out what your current savings would produce as a monthly income at retirement. That figure is often quite different from what people assume, in either direction.',
  ],
  savingsRate: [
    'The share of income going towards retirement each month tends to matter more over long periods than where the money is invested. Small, sustained increases compound in a way that one-off adjustments do not.',
    'Many people find it easier to raise their contribution rate alongside an annual increase, so the change lands before the higher income becomes part of everyday spending.',
  ],
  debt: [
    'Debt repayments and retirement contributions draw on the same monthly income. Understanding the interest rate on each debt is usually the first step in deciding how to balance the two.',
    'Higher-interest debt generally works against long-term savings, which is why the order in which debts are cleared is worth thinking through rather than defaulting to smallest first.',
  ],
  retirementVehicle: [
    'Retirement annuities and employer funds have tax treatments that differ from ordinary savings. Knowing which structures your money already sits in is the starting point for any conversation about efficiency.',
    'If you are unsure exactly what retirement products you hold, that is common and easily resolved. Your annual benefit statement or fund certificate sets out what is in place.',
  ],
  lifeCover: [
    'Life cover exists to protect a retirement plan from being derailed. A plan that depends on one income is exposed in a way the savings figures alone do not show.',
    'Group cover through an employer usually ends when the employment does. Understanding whether your cover is portable is worth checking before you need it.',
  ],
};

/** Used when a dimension-specific template is unavailable. */
export const GENERIC_TEMPLATES: string[] = [
  'A retirement plan is easier to keep on track when it is reviewed against a benchmark periodically rather than left untouched for years at a time.',
  'The questions worth asking about any existing plan are what it costs, what it covers, and what income it is expected to produce. Those three answers frame most other decisions.',
];

/**
 * Builds a compliant insight set from templates alone, weakest dimension first.
 * `count` is capped by what the templates can supply without repeating.
 */
export function templateInsights(priorities: Dimension[], count = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  // One line per weak dimension first, so the set stays varied.
  for (const dimension of priorities) {
    if (out.length >= count) break;
    const candidate = INSIGHT_TEMPLATES[dimension]?.[0];
    if (candidate && !seen.has(candidate)) {
      out.push(candidate);
      seen.add(candidate);
    }
  }

  // Then second-choice lines for the same dimensions.
  for (const dimension of priorities) {
    if (out.length >= count) break;
    for (const candidate of INSIGHT_TEMPLATES[dimension] ?? []) {
      if (out.length >= count) break;
      if (!seen.has(candidate)) {
        out.push(candidate);
        seen.add(candidate);
      }
    }
  }

  for (const candidate of GENERIC_TEMPLATES) {
    if (out.length >= count) break;
    if (!seen.has(candidate)) {
      out.push(candidate);
      seen.add(candidate);
    }
  }

  return out.slice(0, count);
}
