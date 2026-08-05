import { describe, expect, it } from 'vitest';

import { ATTEMPT_POLICY, isCallable } from '@/lib/campaign-rules';

const NOW = new Date('2026-08-05T10:00:00Z');
const CAMPAIGN = { maxAttempts: 3, retryCooldownDays: 4 };

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('ATTEMPT_POLICY', () => {
  it('caps at 3 attempts in a 14-day window with 4-day cooldowns', () => {
    expect(ATTEMPT_POLICY.maxAttempts).toBe(3);
    expect(ATTEMPT_POLICY.windowDays).toBe(14);
    expect(ATTEMPT_POLICY.retryCooldownDays).toBe(4);
    // Internal consistency: max attempts with cooldowns fit in the window.
    expect((ATTEMPT_POLICY.maxAttempts - 1) * ATTEMPT_POLICY.retryCooldownDays).toBeLessThanOrEqual(
      ATTEMPT_POLICY.windowDays,
    );
  });
});

describe('isCallable', () => {
  it('allows a fresh queued member', () => {
    expect(
      isCallable({ status: 'queued', attempts: 0, lastAttemptAt: null, callbackAt: null }, CAMPAIGN, NOW),
    ).toEqual({ callable: true });
  });

  it.each([['contacted'], ['interested'], ['converted'], ['opted_out'], ['exhausted']])(
    'blocks status %s',
    (status) => {
      const verdict = isCallable(
        { status, attempts: 0, lastAttemptAt: null, callbackAt: null },
        CAMPAIGN,
        NOW,
      );
      expect(verdict).toEqual({ callable: false, reason: 'terminal_status' });
    },
  );

  it('blocks a callback that is not yet due', () => {
    const verdict = isCallable(
      { status: 'callback', attempts: 1, lastAttemptAt: daysAgo(5), callbackAt: daysAgo(-1) },
      CAMPAIGN,
      NOW,
    );
    expect(verdict).toEqual({ callable: false, reason: 'callback_not_due' });
  });

  it('allows a due callback', () => {
    const verdict = isCallable(
      { status: 'callback', attempts: 1, lastAttemptAt: daysAgo(5), callbackAt: daysAgo(1) },
      CAMPAIGN,
      NOW,
    );
    expect(verdict).toEqual({ callable: true });
  });

  it('blocks at the attempt cap', () => {
    const verdict = isCallable(
      { status: 'queued', attempts: 3, lastAttemptAt: daysAgo(10), callbackAt: null },
      CAMPAIGN,
      NOW,
    );
    expect(verdict).toEqual({ callable: false, reason: 'attempt_cap_reached' });
  });

  it('enforces the cooldown boundary exactly', () => {
    const justInside = isCallable(
      { status: 'queued', attempts: 1, lastAttemptAt: daysAgo(3.9), callbackAt: null },
      CAMPAIGN,
      NOW,
    );
    const justOutside = isCallable(
      { status: 'queued', attempts: 1, lastAttemptAt: daysAgo(4.1), callbackAt: null },
      CAMPAIGN,
      NOW,
    );
    expect(justInside).toEqual({ callable: false, reason: 'cooldown_active' });
    expect(justOutside).toEqual({ callable: true });
  });

  it('treats an unparseable last attempt as no cooldown rather than throwing', () => {
    const verdict = isCallable(
      { status: 'queued', attempts: 1, lastAttemptAt: 'garbage', callbackAt: null },
      CAMPAIGN,
      NOW,
    );
    expect(verdict.callable).toBe(true);
  });
});
