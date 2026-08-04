import { describe, expect, it } from 'vitest';

import { hasCampaignData, parseAttributionParams } from '@/lib/attribution';

describe('parseAttributionParams', () => {
  it('maps utm parameters to short field names', () => {
    expect(
      parseAttributionParams('?utm_source=whatsapp&utm_medium=referral&utm_campaign=gepf-schools'),
    ).toEqual({ source: 'whatsapp', medium: 'referral', campaign: 'gepf-schools' });
  });

  it('captures the short ref code used on posters and QR codes', () => {
    expect(parseAttributionParams('?ref=staffroom-poster')).toEqual({ ref: 'staffroom-poster' });
  });

  it('ignores parameters it does not know', () => {
    expect(parseAttributionParams('?utm_source=fb&fbclid=abc123&gclid=xyz&page=2')).toEqual({
      source: 'fb',
    });
  });

  it('returns an empty object for no parameters', () => {
    expect(parseAttributionParams('')).toEqual({});
    expect(parseAttributionParams('?')).toEqual({});
  });

  it('trims whitespace and drops values that end up empty', () => {
    expect(parseAttributionParams('?utm_source=%20%20&utm_medium=email')).toEqual({
      medium: 'email',
    });
  });

  it('caps runaway values at 150 characters', () => {
    const long = 'x'.repeat(500);
    const parsed = parseAttributionParams(`?utm_campaign=${long}`);
    expect(parsed.campaign).toHaveLength(150);
  });

  it('strips control characters', () => {
    const parsed = parseAttributionParams('?utm_source=what%00sapp%0A');
    expect(parsed.source).toBe('whatsapp');
  });
});

describe('hasCampaignData', () => {
  it('is true for any channel-identifying field', () => {
    expect(hasCampaignData({ source: 'whatsapp' })).toBe(true);
    expect(hasCampaignData({ medium: 'referral' })).toBe(true);
    expect(hasCampaignData({ campaign: 'tax-yearend' })).toBe(true);
    expect(hasCampaignData({ ref: 'poster' })).toBe(true);
  });

  it('is false for an organic visit (referrer and landing only)', () => {
    expect(hasCampaignData({ referrer: 'google.com', landing: '/quiz' })).toBe(false);
    expect(hasCampaignData({})).toBe(false);
    expect(hasCampaignData(null)).toBe(false);
    expect(hasCampaignData(undefined)).toBe(false);
  });
});
