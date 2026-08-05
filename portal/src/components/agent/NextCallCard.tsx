'use client';

/**
 * The next-call card — the agent's whole working surface for one customer.
 *
 * Everything an agent may do funnels through POST /api/agent/disposition and
 * the DISPOSITIONS state machine; this component is buttons and confirmation
 * steps around it. Two actions get a deliberate second step: callbacks (need
 * a time) and opt-outs (read the confirmation line aloud, then confirm —
 * that read-back IS the POPIA suppression conversation). Link sends sit
 * behind the s69 checkbox: the customer asked for the link on this call.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { QueueMember } from '@/lib/agent-data';
import type { DispositionAction } from '@/lib/disposition';

export interface SendLink {
  label: string;
  href: string;
  action: 'link_sent_whatsapp' | 'link_sent_sms';
}

interface NextCallCardProps {
  member: QueueMember;
  scriptOpening: string[];
  talkingPoints: string[];
  optOutConfirmation: string;
  sendLinks: SendLink[];
}

const AGE_LABELS: Record<string, string> = {
  under_30: 'Under 30',
  '30_39': '30–39',
  '40_49': '40–49',
  '50_59': '50–59',
  '60_plus': '60+',
};

type Feedback = { kind: 'ok' | 'error'; text: string };

export function NextCallCard({
  member,
  scriptOpening,
  talkingPoints,
  optOutConfirmation,
  sendLinks,
}: NextCallCardProps) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'callback' | 'optout'>('idle');
  const [callbackAt, setCallbackAt] = useState('');
  const [reason, setReason] = useState('');
  const [customerRequested, setCustomerRequested] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function send(
    action: DispositionAction,
    extra: Record<string, unknown> = {},
  ): Promise<boolean> {
    setBusy(action);
    setFeedback(null);
    try {
      const res = await fetch('/api/agent/disposition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: member.member_id, action, ...extra }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFeedback({ kind: 'error', text: data.error ?? 'Could not save. Try again.' });
        return false;
      }
      return true;
    } catch {
      setFeedback({ kind: 'error', text: 'Network problem — the outcome was NOT saved.' });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function complete(action: DispositionAction, extra: Record<string, unknown> = {}) {
    if (await send(action, extra)) {
      setFeedback({ kind: 'ok', text: 'Saved — loading the next call…' });
      setMode('idle');
      setCallbackAt('');
      setReason('');
      setCustomerRequested(false);
      router.refresh();
    }
  }

  function sendQuizLink(link: SendLink) {
    // Open first: the window must open inside the click gesture or popup
    // blockers eat it. The disposition records the send right after.
    window.open(link.href, '_blank', 'noopener');
    void send(link.action, { customerRequested: true }).then((ok) => {
      if (ok) setFeedback({ kind: 'ok', text: `${link.label} message opened and recorded.` });
    });
  }

  const disabled = busy !== null;
  const actionButton =
    'rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-parchment-deep disabled:opacity-50';

  return (
    <section className="rounded-2xl border border-line bg-white p-6 sm:p-8">
      <p className="text-sm font-medium tracking-wide text-gold uppercase">Next call</p>

      {/* Who */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-2xl font-semibold text-ink">{member.full_name}</h2>
        {member.age_band && (
          <span className="rounded-full bg-parchment-deep px-2.5 py-0.5 text-xs font-medium text-ink-soft">
            {AGE_LABELS[member.age_band] ?? member.age_band}
          </span>
        )}
        {member.callback_due && (
          <span className="rounded-full bg-gold-soft px-2.5 py-0.5 text-xs font-medium text-ink">
            Callback due
          </span>
        )}
      </div>

      {member.phone && (
        <a
          href={`tel:${member.phone}`}
          className="mt-2 inline-block text-xl font-semibold tracking-wide text-ink underline-offset-4 hover:underline"
        >
          {member.phone}
        </a>
      )}

      <p className="mt-1 text-sm text-ink-muted">
        Attempt {member.attempts + 1} · May be contacted by: {member.channel_consent.join(', ')} ·{' '}
        <a href={`/agents/leads/${member.lead_id}`} className="underline underline-offset-4">
          full history
        </a>
      </p>

      {/* Why this customer */}
      <div className="mt-5">
        <p className="text-sm font-medium text-ink">
          Priority {member.priority_score}/100
        </p>
        <ul className="mt-2 flex list-none flex-wrap gap-2 p-0">
          {member.priority_reasons.map((r) => (
            <li
              key={`${r.dimension}-${r.label}`}
              className="rounded-full border border-line bg-parchment px-3 py-1 text-xs text-ink-soft"
            >
              {r.label}
            </li>
          ))}
          {member.engagement_score > 0 && (
            <li className="rounded-full border border-gold-soft bg-gold-soft/40 px-3 py-1 text-xs text-ink">
              Engagement score {member.engagement_score}
            </li>
          )}
        </ul>
      </div>

      {/* Script */}
      <details open className="mt-6 rounded-xl border border-line bg-parchment p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">Opening script</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink-soft">
          {scriptOpening.map((line) => (
            <li key={line.slice(0, 40)}>{line}</li>
          ))}
        </ol>
      </details>

      <details className="mt-3 rounded-xl border border-line bg-parchment p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">Talking points</summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-soft">
          {talkingPoints.map((point) => (
            <li key={point.slice(0, 40)}>{point}</li>
          ))}
        </ul>
      </details>

      {/* Outcome buttons */}
      <div className="mt-6">
        <p className="text-sm font-semibold text-ink">Call outcome</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void complete('no_answer')}
            className={actionButton}
          >
            No answer
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void complete('connected_not_interested')}
            className={actionButton}
          >
            Not interested
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMode(mode === 'callback' ? 'idle' : 'callback')}
            className={actionButton}
            aria-expanded={mode === 'callback'}
          >
            Call back later…
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void complete('interested')}
            className={actionButton}
          >
            Interested — to advisor
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void complete('converted')}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-parchment transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Booked a call
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMode(mode === 'optout' ? 'idle' : 'optout')}
            className="rounded-lg border border-alert/40 px-4 py-2.5 text-sm font-medium text-alert transition-colors hover:bg-alert/10 disabled:opacity-50"
            aria-expanded={mode === 'optout'}
          >
            Do not contact…
          </button>
        </div>

        {mode === 'callback' && (
          <div className="mt-4 rounded-xl border border-line bg-parchment p-4">
            <label htmlFor="callback-at" className="block text-sm font-medium text-ink">
              When should we call back?
            </label>
            <input
              id="callback-at"
              type="datetime-local"
              value={callbackAt}
              onChange={(e) => setCallbackAt(e.target.value)}
              className="mt-2 rounded-lg border border-line bg-white px-3.5 py-2.5 text-ink"
            />
            <button
              type="button"
              disabled={disabled || !callbackAt}
              onClick={() =>
                void complete('callback', { callbackAt: new Date(callbackAt).toISOString() })
              }
              className="mt-3 ml-0 block rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-parchment disabled:opacity-50 sm:ml-3 sm:inline-block"
            >
              Save callback
            </button>
          </div>
        )}

        {mode === 'optout' && (
          <div className="mt-4 rounded-xl border border-alert/40 bg-alert/5 p-4">
            <p className="text-sm font-medium text-ink">Read this back to the customer:</p>
            <p className="mt-2 text-sm text-ink-soft italic">“{optOutConfirmation}”</p>
            <label htmlFor="optout-reason" className="mt-3 block text-sm font-medium text-ink">
              Reason (optional)
            </label>
            <input
              id="optout-reason"
              type="text"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Asked not to be called about products"
              className="mt-1 w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => void complete('opt_out', reason.trim() ? { reason: reason.trim() } : {})}
              className="mt-3 rounded-lg bg-alert px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Confirm — never contact again
            </button>
          </div>
        )}
      </div>

      {/* s69-gated link sends */}
      {sendLinks.length > 0 && (
        <div className="mt-6 rounded-xl border border-line bg-parchment p-4">
          <p className="text-sm font-semibold text-ink">Send the quiz link</p>
          <label className="mt-2 flex items-start gap-2.5 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={customerRequested}
              onChange={(e) => setCustomerRequested(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[var(--color-ink)]"
            />
            <span>
              The customer <strong>asked for the link on this call</strong>. Required — we only
              message people who requested it.
            </span>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {sendLinks.map((link) => (
              <button
                key={link.action}
                type="button"
                disabled={disabled || !customerRequested}
                onClick={() => sendQuizLink(link)}
                className={actionButton}
              >
                Send by {link.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {feedback && (
        <p
          role="status"
          className={`mt-4 rounded-lg px-3.5 py-2.5 text-sm ${
            feedback.kind === 'ok' ? 'bg-positive/10 text-positive' : 'bg-alert/10 text-alert'
          }`}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}
