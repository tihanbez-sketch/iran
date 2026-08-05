import { describe, expect, it } from 'vitest';

import {
  agentRefFromUserId,
  buildAgentQuizUrl,
  smsMessageLink,
  waMessageLink,
} from '@/lib/agent-links';

const ORIGIN = 'https://score.pfl.example';

describe('agentRefFromUserId', () => {
  it('is short, stable and free of hyphens', () => {
    const ref = agentRefFromUserId('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(ref).toBe('a1b2c3d4');
    expect(agentRefFromUserId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(ref);
  });
});

describe('buildAgentQuizUrl', () => {
  it('targets the quiz with agent ref and call-centre attribution', () => {
    const url = new URL(buildAgentQuizUrl(ORIGIN, 'a1b2c3d4', 'life_cover_gap', 'whatsapp'));
    expect(url.pathname).toBe('/quiz');
    expect(url.searchParams.get('ref')).toBe('agent-a1b2c3d4');
    expect(url.searchParams.get('utm_source')).toBe('callcentre');
    expect(url.searchParams.get('utm_medium')).toBe('whatsapp');
    expect(url.searchParams.get('utm_campaign')).toBe('life_cover_gap');
  });

  it('varies the medium by channel', () => {
    const sms = new URL(buildAgentQuizUrl(ORIGIN, 'x', 'life_cover_gap', 'sms'));
    expect(sms.searchParams.get('utm_medium')).toBe('sms');
  });
});

describe('deep links', () => {
  it('wa.me link targets the number digits with the encoded message', () => {
    const link = waMessageLink('+27821234567', 'Hello there: https://x.test/q?a=1&b=2');
    expect(link.startsWith('https://wa.me/27821234567?text=')).toBe(true);
    const text = decodeURIComponent(link.split('?text=')[1]);
    expect(text).toContain('https://x.test/q?a=1&b=2');
  });

  it('sms link keeps the + and encodes the body', () => {
    const link = smsMessageLink('+27821234567', 'Check: https://x.test/q');
    expect(link.startsWith('sms:+27821234567?body=')).toBe(true);
    expect(decodeURIComponent(link.split('?body=')[1])).toBe('Check: https://x.test/q');
  });
});
