/**
 * Request validation. Everything crossing the API boundary is parsed here —
 * nothing reaches Supabase or the Claude API unvalidated.
 */

import { z } from 'zod';

import { EVENT_TYPES } from './lead-scoring';
import { QUESTIONS_BY_ID, QUIZ_QUESTIONS } from './quiz-questions';

/** Each answer must be one of the options we actually offered. */
const answerShape = Object.fromEntries(
  QUIZ_QUESTIONS.map((q) => [
    q.id,
    z.enum(q.options.map((o) => o.value) as [string, ...string[]]),
  ]),
) as Record<string, z.ZodEnum<[string, ...string[]]>>;

export const quizAnswersSchema = z.object(answerShape).strict();

/**
 * First-touch channel record from the browser (src/lib/attribution.ts).
 * Unknown keys are stripped rather than rejected, so an older or newer stored
 * record never blocks a submission.
 */
const attributionValue = z.string().trim().min(1).max(150);
export const attributionSchema = z.object({
  source: attributionValue.optional(),
  medium: attributionValue.optional(),
  campaign: attributionValue.optional(),
  content: attributionValue.optional(),
  term: attributionValue.optional(),
  ref: attributionValue.optional(),
  referrer: attributionValue.optional(),
  landing: z.string().trim().min(1).max(300).optional(),
  firstSeenAt: z.string().trim().min(1).max(40).optional(),
});

/** Drops undefined values so the object is clean for jsonb storage. */
export function compactAttribution(
  attribution: z.infer<typeof attributionSchema> | undefined,
): Record<string, string> {
  if (!attribution) return {};
  return Object.fromEntries(
    Object.entries(attribution).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string',
    ),
  );
}

export const quizSubmissionSchema = z.object({
  answers: quizAnswersSchema,
  /** Anonymous browser-side id, lets us stitch pre-capture events to a lead. */
  sessionId: z.string().min(8).max(64),
  attribution: attributionSchema.optional(),
});

/**
 * SA mobile numbers, loosely validated: optional +27 or 0 prefix and 9–13
 * digits with common separators. Deliberately permissive — a rejected valid
 * number costs a lead, and the field is optional anyway.
 */
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s()-]{7,18}$/, 'Enter a valid contact number')
  .transform((v) => v.replace(/[\s()-]/g, ''));

export const leadCaptureSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name').max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .max(254),
  phone: z.union([phoneSchema, z.literal('')]).optional(),
  sessionId: z.string().min(8).max(64),
  answers: quizAnswersSchema,
  /** POPIA: explicit, unbundled consent. Must be true — no pre-ticked boxes. */
  consentPrivacy: z.literal(true, {
    errorMap: () => ({ message: 'Please confirm you accept the privacy policy' }),
  }),
  /** Separate, genuinely optional marketing consent. */
  consentMarketing: z.boolean().optional().default(false),
  source: z.string().max(80).optional().default('retirement_health_score'),
  attribution: attributionSchema.optional(),
});

export const eventSchema = z.object({
  eventType: z.enum(EVENT_TYPES as [string, ...string[]]),
  sessionId: z.string().min(8).max(64),
  leadId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
});

export type QuizSubmission = z.infer<typeof quizSubmissionSchema>;
export type LeadCapture = z.infer<typeof leadCaptureSchema>;
export type EventPayload = z.infer<typeof eventSchema>;

/** Flattens a ZodError into `{ field: message }` for the form UI. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Guards against an answer set that references a question we no longer ask. */
export function isKnownQuestion(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(QUESTIONS_BY_ID, id);
}
