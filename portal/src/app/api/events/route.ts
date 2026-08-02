/**
 * POST /api/events
 *
 * Generic interaction tracking. Point values are assigned server-side from
 * src/lib/lead-scoring.ts — the client sends an event type, never a score, so
 * a lead's score cannot be inflated from the browser.
 */

import { NextResponse } from 'next/server';

import { isEventType } from '@/lib/lead-scoring';
import { isSupabaseConfigured, recordEvent } from '@/lib/supabase';
import { eventSchema, fieldErrors } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid event', fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const { eventType, sessionId, leadId, metadata } = parsed.data;
  if (!isEventType(eventType)) {
    return NextResponse.json({ error: 'Unknown event type' }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    // Tracking is not worth surfacing an error to a visitor over.
    return NextResponse.json({ recorded: false }, { status: 202 });
  }

  const { error } = await recordEvent({ leadId, sessionId, eventType, metadata });
  if (error) {
    console.error('[events] insert failed', error);
    return NextResponse.json({ recorded: false }, { status: 202 });
  }

  return NextResponse.json({ recorded: true });
}
