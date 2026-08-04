/**
 * Referral sharing — the cheapest traffic the portal will ever get.
 *
 * Shared links point at the QUIZ, never at the sharer's report, and carry
 * utm parameters so referred leads attribute correctly. The prefilled message
 * deliberately contains no score and no advice: tests/share.test.ts asserts it
 * passes the same FAIS screening as generated output.
 */

export type ShareChannel = 'whatsapp' | 'native' | 'copy';

export function buildShareUrl(origin: string, channel: ShareChannel): string {
  const url = new URL('/quiz', origin);
  url.searchParams.set('utm_source', channel === 'whatsapp' ? 'whatsapp' : 'share');
  url.searchParams.set('utm_medium', 'referral');
  return url.toString();
}

export function shareMessage(url: string): string {
  return `I just checked my Retirement Health Score — eight questions, two minutes, free. Worth knowing your number: ${url}`;
}

/** wa.me works on both mobile (app) and desktop (WhatsApp Web). */
export function whatsappShareLink(origin: string): string {
  const text = shareMessage(buildShareUrl(origin, 'whatsapp'));
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
