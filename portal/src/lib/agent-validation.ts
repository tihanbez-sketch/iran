/**
 * Request schemas for the authenticated agent API (/api/agent/*).
 *
 * Kept apart from validation.ts: that file describes what anonymous visitors
 * may send, this one what signed-in agents may send. The disposition action
 * list derives from the DISPOSITIONS state machine so a new action is valid
 * here the moment it exists there — same single-source convention as
 * EVENT_POINTS → eventSchema.
 */

import { z } from 'zod';

import { DISPOSITIONS, type DispositionAction } from './disposition';

const ACTION_VALUES = Object.keys(DISPOSITIONS) as [DispositionAction, ...DispositionAction[]];

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(200),
    password: z.string().min(1).max(200),
  })
  .strict();

// Agents can read 3,500 customers' phone numbers; a weak password is not an
// acceptable key to that. 12 is the floor, not a target.
export const setPasswordSchema = z
  .object({
    password: z.string().min(12, 'Use at least 12 characters').max(128),
  })
  .strict();

export const dispositionSchema = z
  .object({
    memberId: z.string().uuid(),
    action: z.enum(ACTION_VALUES),
    /** Required by the state machine for callback; validated there. */
    callbackAt: z.string().datetime({ offset: true }).optional(),
    /** POPIA s69 gate: the customer asked for the link on this call. */
    customerRequested: z.boolean().optional(),
    /** Free-text note, stored with opt-outs. */
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

export const importSchema = z
  .object({
    /** Pasted CSV. 2 MB ≈ 20k rows — far above the 3,500-row book. */
    csv: z.string().min(1).max(2_000_000),
    dryRun: z.boolean().default(true),
    campaignSlug: z
      .string()
      .regex(/^[a-z0-9_]{1,60}$/)
      .default('life_cover_gap'),
  })
  .strict();

export type LoginPayload = z.infer<typeof loginSchema>;
export type DispositionPayload = z.infer<typeof dispositionSchema>;
export type ImportPayload = z.infer<typeof importSchema>;
