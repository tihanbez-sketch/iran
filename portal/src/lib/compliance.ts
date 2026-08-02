/**
 * FAIS compliance layer.
 *
 * Non-negotiable rules for anything the portal shows a visitor:
 *   1. General information only — never advice specific to a person.
 *   2. Mandatory disclaimer on every AI-generated output.
 *   3. No named products or providers.
 *   4. No performance guarantees or projected returns.
 *
 * The model is instructed to follow these rules, but instruction is not
 * control. Every generated line is screened here before it reaches a visitor,
 * and anything that fails is dropped in favour of a pre-approved template.
 * That makes the guarantee structural rather than probabilistic.
 *
 * Pure functions only — see tests/compliance.test.ts.
 */

export const DISCLAIMER =
  'This is general information, not financial advice. Speak to a licensed advisor for advice specific to your situation.';

export type ViolationKind = 'named_product' | 'guarantee' | 'advice' | 'empty' | 'too_long';

export interface Violation {
  kind: ViolationKind;
  /** The exact text that triggered the rule, for the compliance audit log. */
  match: string;
}

export interface ScreenResult {
  ok: boolean;
  violations: Violation[];
}

/**
 * Product and provider names must never appear in generated output.
 *
 * Generic category terms — "retirement annuity", "living annuity", "pension
 * fund", "unit trust", "tax-free savings account" — are explicitly allowed:
 * they are educational vocabulary, not products a visitor could be steered
 * towards. Extend this list as the compliance officer requires.
 */
const NAMED_PRODUCTS = [
  'allan gray',
  'ninety one',
  'coronation',
  'sanlam',
  'old mutual',
  'discovery',
  'momentum',
  'liberty',
  'glacier',
  'stanlib',
  'satrix',
  'sygnia',
  'investec',
  'nedgroup',
  'nedbank',
  'absa',
  'fnb',
  'first national bank',
  'standard bank',
  'capitec',
  'alexander forbes',
  'alexforbes',
  'psg',
  'm&g investments',
  'prudential',
  '10x',
  'easyequities',
  'outvest',
  'bidvest',
];

/** Performance promises. Any of these is an automatic fail. */
const GUARANTEE_PATTERNS: RegExp[] = [
  /\bguarantee(?:d|s|ing)?\b/i,
  /\brisk[- ]free\b/i,
  /\bno risk\b/i,
  /\bzero risk\b/i,
  /\bwill (?:return|grow|earn|double|beat|outperform)\b/i,
  /\byou(?:'ll| will) (?:earn|make|get|receive)\b/i,
  /\bdouble your money\b/i,
  /\bbeat the market\b/i,
  /\boutperform\b/i,
  /\bassured returns?\b/i,
  /\bsecure(?:d)? returns?\b/i,
  /\b\d+(?:\.\d+)?\s*%\s*(?:per (?:year|annum)|p\.?a\.?|return|growth)\b/i,
];

/**
 * Personal-advice patterns. The line is between describing how something
 * works (fine) and directing this individual to act (not fine without a
 * licensed advisor and a full needs analysis).
 */
const ADVICE_PATTERNS: RegExp[] = [
  /\byou should (?:invest|buy|switch|move|cash|withdraw|transfer|surrender|cancel|take out)\b/i,
  /\byou must (?:invest|buy|switch|move|cash|withdraw|transfer)\b/i,
  /\bwe recommend that you\b/i,
  /\bi recommend\b/i,
  /\bwe advise (?:you|that)\b/i,
  /\bmy advice\b/i,
  /\bthe best (?:option|product|fund|choice) for you\b/i,
  /\byou need to (?:invest|buy|switch|move|surrender|cancel)\b/i,
];

/** Belt and braces: a single insight bullet should never run long. */
const MAX_INSIGHT_LENGTH = 400;

export function screenText(text: string): ScreenResult {
  const violations: Violation[] = [];
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return { ok: false, violations: [{ kind: 'empty', match: '' }] };
  }

  if (trimmed.length > MAX_INSIGHT_LENGTH) {
    violations.push({ kind: 'too_long', match: `${trimmed.length} characters` });
  }

  const lower = trimmed.toLowerCase();
  for (const product of NAMED_PRODUCTS) {
    // Word-boundary check so "psg" doesn't fire inside an unrelated word.
    const pattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(product)}(?:[^a-z0-9]|$)`, 'i');
    if (pattern.test(lower)) {
      violations.push({ kind: 'named_product', match: product });
    }
  }

  for (const pattern of GUARANTEE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) violations.push({ kind: 'guarantee', match: match[0] });
  }

  for (const pattern of ADVICE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) violations.push({ kind: 'advice', match: match[0] });
  }

  return { ok: violations.length === 0, violations };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Filters a batch of generated lines down to the compliant ones.
 * Rejections are returned rather than thrown so the caller can log them for
 * the compliance audit trail and top up from templates.
 */
export function screenAll(lines: string[]): {
  passed: string[];
  rejected: Array<{ text: string; violations: Violation[] }>;
} {
  const passed: string[] = [];
  const rejected: Array<{ text: string; violations: Violation[] }> = [];

  for (const line of lines) {
    const result = screenText(line);
    if (result.ok) {
      passed.push(line.trim());
    } else {
      rejected.push({ text: line, violations: result.violations });
    }
  }

  return { passed, rejected };
}

/** Appends the mandatory disclaimer, without duplicating it. */
export function withDisclaimer(text: string): string {
  const trimmed = text.trim();
  if (trimmed.includes(DISCLAIMER)) return trimmed;
  return trimmed.length === 0 ? DISCLAIMER : `${trimmed}\n\n${DISCLAIMER}`;
}
