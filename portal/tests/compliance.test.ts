import { describe, expect, it } from 'vitest';

import { DISCLAIMER, screenAll, screenText, withDisclaimer } from '@/lib/compliance';
import { GENERIC_TEMPLATES, INSIGHT_TEMPLATES, templateInsights } from '@/lib/insight-templates';
import type { Dimension } from '@/lib/scoring';

describe('screenText — compliant copy passes', () => {
  it.each([
    'Your accumulated retirement savings are the largest single driver of your score.',
    'Retirement annuities and pension funds have tax treatments that differ from ordinary savings.',
    'Debt repayments and retirement contributions draw on the same monthly income.',
    'A living annuity and a life annuity work differently once you retire.',
    'Understanding whether your cover is portable is worth checking before you need it.',
  ])('passes: %s', (text) => {
    expect(screenText(text).ok).toBe(true);
  });
});

describe('screenText — named products', () => {
  it.each([
    'Consider an Allan Gray balanced fund for this portion.',
    'Old Mutual and Sanlam both offer this structure.',
    'A 10X retirement annuity is one option here.',
    'Your Discovery cover may already include this.',
  ])('rejects: %s', (text) => {
    const result = screenText(text);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === 'named_product')).toBe(true);
  });

  it('allows generic category terms that are not products', () => {
    const text =
      'A tax-free savings account, a unit trust and a retirement annuity are taxed differently.';
    expect(screenText(text).ok).toBe(true);
  });
});

describe('screenText — guarantees and performance claims', () => {
  it.each([
    'This approach guarantees a comfortable retirement.',
    'A guaranteed return is available on this structure.',
    'This is a risk-free way to grow your savings.',
    'Your money will double over the next ten years.',
    'You will earn more by moving your savings.',
    'This strategy will beat the market over time.',
    'Expect around 12% per year on this.',
    'These funds consistently outperform their peers.',
  ])('rejects: %s', (text) => {
    const result = screenText(text);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === 'guarantee')).toBe(true);
  });
});

describe('screenText — personal advice', () => {
  it.each([
    'You should invest more of your bonus each year.',
    'We recommend that you increase your contributions.',
    'I recommend moving your savings into a different structure.',
    'The best option for you is a retirement annuity.',
    'You need to cancel that policy.',
    'You must invest at least 15% of your income.',
  ])('rejects: %s', (text) => {
    const result = screenText(text);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === 'advice')).toBe(true);
  });

  it('allows describing what is worth understanding', () => {
    const text =
      'Working out what your current savings would produce as a monthly income is a common starting point.';
    expect(screenText(text).ok).toBe(true);
  });

  it('allows the word "should" outside a directive to act', () => {
    const text = 'Knowing what a plan should cost is different from knowing what yours does cost.';
    expect(screenText(text).ok).toBe(true);
  });
});

describe('screenText — structural checks', () => {
  it('rejects empty and whitespace-only text', () => {
    expect(screenText('').ok).toBe(false);
    expect(screenText('   \n  ').ok).toBe(false);
    expect(screenText('').violations[0].kind).toBe('empty');
  });

  it('rejects text beyond the length limit', () => {
    const result = screenText('a'.repeat(401));
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === 'too_long')).toBe(true);
  });

  it('reports every violation in one pass', () => {
    const result = screenText('We recommend that you buy an Old Mutual product with guaranteed returns.');
    const kinds = new Set(result.violations.map((v) => v.kind));
    expect(kinds.has('named_product')).toBe(true);
    expect(kinds.has('guarantee')).toBe(true);
    expect(kinds.has('advice')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(screenText('ALLAN GRAY has a fund for this.').ok).toBe(false);
    expect(screenText('This is GUARANTEED to work.').ok).toBe(false);
  });
});

describe('screenAll', () => {
  it('splits a batch into passed and rejected, preserving the reason', () => {
    const { passed, rejected } = screenAll([
      'Debt repayments and retirement contributions draw on the same monthly income.',
      'We recommend that you buy this product.',
      '',
    ]);

    expect(passed).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].violations.some((v) => v.kind === 'advice')).toBe(true);
    expect(rejected[1].violations[0].kind).toBe('empty');
  });

  it('trims whitespace on passing lines', () => {
    const { passed } = screenAll(['  Life cover exists to protect a retirement plan.  ']);
    expect(passed[0]).toBe('Life cover exists to protect a retirement plan.');
  });
});

describe('withDisclaimer', () => {
  it('appends the mandatory disclaimer', () => {
    expect(withDisclaimer('Some general information.')).toBe(
      `Some general information.\n\n${DISCLAIMER}`,
    );
  });

  it('does not duplicate an existing disclaimer', () => {
    const once = withDisclaimer('Some general information.');
    expect(withDisclaimer(once)).toBe(once);
  });

  it('returns just the disclaimer for empty input', () => {
    expect(withDisclaimer('   ')).toBe(DISCLAIMER);
  });
});

describe('pre-approved templates are themselves compliant', () => {
  const all = [...Object.values(INSIGHT_TEMPLATES).flat(), ...GENERIC_TEMPLATES];

  it.each(all)('passes screening: %s', (template) => {
    expect(screenText(template).ok).toBe(true);
  });

  it('covers every scored dimension', () => {
    const dimensions: Dimension[] = [
      'savings',
      'savingsRate',
      'debt',
      'retirementVehicle',
      'lifeCover',
    ];
    for (const d of dimensions) {
      expect(INSIGHT_TEMPLATES[d]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('templateInsights — the fallback path', () => {
  const priorities: Dimension[] = [
    'lifeCover',
    'debt',
    'savings',
    'savingsRate',
    'retirementVehicle',
  ];

  it('returns the requested number of insights', () => {
    expect(templateInsights(priorities, 3)).toHaveLength(3);
  });

  it('leads with the weakest dimension', () => {
    expect(templateInsights(priorities, 3)[0]).toBe(INSIGHT_TEMPLATES.lifeCover[0]);
  });

  it('never repeats a line', () => {
    const insights = templateInsights(priorities, 3);
    expect(new Set(insights).size).toBe(insights.length);
  });

  it('still produces output when priorities are empty', () => {
    const insights = templateInsights([], 3);
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.every((i) => screenText(i).ok)).toBe(true);
  });

  it('does not repeat when asked for more than it has', () => {
    const insights = templateInsights(priorities, 50);
    expect(new Set(insights).size).toBe(insights.length);
  });
});
