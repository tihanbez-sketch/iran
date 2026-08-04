import { describe, expect, it } from 'vitest';

import { screenText } from '@/lib/compliance';
import { buildShareUrl, shareMessage, whatsappShareLink } from '@/lib/share';

const ORIGIN = 'https://portal.pfl.example';

describe('buildShareUrl', () => {
  it('points at the quiz, never at the report', () => {
    const url = new URL(buildShareUrl(ORIGIN, 'copy'));
    expect(url.pathname).toBe('/quiz');
  });

  it('tags WhatsApp shares so referred leads attribute to whatsapp', () => {
    const url = new URL(buildShareUrl(ORIGIN, 'whatsapp'));
    expect(url.searchParams.get('utm_source')).toBe('whatsapp');
    expect(url.searchParams.get('utm_medium')).toBe('referral');
  });

  it('tags other channels as generic share referrals', () => {
    for (const channel of ['native', 'copy'] as const) {
      const url = new URL(buildShareUrl(ORIGIN, channel));
      expect(url.searchParams.get('utm_source')).toBe('share');
      expect(url.searchParams.get('utm_medium')).toBe('referral');
    }
  });
});

describe('shareMessage', () => {
  it('contains the link', () => {
    const url = buildShareUrl(ORIGIN, 'whatsapp');
    expect(shareMessage(url)).toContain(url);
  });

  it('passes the same FAIS screening as generated output', () => {
    // The prefilled message is portal-authored text a visitor forwards on.
    // It must clear the product/guarantee/advice rules like everything else.
    const message = shareMessage(buildShareUrl(ORIGIN, 'whatsapp'));
    const result = screenText(message);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('never includes a score or personal details', () => {
    const message = shareMessage(buildShareUrl(ORIGIN, 'copy'));
    expect(message).not.toMatch(/\b\d{1,3}\s*(?:\/|out of)\s*100\b/i);
  });
});

describe('whatsappShareLink', () => {
  it('is a wa.me link with the message url-encoded', () => {
    const link = whatsappShareLink(ORIGIN);
    expect(link.startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(link.slice('https://wa.me/?text='.length));
    expect(text).toContain('utm_source=whatsapp');
    expect(text).toContain(`${ORIGIN}/quiz`);
  });
});
