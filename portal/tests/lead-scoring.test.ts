import { describe, expect, it } from 'vitest';

import {
  bandForScore,
  EVENT_POINTS,
  isEventType,
  pointsFor,
  qualifiesAsReturnVisit,
  scoreEvents,
  summariseLead,
  type ScoredEvent,
} from '@/lib/lead-scoring';

function events(...types: Array<keyof typeof EVENT_POINTS>): ScoredEvent[] {
  return types.map((eventType) => ({ eventType }));
}

describe('event weights', () => {
  it.each([
    ['quiz_completed', 20],
    ['calculator_used', 10],
    ['policy_uploaded', 40],
    ['chatbot_qualified', 15],
    ['call_booked', 60],
    ['email_opened', 2],
    ['email_clicked', 5],
    ['returned_within_7_days', 10],
    ['call_connected', 5],
    ['callback_scheduled', 15],
    ['quiz_assisted', 20],
  ] as const)('scores %s at %i points', (eventType, expected) => {
    expect(pointsFor(eventType)).toBe(expected);
  });

  it('has no negative weights', () => {
    for (const points of Object.values(EVENT_POINTS)) {
      expect(points).toBeGreaterThanOrEqual(0);
    }
  });

  it('recognises known event types and rejects unknown ones', () => {
    expect(isEventType('quiz_completed')).toBe(true);
    expect(isEventType('quiz_question_answered')).toBe(true);
    expect(isEventType('share_clicked')).toBe(true);
    expect(isEventType('definitely_not_an_event')).toBe(false);
  });
});

describe('scoreEvents', () => {
  it('scores an empty history as zero', () => {
    expect(scoreEvents([])).toBe(0);
  });

  it('sums a history', () => {
    // 20 + 10 + 2 = 32
    expect(scoreEvents(events('quiz_completed', 'calculator_used', 'email_opened'))).toBe(32);
  });

  it('counts repeat events each time', () => {
    expect(scoreEvents(events('email_opened', 'email_opened', 'email_opened'))).toBe(6);
  });

  it('ignores event types with no weight', () => {
    expect(
      scoreEvents(events('page_view', 'quiz_started', 'quiz_question_answered', 'share_clicked')),
    ).toBe(0);
  });
});

describe('bandForScore', () => {
  it.each([
    [0, 'nurture'],
    [29, 'nurture'],
    [30, 'warm'],
    [59, 'warm'],
    [60, 'hot'],
    [200, 'hot'],
  ] as const)('puts a score of %i in the %s band', (score, expected) => {
    expect(bandForScore(score).band).toBe(expected);
  });

  it('tells the advisor what to do', () => {
    expect(bandForScore(75).action).toMatch(/call today/i);
    expect(bandForScore(45).action).toMatch(/this week/i);
    expect(bandForScore(10).action).toMatch(/nurture/i);
  });
});

describe('summariseLead — worked scenarios', () => {
  it('rates a quiz-only lead as nurture', () => {
    const summary = summariseLead(events('quiz_completed'));
    expect(summary.score).toBe(20);
    expect(summary.band).toBe('nurture');
  });

  it('rates a quiz plus calculator plus return visit as warm', () => {
    // 20 + 10 + 10 = 40
    const summary = summariseLead(
      events('quiz_completed', 'calculator_used', 'returned_within_7_days'),
    );
    expect(summary.score).toBe(40);
    expect(summary.band).toBe('warm');
  });

  it('rates anyone who uploads a policy as hot', () => {
    // 20 + 40 = 60, the hot threshold exactly
    const summary = summariseLead(events('quiz_completed', 'policy_uploaded'));
    expect(summary.score).toBe(60);
    expect(summary.band).toBe('hot');
  });

  it('rates a booked call plus the quiz as hot — the web funnel path', () => {
    // 20 + 60 = 80.
    const summary = summariseLead(events('quiz_completed', 'call_booked'));
    expect(summary.score).toBe(80);
    expect(summary.band).toBe('hot');
  });

  it('rates a bare booked call as hot — the call-centre path', () => {
    // The call centre books discovery calls without a preceding quiz, so a
    // booking must clear the hot threshold on its own. This is why
    // call_booked is 60, not the original 50.
    expect(summariseLead(events('call_booked')).score).toBe(60);
    expect(summariseLead(events('call_booked')).band).toBe('hot');
  });

  it('scores a realistic call-centre journey', () => {
    // connected (5) + callback (15) + connected (5) + booked (60) = 85
    const summary = summariseLead(
      events('call_attempted', 'call_connected', 'callback_scheduled',
             'call_attempted', 'call_connected', 'call_booked'),
    );
    expect(summary.score).toBe(85);
    expect(summary.band).toBe('hot');
  });

  it('reports the event count', () => {
    expect(summariseLead(events('quiz_completed', 'email_opened')).eventCount).toBe(2);
  });
});

describe('qualifiesAsReturnVisit', () => {
  const now = new Date('2026-03-10T12:00:00Z');

  it('is false with no prior event', () => {
    expect(qualifiesAsReturnVisit(null, now)).toBe(false);
    expect(qualifiesAsReturnVisit(undefined, now)).toBe(false);
  });

  it('is false within the same session', () => {
    expect(qualifiesAsReturnVisit(new Date('2026-03-10T11:30:00Z'), now)).toBe(false);
  });

  it('is true for a return the next day', () => {
    expect(qualifiesAsReturnVisit(new Date('2026-03-09T12:00:00Z'), now)).toBe(true);
  });

  it('is true at exactly seven days', () => {
    expect(qualifiesAsReturnVisit(new Date('2026-03-03T12:00:00Z'), now)).toBe(true);
  });

  it('is false beyond seven days', () => {
    expect(qualifiesAsReturnVisit(new Date('2026-03-02T11:59:00Z'), now)).toBe(false);
  });

  it('accepts an ISO string', () => {
    expect(qualifiesAsReturnVisit('2026-03-08T12:00:00Z', now)).toBe(true);
  });

  it('is false for an unparseable date rather than throwing', () => {
    expect(qualifiesAsReturnVisit('not a date', now)).toBe(false);
  });
});
