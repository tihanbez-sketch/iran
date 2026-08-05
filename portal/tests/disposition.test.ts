import { describe, expect, it } from 'vitest';

import {
  applyDisposition,
  DISPOSITIONS,
  TERMINAL_STATUSES,
  type DispositionAction,
  type MemberStatus,
} from '@/lib/disposition';

const NOW = new Date('2026-08-05T10:00:00Z');
const FUTURE = new Date('2026-08-07T09:00:00Z');
const CAMPAIGN = { maxAttempts: 3 };

function member(status: MemberStatus = 'queued', attempts = 0) {
  return { status, attempts };
}

describe('terminal statuses', () => {
  it.each(TERMINAL_STATUSES.map((s) => [s] as const))(
    'rejects every action from %s',
    (status) => {
      for (const action of Object.keys(DISPOSITIONS) as DispositionAction[]) {
        const result = applyDisposition(member(status), CAMPAIGN, action, {}, NOW);
        expect(result.ok).toBe(false);
      }
    },
  );
});

describe('no_answer', () => {
  it('increments attempts and stays workable below the cap', () => {
    const result = applyDisposition(member('queued', 0), CAMPAIGN, 'no_answer', {}, NOW);
    if (!result.ok) throw new Error(result.error);
    expect(result.member.attempts).toBe(1);
    expect(result.member.status).toBeUndefined(); // unchanged
    expect(result.member.last_attempt_at).toBe(NOW.toISOString());
    expect(result.events).toEqual(['call_attempted', 'call_no_answer']);
    expect(result.leadPatch).toBeUndefined();
  });

  it('exhausts the member on the final allowed attempt', () => {
    const result = applyDisposition(member('queued', 2), CAMPAIGN, 'no_answer', {}, NOW);
    if (!result.ok) throw new Error(result.error);
    expect(result.member.attempts).toBe(3);
    expect(result.member.status).toBe('exhausted');
  });
});

describe('connected_not_interested', () => {
  it('stops the campaign for this member without suppressing the lead', () => {
    const result = applyDisposition(member(), CAMPAIGN, 'connected_not_interested', {}, NOW);
    if (!result.ok) throw new Error(result.error);
    expect(result.member.status).toBe('exhausted');
    expect(result.leadPatch).toBeUndefined(); // NOT an opt-out
    expect(result.events).toContain('call_connected');
  });
});

describe('callback', () => {
  it('requires a future time', () => {
    expect(applyDisposition(member(), CAMPAIGN, 'callback', {}, NOW).ok).toBe(false);
    expect(
      applyDisposition(member(), CAMPAIGN, 'callback', { callbackAt: NOW }, NOW).ok,
    ).toBe(false);
    expect(
      applyDisposition(
        member(),
        CAMPAIGN,
        'callback',
        { callbackAt: new Date('2026-08-01T09:00:00Z') },
        NOW,
      ).ok,
    ).toBe(false);
  });

  it('schedules and records willingness', () => {
    const result = applyDisposition(member(), CAMPAIGN, 'callback', { callbackAt: FUTURE }, NOW);
    if (!result.ok) throw new Error(result.error);
    expect(result.member.status).toBe('callback');
    expect(result.member.callback_at).toBe(FUTURE.toISOString());
    expect(result.events).toEqual(['call_attempted', 'call_connected', 'callback_scheduled']);
  });

  it('exhausts instead of scheduling when the cap is hit', () => {
    const result = applyDisposition(
      member('callback', 2),
      CAMPAIGN,
      'callback',
      { callbackAt: FUTURE },
      NOW,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.member.attempts).toBe(3);
    expect(result.member.status).toBe('exhausted');
  });
});

describe('interested and converted', () => {
  it('interested survives the attempt cap — a hot hand-off is never discarded', () => {
    const result = applyDisposition(member('queued', 2), CAMPAIGN, 'interested', {}, NOW);
    if (!result.ok) throw new Error(result.error);
    expect(result.member.status).toBe('interested');
  });

  it('converted logs the booked call worth 60 points', () => {
    const result = applyDisposition(member(), CAMPAIGN, 'converted', {}, NOW);
    if (!result.ok) throw new Error(result.error);
    expect(result.member.status).toBe('converted');
    expect(result.events).toContain('call_booked');
  });
});

describe('opt_out', () => {
  it('suppresses the lead with reason and timestamp — the POPIA record', () => {
    const result = applyDisposition(
      member(),
      CAMPAIGN,
      'opt_out',
      { reason: 'Asked to never be called again' },
      NOW,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.member.status).toBe('opted_out');
    expect(result.leadPatch).toEqual({
      do_not_contact: true,
      do_not_contact_reason: 'Asked to never be called again',
      do_not_contact_at: NOW.toISOString(),
    });
    expect(result.events).toContain('opted_out');
  });

  it('defaults the reason when none is given', () => {
    const result = applyDisposition(member(), CAMPAIGN, 'opt_out', {}, NOW);
    if (!result.ok) throw new Error(result.error);
    expect(result.leadPatch?.do_not_contact_reason).toMatch(/asked not to be contacted/i);
  });

  it('opt-out is terminal even at the attempt cap', () => {
    const result = applyDisposition(member('queued', 2), CAMPAIGN, 'opt_out', {}, NOW);
    if (!result.ok) throw new Error(result.error);
    expect(result.member.status).toBe('opted_out'); // not clobbered to exhausted
  });
});

describe('link sends — the s69 gate', () => {
  it.each([['link_sent_whatsapp'], ['link_sent_sms']] as const)(
    '%s is rejected without the recorded customer request',
    (action) => {
      const result = applyDisposition(member(), CAMPAIGN, action, {}, NOW);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/asked for one/i);
    },
  );

  it('does not touch attempts, status or last_attempt_at', () => {
    const result = applyDisposition(
      member('callback', 1),
      CAMPAIGN,
      'link_sent_whatsapp',
      { customerRequested: true },
      NOW,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.member.status).toBeUndefined();
    expect(result.member.attempts).toBeUndefined();
    expect(result.member.last_attempt_at).toBeUndefined();
    expect(result.member.callback_at).toBeUndefined(); // callback stays scheduled
    expect(result.events).toEqual(['whatsapp_link_sent']);
  });

  it('grants the channel on the lead', () => {
    const wa = applyDisposition(
      member(),
      CAMPAIGN,
      'link_sent_whatsapp',
      { customerRequested: true },
      NOW,
    );
    const sms = applyDisposition(
      member(),
      CAMPAIGN,
      'link_sent_sms',
      { customerRequested: true },
      NOW,
    );
    if (!wa.ok || !sms.ok) throw new Error('expected ok');
    expect(wa.leadPatch).toEqual({ add_channel: 'whatsapp' });
    expect(sms.leadPatch).toEqual({ add_channel: 'sms' });
  });
});

describe('leaving callback state', () => {
  it('clears the stale callback time on a non-callback outcome', () => {
    const result = applyDisposition(
      { status: 'callback', attempts: 1, callback_at: '2026-08-04T09:00:00Z' },
      CAMPAIGN,
      'converted',
      {},
      NOW,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.member.callback_at).toBeNull();
  });
});
