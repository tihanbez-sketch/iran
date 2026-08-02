/**
 * Claude-generated quiz insights.
 *
 * Contract with the rest of the app: this function always returns three
 * compliant insight bullets. It never throws and never blocks a quiz result.
 * If the Claude API is unconfigured, slow, erroring, or returns something that
 * fails FAIS screening, the caller still gets a usable, pre-approved set.
 *
 * Every returned line has passed `screenText()` in ./compliance.ts.
 */

import Anthropic from '@anthropic-ai/sdk';

import { DISCLAIMER, screenAll, type Violation } from './compliance';
import { templateInsights } from './insight-templates';
import { labelFor, QUIZ_QUESTIONS } from './quiz-questions';
import type { QuizAnswers, ScoreResult } from './scoring';

/** Model is pinned deliberately — a silent upgrade would bypass compliance sign-off. */
const MODEL = 'claude-opus-5';
const INSIGHT_COUNT = 3;
const REQUEST_TIMEOUT_MS = 20_000;

export type InsightSource = 'claude' | 'template' | 'mixed';

export interface InsightResult {
  insights: string[];
  source: InsightSource;
  disclaimer: string;
  /** Populated when generated lines were dropped. Surface this to compliance, never to the visitor. */
  rejected: Array<{ text: string; violations: Violation[] }>;
  /** Set when the API path could not be used. For server logs only. */
  degradedReason?: string;
}

const SYSTEM_PROMPT = `You write short educational observations for PFL Financial Advisors, an FSCA-licensed financial advisory firm in KwaZulu-Natal, South Africa. Your output appears in a consumer-facing "Retirement Health Score" report.

You are writing GENERAL INFORMATION for an unqualified audience. You are not giving financial advice, and you have not done a needs analysis.

Absolute rules — a response that breaks any of these is discarded:
- Never name a financial product, fund, provider or institution. Generic category words such as "retirement annuity", "pension fund", "living annuity", "unit trust" or "tax-free savings account" are fine.
- Never guarantee, promise or project a return, growth rate or outcome. No percentages describing performance.
- Never tell the reader what they personally should do. Do not write "you should invest", "we recommend", "the best option for you is", or anything equivalent. Describe how things work and what is worth understanding; leave the recommendation to a licensed advisor.
- Never state or imply that the reader's plan is adequate or inadequate as a matter of fact. Describe what their answers point to.
- Do not include a disclaimer. One is added automatically.

Style:
- Exactly ${INSIGHT_COUNT} observations.
- Two to three sentences each, 30 to 60 words.
- Plain South African English. No jargon without a plain-language gloss. No emoji, no markdown, no headings, no bullet characters.
- Calm and factual. Not salesy, not alarmist, not congratulatory.
- Lead with the reader's weakest area. Each observation must cover a different area.
- Write in the second person ("your", "you have") when describing their answers.`;

const INSIGHT_SCHEMA = {
  type: 'object',
  properties: {
    insights: {
      type: 'array',
      description: `Exactly ${INSIGHT_COUNT} observations, weakest area first.`,
      items: { type: 'string' },
    },
  },
  required: ['insights'],
  additionalProperties: false,
} as const;

/** Compact, unambiguous rendering of the quiz for the model. */
function buildUserPrompt(answers: QuizAnswers, result: ScoreResult): string {
  const answerLines = QUIZ_QUESTIONS.map(
    (q) => `- ${q.question} ${labelFor(q.id, answers[q.id])}`,
  ).join('\n');

  const breakdownLines = result.breakdown
    .map((d) => `- ${d.label}: ${d.points} of ${d.max}`)
    .join('\n');

  const priorityLabels = result.priorities
    .map((p) => result.breakdown.find((d) => d.dimension === p)?.label ?? p)
    .join(', then ');

  return `Here is one visitor's completed Retirement Health Score.

Their answers:
${answerLines}

Their score: ${result.score} out of 100 (${result.bandLabel})

Score breakdown:
${breakdownLines}

Weakest areas, in order: ${priorityLabels}

Write ${INSIGHT_COUNT} observations for this person, leading with their weakest area.`;
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
  }
  return cachedClient;
}

/** Pulls the insight array out of a structured-output response. */
function parseInsights(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { insights?: unknown }).insights)
    ) {
      return (parsed as { insights: unknown[] }).insights
        .filter((i): i is string => typeof i === 'string')
        .map((i) => i.trim())
        .filter(Boolean);
    }
  } catch {
    // Fall through — an unparseable body is handled as a degraded response.
  }
  return [];
}

export async function generateInsights(
  answers: QuizAnswers,
  result: ScoreResult,
): Promise<InsightResult> {
  const fallback = (reason: string): InsightResult => ({
    insights: templateInsights(result.priorities, INSIGHT_COUNT),
    source: 'template',
    disclaimer: DISCLAIMER,
    rejected: [],
    degradedReason: reason,
  });

  const client = getClient();
  if (!client) return fallback('ANTHROPIC_API_KEY is not set');

  let raw: string[];
  try {
    const response = await client.messages.create({
      model: MODEL,
      // Headroom for adaptive thinking plus a short structured body. Thinking is
      // on by default on this model and draws from the same budget.
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      output_config: {
        // A short, well-specified generation task — low effort is ample and
        // keeps latency down on a page the visitor is waiting on.
        effort: 'low',
        format: { type: 'json_schema', schema: INSIGHT_SCHEMA },
      },
      messages: [{ role: 'user', content: buildUserPrompt(answers, result) }],
    });

    // Safety classifiers can decline a request; content is empty or partial.
    if (response.stop_reason === 'refusal') {
      return fallback(`model refused (${response.stop_details?.category ?? 'unspecified'})`);
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    raw = parseInsights(text);
    if (raw.length === 0) return fallback('response contained no parseable insights');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallback(`claude request failed: ${message}`);
  }

  // Nothing generated reaches a visitor without passing FAIS screening.
  const { passed, rejected } = screenAll(raw.slice(0, INSIGHT_COUNT));

  if (passed.length === 0) {
    return {
      ...fallback('all generated insights failed compliance screening'),
      rejected,
    };
  }

  // Top up from templates if screening dropped one, so the report is complete.
  const insights = [...passed];
  if (insights.length < INSIGHT_COUNT) {
    for (const template of templateInsights(result.priorities, INSIGHT_COUNT)) {
      if (insights.length >= INSIGHT_COUNT) break;
      if (!insights.includes(template)) insights.push(template);
    }
  }

  return {
    insights: insights.slice(0, INSIGHT_COUNT),
    source: rejected.length > 0 ? 'mixed' : 'claude',
    disclaimer: DISCLAIMER,
    rejected,
  };
}
