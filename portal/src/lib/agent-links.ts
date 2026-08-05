/**
 * Links the call centre sends — always the quiz, always attributed.
 *
 * Rides the existing first-touch attribution unchanged: ?ref= identifies the
 * agent, utm_source=callcentre identifies the channel, utm_campaign ties the
 * resulting lead activity back to the campaign.
 */

export type SendChannel = 'whatsapp' | 'sms';

/** Short, stable, non-identifying agent reference from the auth user id. */
export function agentRefFromUserId(userId: string): string {
  return userId.replace(/-/g, '').slice(0, 8);
}

export function buildAgentQuizUrl(
  origin: string,
  agentRef: string,
  campaignSlug: string,
  channel: SendChannel,
): string {
  const url = new URL('/quiz', origin);
  url.searchParams.set('ref', `agent-${agentRef}`);
  url.searchParams.set('utm_source', 'callcentre');
  url.searchParams.set('utm_medium', channel);
  url.searchParams.set('utm_campaign', campaignSlug);
  return url.toString();
}

/** wa.me deep link to a specific number with a prefilled message. */
export function waMessageLink(phoneE164: string, message: string): string {
  const digits = phoneE164.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * sms: deep link. Android accepts `?body=`; iOS historically wanted `&body`
 * after a recipient — modern iOS accepts `?body=` too, which is why we use it.
 */
export function smsMessageLink(phoneE164: string, message: string): string {
  return `sms:${phoneE164}?body=${encodeURIComponent(message)}`;
}
