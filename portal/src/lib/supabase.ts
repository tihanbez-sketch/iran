/**
 * Supabase access — server-side only.
 *
 * Deliberately not exported to the browser. Every write goes through a Next.js
 * API route, so no Supabase key ever reaches the client and the `leads` and
 * `events` tables stay behind RLS with no public read path. That matters for
 * POPIA: lead records are not enumerable from a browser.
 *
 * Uses the service-role key when present (recommended for production) and
 * falls back to the anon key, which the migration grants insert-only access.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { EVENT_POINTS, type EventType } from './lead-scoring';

let cached: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY),
  );
}

export function getSupabase(): SupabaseClient | null {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'pfl-lead-portal' } },
  });
  return cached;
}

/* -------------------------------------------------------------------------- */

export interface LeadRecord {
  full_name: string;
  email: string;
  phone: string | null;
  source: string;
  consent_privacy_at: string;
  consent_marketing: boolean;
  tags: string[];
  /** First-touch channel record; {} when the visitor arrived with none. */
  attribution: Record<string, string>;
}

/**
 * Creates or updates a lead by email.
 *
 * Returning visitors re-submit the quiz, so this upserts rather than erroring
 * on a duplicate. Consent timestamps are refreshed on each capture — POPIA
 * wants the most recent consent on record.
 */
export async function upsertLead(
  record: LeadRecord,
): Promise<{ id: string } | { error: string }> {
  const supabase = getSupabase();
  if (!supabase) return { error: 'Supabase is not configured' };

  const { data, error } = await supabase
    .from('leads')
    .upsert(record, { onConflict: 'email' })
    .select('id')
    .single();

  if (error) return { error: error.message };
  if (!data) return { error: 'Lead upsert returned no row' };
  return { id: data.id as string };
}

export interface EventRecord {
  leadId?: string | null;
  sessionId: string;
  eventType: EventType;
  metadata?: Record<string, unknown>;
}

/**
 * Records a tracked interaction with its point value.
 *
 * Points are written at insert time from the single source of truth in
 * ./lead-scoring.ts, so the `lead_scores` view is a plain SUM and the weights
 * cannot drift between app and database.
 */
export async function recordEvent(event: EventRecord): Promise<{ error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { error: 'Supabase is not configured' };

  const { error } = await supabase.from('events').insert({
    lead_id: event.leadId ?? null,
    session_id: event.sessionId,
    event_type: event.eventType,
    metadata: event.metadata ?? {},
    points: EVENT_POINTS[event.eventType] ?? 0,
  });

  return error ? { error: error.message } : {};
}

/**
 * Back-fills the lead id onto events captured before the visitor identified
 * themselves, so the quiz they completed anonymously still scores.
 */
export async function attachSessionEventsToLead(
  sessionId: string,
  leadId: string,
): Promise<{ error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { error: 'Supabase is not configured' };

  const { error } = await supabase
    .from('events')
    .update({ lead_id: leadId })
    .eq('session_id', sessionId)
    .is('lead_id', null);

  return error ? { error: error.message } : {};
}

/** Most recent event for a session, used to award the 7-day return visit. */
export async function lastEventAtForSession(sessionId: string): Promise<Date | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('events')
    .select('created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.created_at) return null;
  return new Date(data.created_at as string);
}
