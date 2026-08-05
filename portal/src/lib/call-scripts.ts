/**
 * Call-centre scripts, talking points and outbound message templates.
 *
 * This file is the compliance officer's sign-off surface for the outbound
 * motion, exactly as insight-templates.ts is for the quiz. Rules:
 *
 *   - Every string here must pass screenText() — tests/call-scripts.test.ts
 *     asserts it, so a non-compliant edit fails the build.
 *   - Talking points are factual and educational. The advice conversation
 *     belongs to a licensed advisor, and the scripts say so.
 *   - [CONFIRM] placeholders are the compliance officer's to fill, same
 *     device as the privacy notice.
 *   - Keep each string under 400 characters (the screener's length cap).
 */

export type CampaignSlug = 'life_cover_gap';

/**
 * Opening lines, read in order. FAIS disclosure, the reason for the call,
 * and the opt-out offer come before anything else.
 */
export const SCRIPT_OPENING: string[] = [
  'Good day, may I speak to [customer name]? My name is [agent name], calling from PFL Financial Advisors — you hold your funeral policy with us.',
  'PFL Financial Advisors is an authorised financial services provider, FSP number [CONFIRM — FSP number].',
  'This is a short courtesy call about the protection side of your policy. It is general information, not advice, and if you would rather we did not call again, just say so and we will mark it immediately.',
  'Do you have two or three minutes?',
];

/**
 * Per-campaign talking points. Factual observations the agent may use in
 * conversation — each one describes how things work, never what this
 * customer should do.
 */
export const TALKING_POINTS: Record<CampaignSlug, string[]> = {
  life_cover_gap: [
    'A funeral policy is designed to cover the costs of a funeral. It is generally not designed to replace an income for the years after a breadwinner passes away.',
    'Many families find there is a difference between what a funeral policy pays out and what dependants would need to keep the household running month to month.',
    'Life cover and funeral cover answer different questions: one covers an event, the other helps replace an income. Many people hold both for that reason.',
    'A licensed advisor can work out what that difference looks like for a specific family. The conversation costs nothing and there is no obligation to take anything up.',
    'There is also a free two-minute financial health check on our website that shows where a plan stands. I can send the link if you would like to try it.',
  ],
};

/**
 * What the agent says when closing an opt-out — read back so the customer
 * hears the suppression being recorded.
 */
export const OPT_OUT_CONFIRMATION =
  'Understood — I am marking right now that we should not contact you about this again. You will stay covered exactly as before, and this does not affect your policy in any way.';

/**
 * Outbound message templates (sent only when the customer asked for the link
 * on the call — the send buttons require that confirmation). Every message
 * carries the opt-out line POPIA requires.
 */
export const OUTBOUND_MESSAGES = {
  whatsappQuizInvite(url: string): string {
    return `Thank you for taking my call today. Here is the free two-minute financial health check from PFL Financial Advisors that we spoke about: ${url} — Reply STOP if you would rather not receive messages from us.`;
  },
  smsQuizInvite(url: string): string {
    return `PFL Financial Advisors: as discussed on our call, your free 2-minute financial health check is here: ${url} Reply STOP to opt out.`;
  },
} as const;

/** Every screenable string in this file, for the compliance test. */
export function allScriptStrings(): string[] {
  return [
    ...SCRIPT_OPENING,
    ...Object.values(TALKING_POINTS).flat(),
    OPT_OUT_CONFIRMATION,
    OUTBOUND_MESSAGES.whatsappQuizInvite('https://example.test/quiz'),
    OUTBOUND_MESSAGES.smsQuizInvite('https://example.test/quiz'),
  ];
}
