/**
 * /agents/queue — the working screen: one next-call card, then what's coming.
 *
 * The list is the campaign_queue view, which has already excluded DNC,
 * attempt-capped, cooling-off and not-yet-due members — if a customer shows
 * here, calling them is allowed. Ordering: due callbacks, then priority,
 * then least-recently-attempted.
 */

import Link from 'next/link';

import { NextCallCard, type SendLink } from '@/components/agent/NextCallCard';
import { NotProvisioned } from '@/components/agent/NotProvisioned';
import { StatusPill } from '@/components/agent/StatusPill';
import { fetchQueue, type QueueMember } from '@/lib/agent-data';
import {
  agentRefFromUserId,
  buildAgentQuizUrl,
  smsMessageLink,
  waMessageLink,
} from '@/lib/agent-links';
import {
  OPT_OUT_CONFIRMATION,
  OUTBOUND_MESSAGES,
  SCRIPT_OPENING,
  TALKING_POINTS,
  type CampaignSlug,
} from '@/lib/call-scripts';
import { getAuthenticatedAgent } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const ZA_MOBILE = /^\+27[678]\d{8}$/;

function quizSendLinks(member: QueueMember, agentUserId: string): SendLink[] {
  if (!member.phone || !ZA_MOBILE.test(member.phone)) return [];
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const ref = agentRefFromUserId(agentUserId);

  const waUrl = buildAgentQuizUrl(origin, ref, member.campaign_slug, 'whatsapp');
  const smsUrl = buildAgentQuizUrl(origin, ref, member.campaign_slug, 'sms');

  return [
    {
      label: 'WhatsApp',
      action: 'link_sent_whatsapp',
      href: waMessageLink(member.phone, OUTBOUND_MESSAGES.whatsappQuizInvite(waUrl)),
    },
    {
      label: 'SMS',
      action: 'link_sent_sms',
      href: smsMessageLink(member.phone, OUTBOUND_MESSAGES.smsQuizInvite(smsUrl)),
    },
  ];
}

const WHEN = new Intl.DateTimeFormat('en-ZA', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Johannesburg',
});

export default async function QueuePage() {
  const agent = await getAuthenticatedAgent();
  if (!agent) return <NotProvisioned />;

  const queue = await fetchQueue(agent.client, { limit: 11 });
  if (!queue.ok) {
    return (
      <p role="alert" className="rounded-lg bg-alert/10 px-4 py-3 text-alert">
        The queue could not be loaded: {queue.error}
      </p>
    );
  }

  const [next, ...upcoming] = queue.members;

  if (!next) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-white p-8 text-center">
        <h1 className="text-2xl font-semibold text-ink">Queue is clear</h1>
        <p className="mt-3 text-ink-soft">
          No workable customers right now — everyone is either done, waiting on a callback time, or
          inside the retry cooldown. Check the{' '}
          <Link href="/agents/campaign" className="underline underline-offset-4">
            campaign numbers
          </Link>
          .
        </p>
      </div>
    );
  }

  const talkingPoints =
    TALKING_POINTS[next.campaign_slug as CampaignSlug] ?? TALKING_POINTS.life_cover_gap;

  return (
    <div>
      <NextCallCard
        member={next}
        scriptOpening={SCRIPT_OPENING}
        talkingPoints={talkingPoints}
        optOutConfirmation={OPT_OUT_CONFIRMATION}
        sendLinks={quizSendLinks(next, agent.user.id)}
      />

      {upcoming.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">Up next</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-130 border-collapse bg-white text-sm">
              <thead>
                <tr className="bg-parchment-deep text-left">
                  <th className="px-4 py-2.5 font-medium text-ink">Customer</th>
                  <th className="px-4 py-2.5 font-medium text-ink">Priority</th>
                  <th className="px-4 py-2.5 font-medium text-ink">Attempts</th>
                  <th className="px-4 py-2.5 font-medium text-ink">Status</th>
                  <th className="px-4 py-2.5 font-medium text-ink">Callback</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((member) => (
                  <tr key={member.member_id} className="border-t border-line">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/agents/leads/${member.lead_id}`}
                        className="font-medium text-ink underline-offset-4 hover:underline"
                      >
                        {member.full_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink-soft">
                      {member.priority_score}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink-soft">{member.attempts}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={member.status} />
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">
                      {member.callback_at ? WHEN.format(new Date(member.callback_at)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
