/**
 * POST /api/leads
 *
 * Captures contact details to unlock the full report, and stitches the
 * anonymous events from this session onto the new lead so the quiz they
 * already completed counts towards their score.
 *
 * POPIA: consentPrivacy must be explicitly true — the schema rejects anything
 * else — and the acceptance timestamp is written to the lead record.
 */

import { NextResponse } from 'next/server';

import { scoreQuiz, type QuizAnswers } from '@/lib/scoring';
import {
  attachSessionEventsToLead,
  isSupabaseConfigured,
  recordEvent,
  upsertLead,
} from '@/lib/supabase';
import { fieldErrors, leadCaptureSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = leadCaptureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please check the details below', fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const { fullName, email, phone, sessionId, answers, consentMarketing, source } = parsed.data;

  if (!isSupabaseConfigured()) {
    // Explicit rather than a silent success — a lost lead is worse than a
    // visible error the team can act on.
    console.error('[leads] Supabase is not configured; lead was not saved', { email });
    return NextResponse.json(
      { error: 'We could not save your details just now. Please try again shortly.' },
      { status: 503 },
    );
  }

  // Tags come from the scored quiz, so nurture routing is set at capture time.
  const result = scoreQuiz(answers as QuizAnswers);

  const lead = await upsertLead({
    full_name: fullName,
    email,
    phone: phone && phone.length > 0 ? phone : null,
    source,
    consent_privacy_at: new Date().toISOString(),
    consent_marketing: consentMarketing,
    tags: result.tags,
  });

  if ('error' in lead) {
    console.error('[leads] upsert failed', lead.error);
    return NextResponse.json(
      { error: 'We could not save your details just now. Please try again shortly.' },
      { status: 502 },
    );
  }

  // Best-effort from here — the lead exists, which is the part that matters.
  try {
    await attachSessionEventsToLead(sessionId, lead.id);
    await recordEvent({
      leadId: lead.id,
      sessionId,
      eventType: 'lead_captured',
      metadata: { source, score: result.score, band: result.band, consentMarketing },
    });
  } catch (error) {
    console.error('[leads] post-capture bookkeeping failed', error);
  }

  return NextResponse.json({ leadId: lead.id, tags: result.tags });
}
