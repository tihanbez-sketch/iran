/**
 * /agents/leads/[id] — full customer detail: identity, consent state,
 * holdings, campaign membership with the priority breakdown, and the event
 * timeline. Read entirely through the agent's RLS-constrained client.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NotProvisioned } from '@/components/agent/NotProvisioned';
import { StatusPill } from '@/components/agent/StatusPill';
import { BreakdownBars } from '@/components/ScoreGauge';
import { fetchLeadDetail } from '@/lib/agent-data';
import { reasonsToBreakdown } from '@/lib/campaign-priority';
import { getAuthenticatedAgent } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WHEN = new Intl.DateTimeFormat('en-ZA', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Johannesburg',
});
const DAY = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeZone: 'Africa/Johannesburg' });

const AGE_LABELS: Record<string, string> = {
  under_30: 'Under 30',
  '30_39': '30–39',
  '40_49': '40–49',
  '50_59': '50–59',
  '60_plus': '60+',
};

function rand(cents: number | null): string {
  return cents === null ? '—' : `R${(cents / 100).toFixed(2)}`;
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const agent = await getAuthenticatedAgent();
  if (!agent) return <NotProvisioned />;

  const result = await fetchLeadDetail(agent.client, id);
  if (!result.ok) {
    if (result.error === 'Lead not found') notFound();
    return (
      <p role="alert" className="rounded-lg bg-alert/10 px-4 py-3 text-alert">
        Could not load this customer: {result.error}
      </p>
    );
  }

  const { lead, policies, events, memberships } = result.detail;

  return (
    <div className="space-y-6">
      <p>
        <Link href="/agents/queue" className="text-sm text-ink-soft underline underline-offset-4">
          ← Back to the queue
        </Link>
      </p>

      {lead.do_not_contact && (
        <div
          role="alert"
          className="rounded-2xl border border-alert bg-alert/10 p-5 text-sm text-alert"
        >
          <strong className="font-semibold">Do not contact.</strong>{' '}
          {lead.do_not_contact_reason ?? 'Suppressed.'}{' '}
          {lead.do_not_contact_at && `Recorded ${WHEN.format(new Date(lead.do_not_contact_at))}.`}
        </div>
      )}

      <section className="rounded-2xl border border-line bg-white p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-3xl font-semibold text-ink">{lead.full_name}</h1>
          {lead.age_band && (
            <span className="rounded-full bg-parchment-deep px-2.5 py-0.5 text-xs font-medium text-ink-soft">
              {AGE_LABELS[lead.age_band] ?? lead.age_band}
            </span>
          )}
        </div>

        <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-muted">Phone</dt>
            <dd className="font-medium text-ink">
              {lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Email</dt>
            <dd className="font-medium text-ink">{lead.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Source</dt>
            <dd className="font-medium text-ink">{lead.source.replace(/_/g, ' ')}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Consent basis</dt>
            <dd className="font-medium text-ink">
              {lead.consent_basis === 'existing_customer'
                ? 'Existing customer (own book)'
                : 'Web form'}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">May be contacted by</dt>
            <dd className="font-medium text-ink">{lead.channel_consent.join(', ')}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">On record since</dt>
            <dd className="font-medium text-ink">{DAY.format(new Date(lead.created_at))}</dd>
          </div>
        </dl>

        {lead.tags.length > 0 && (
          <ul className="mt-4 flex list-none flex-wrap gap-2 p-0">
            {lead.tags.map((tag) => (
              <li
                key={tag}
                className="rounded-full border border-line bg-parchment px-3 py-1 text-xs text-ink-soft"
              >
                {tag.replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
        )}

        {lead.advisor_notes && (
          <p className="mt-4 rounded-xl bg-parchment p-4 text-sm text-ink-soft">
            {lead.advisor_notes}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-white p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-ink">Holdings</h2>
        {policies.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">No policies on record.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-120 border-collapse text-sm">
              <thead>
                <tr className="bg-parchment-deep text-left">
                  <th className="px-4 py-2.5 font-medium text-ink">Product</th>
                  <th className="px-4 py-2.5 font-medium text-ink">Policy number</th>
                  <th className="px-4 py-2.5 font-medium text-ink">Premium</th>
                  <th className="px-4 py-2.5 font-medium text-ink">Since</th>
                  <th className="px-4 py-2.5 font-medium text-ink">Status</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <tr key={policy.id} className="border-t border-line">
                    <td className="px-4 py-2.5 font-medium text-ink capitalize">
                      {policy.product_type}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{policy.policy_number}</td>
                    <td className="px-4 py-2.5 tabular-nums text-ink-soft">
                      {rand(policy.premium_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">
                      {policy.start_date ? DAY.format(new Date(policy.start_date)) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={policy.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {memberships.map((membership) => (
        <section key={membership.id} className="rounded-2xl border border-line bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">{membership.campaign.name}</h2>
            <StatusPill status={membership.status} />
          </div>
          <p className="mt-2 text-sm text-ink-soft">
            Priority {membership.priority_score}/100 · {membership.attempts} attempt
            {membership.attempts === 1 ? '' : 's'}
            {membership.callback_at &&
              ` · callback ${WHEN.format(new Date(membership.callback_at))}`}
          </p>
          <div className="mt-4">
            <BreakdownBars
              breakdown={reasonsToBreakdown({
                score: membership.priority_score,
                reasons: membership.priority_reasons,
              })}
            />
          </div>
        </section>
      ))}

      <section className="rounded-2xl border border-line bg-white p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-ink">Recent activity</h2>
        {events.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">Nothing recorded yet.</p>
        ) : (
          <ol className="mt-3 list-none space-y-2 p-0 text-sm">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-ink-muted tabular-nums">
                  {WHEN.format(new Date(event.created_at))}
                </span>
                <span className="font-medium text-ink">{event.event_type.replace(/_/g, ' ')}</span>
                {event.points > 0 && <span className="text-ink-muted">+{event.points}</span>}
                {typeof event.metadata?.action === 'string' && (
                  <span className="text-ink-muted">({event.metadata.action})</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
