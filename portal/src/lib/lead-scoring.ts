/**
 * Lead scoring engine — pure logic.
 *
 * Every tracked interaction carries a point value. The sum across a lead's
 * events is their score; the score puts them in a band that tells the advisor
 * what to do next. Mirrors the `lead_scores` view in
 * supabase/migrations/0001_schema.sql — if you change the weights here, change
 * them there too (the view sums the `points` column, which is written from
 * this table at insert time, so the two stay consistent by construction).
 */

export const EVENT_POINTS = {
  quiz_completed: 20,
  calculator_used: 10,
  policy_uploaded: 40,
  chatbot_qualified: 15,
  // 60, not 50: bookings now arrive from the call centre without a preceding
  // quiz, and a booked call must clear the hot threshold on its own.
  call_booked: 60,
  email_opened: 2,
  email_clicked: 5,
  returned_within_7_days: 10,
  /** Call-centre dispositions. Attempts are our actions and score nothing;
   *  engagement (answered, agreed to a callback) scores. */
  call_attempted: 0,
  call_connected: 5,
  call_no_answer: 0,
  callback_scheduled: 15,
  /** Quiz completed with an agent assisting on a call; same information value
   *  as quiz_completed. metadata.assisted distinguishes the channel. */
  quiz_assisted: 20,
  /** Link sends are our actions, not engagement. */
  sms_link_sent: 0,
  whatsapp_link_sent: 0,
  /** Suppression is not score arithmetic (points cannot be negative) — an
   *  opted-out lead is excluded from the queue by leads.do_not_contact. */
  opted_out: 0,
  /** Tracked for context, deliberately worth nothing on its own. */
  page_view: 0,
  quiz_started: 0,
  /** Funnel event, one per question answered — powers the quiz_funnel view. */
  quiz_question_answered: 0,
  lead_captured: 0,
  report_downloaded: 0,
  /** Strong engagement signal; left at 0 until the weights are retuned. */
  share_clicked: 0,
} as const;

export type EventType = keyof typeof EVENT_POINTS;

export const EVENT_TYPES = Object.keys(EVENT_POINTS) as EventType[];

export function isEventType(value: string): value is EventType {
  return Object.prototype.hasOwnProperty.call(EVENT_POINTS, value);
}

export function pointsFor(eventType: EventType): number {
  return EVENT_POINTS[eventType];
}

export type LeadBand = 'hot' | 'warm' | 'nurture';

export interface LeadBandInfo {
  band: LeadBand;
  label: string;
  action: string;
}

const LEAD_BANDS: Array<LeadBandInfo & { min: number }> = [
  { band: 'hot', min: 60, label: 'Hot', action: 'Call today.' },
  { band: 'warm', min: 30, label: 'Warm', action: 'Nurture and follow up this week.' },
  { band: 'nurture', min: 0, label: 'Nurture', action: 'Nurture sequence only.' },
];

export function bandForScore(score: number): LeadBandInfo {
  const match = LEAD_BANDS.find((b) => score >= b.min) ?? LEAD_BANDS[LEAD_BANDS.length - 1];
  const { min: _min, ...info } = match;
  return info;
}

export interface ScoredEvent {
  eventType: EventType;
  createdAt?: string | Date;
}

/** Total score for a lead from their event history. */
export function scoreEvents(events: ScoredEvent[]): number {
  return events.reduce((total, e) => total + (EVENT_POINTS[e.eventType] ?? 0), 0);
}

export interface LeadScoreSummary {
  score: number;
  band: LeadBand;
  label: string;
  action: string;
  eventCount: number;
}

export function summariseLead(events: ScoredEvent[]): LeadScoreSummary {
  const score = scoreEvents(events);
  const band = bandForScore(score);
  return { score, ...band, eventCount: events.length };
}

/**
 * True when a lead is returning within the 7-day window that earns points.
 *
 * `previousEventAt` is the most recent event *before* the current visit. The
 * award is for coming back after leaving — a second event moments later in the
 * same session is not a return, so anything under an hour is ignored.
 */
export function qualifiesAsReturnVisit(
  previousEventAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!previousEventAt) return false;

  const previous = previousEventAt instanceof Date ? previousEventAt : new Date(previousEventAt);
  if (Number.isNaN(previous.getTime())) return false;

  const elapsedMs = now.getTime() - previous.getTime();
  const ONE_HOUR = 60 * 60 * 1000;
  const SEVEN_DAYS = 7 * 24 * ONE_HOUR;

  return elapsedMs >= ONE_HOUR && elapsedMs <= SEVEN_DAYS;
}
