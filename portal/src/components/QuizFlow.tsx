'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BreakdownBars, ScoreGauge } from '@/components/ScoreGauge';
import { readAttribution } from '@/lib/attribution';
import { QUIZ_QUESTIONS } from '@/lib/quiz-questions';
import type { ScoreBand } from '@/lib/scoring';
import {
  clearQuizResult,
  getSessionId,
  readQuizResult,
  storeLeadId,
  storeQuizResult,
  track,
  type StoredQuizResult,
} from '@/lib/session';

type Stage = 'questions' | 'scoring' | 'result';

interface QuizResponse {
  score: number;
  band: ScoreBand;
  bandLabel: string;
  bandSummary: string;
  breakdown: StoredQuizResult['breakdown'];
  tags: string[];
  insights: string[];
  disclaimer: string;
}

export function QuizFlow() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('questions');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const total = QUIZ_QUESTIONS.length;
  const question = QUIZ_QUESTIONS[step];
  const progress = Math.round((step / total) * 100);

  // Restore an in-browser result so a refresh, a back navigation, or the
  // "back to my results" link from /report does not force a retake.
  useEffect(() => {
    const stored = readQuizResult();
    if (stored) {
      setResult({
        score: stored.score,
        band: stored.band as ScoreBand,
        bandLabel: stored.bandLabel,
        bandSummary: stored.bandSummary,
        breakdown: stored.breakdown,
        tags: stored.tags,
        insights: stored.insights,
        disclaimer: stored.disclaimer,
      });
      setAnswers(stored.answers);
      setStage('result');
      return;
    }
    track('quiz_started');
  }, []);

  // Move focus to the new question so screen-reader and keyboard users are not
  // stranded at the bottom of the previous one.
  useEffect(() => {
    if (stage === 'questions') headingRef.current?.focus();
  }, [step, stage]);

  const submit = useCallback(
    async (finalAnswers: Record<string, string>) => {
      setStage('scoring');
      setError(null);
      try {
        const response = await fetch('/api/quiz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: finalAnswers,
            sessionId: getSessionId(),
            attribution: readAttribution() ?? undefined,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? 'We could not calculate your score.');
        }

        const data = (await response.json()) as QuizResponse;
        setResult(data);
        setStage('result');
        storeQuizResult({
          ...data,
          answers: finalAnswers,
          completedAt: new Date().toISOString(),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
        setStage('questions');
      }
    },
    [],
  );

  const choose = useCallback(
    (value: string) => {
      const next = { ...answers, [question.id]: value };
      setAnswers(next);

      // Funnel event: which question did sessions get to? A drop between
      // adjacent steps in the quiz_funnel view points at the question to fix.
      track('quiz_question_answered', { step: step + 1, questionId: question.id });

      if (step + 1 < total) {
        setStep(step + 1);
      } else {
        void submit(next);
      }
    },
    [answers, question, step, total, submit],
  );

  if (stage === 'scoring') {
    return <ScoringState />;
  }

  if (stage === 'result' && result) {
    return (
      <ResultPanel
        result={result}
        answers={answers}
        onNavigate={router.push}
        onRestart={() => {
          clearQuizResult();
          setResult(null);
          setAnswers({});
          setStep(0);
          setStage('questions');
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <div className="mb-8">
        <div className="mb-2 flex items-baseline justify-between text-sm text-ink-muted">
          <span>
            Question {step + 1} of {total}
          </span>
          <span className="tabular-nums">{progress}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-parchment-deep"
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label="Quiz progress"
        >
          <div
            className="h-full rounded-full bg-gold transition-[width] duration-300"
            style={{ width: `${Math.max(progress, 4)}%` }}
          />
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-alert/30 bg-alert/5 px-4 py-3 text-sm text-alert"
        >
          {error}
        </p>
      )}

      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold text-ink outline-none sm:text-3xl"
      >
        {question.question}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">{question.why}</p>

      <fieldset className="mt-7 border-0 p-0">
        <legend className="sr-only">{question.question}</legend>
        <div className="space-y-2.5">
          {question.options.map((option) => {
            const selected = answers[question.id] === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => choose(option.value)}
                aria-pressed={selected}
                className={`w-full rounded-xl border px-4 py-3.5 text-left transition-colors ${
                  selected
                    ? 'border-ink bg-ink text-parchment'
                    : 'border-line bg-white text-ink hover:border-ink hover:bg-parchment-deep'
                }`}
              >
                <span className="block font-medium">{option.label}</span>
                {option.hint && (
                  <span
                    className={`mt-0.5 block text-sm ${selected ? 'text-parchment/70' : 'text-ink-muted'}`}
                  >
                    {option.hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-7 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          className="text-sm text-ink-soft underline underline-offset-4 disabled:invisible"
        >
          Back
        </button>
        <p className="text-xs text-ink-muted">No sign-up needed to see your score</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ScoringState() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-5 py-24 text-center">
      <div
        className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-gold"
        aria-hidden="true"
      />
      <p className="mt-6 font-serif text-xl text-ink" role="status">
        Working out your score…
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        Reading your answers and preparing your breakdown.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface ResultPanelProps {
  result: QuizResponse;
  answers: Record<string, string>;
  onNavigate: (href: string) => void;
  onRestart: () => void;
}

function ResultPanel({ result, answers, onNavigate, onRestart }: ResultPanelProps) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <section className="rounded-2xl border border-line bg-white p-6 sm:p-8">
        <p className="text-center text-sm tracking-wide text-ink-muted uppercase">
          Your Retirement Health Score
        </p>
        <div className="mt-4">
          <ScoreGauge score={result.score} band={result.band} bandLabel={result.bandLabel} />
        </div>
        <p className="mx-auto mt-5 max-w-md text-center text-ink-soft">{result.bandSummary}</p>
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-white p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-ink">Where your points came from</h2>
        <div className="mt-5">
          <BreakdownBars breakdown={result.breakdown} />
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-white p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-ink">What stands out</h2>
        <ul className="mt-4 space-y-4">
          {result.insights.map((insight, index) => (
            <li key={index} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
              />
              <p className="text-ink-soft">{insight}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 border-t border-line pt-4 text-sm text-ink-muted">
          {result.disclaimer}
        </p>
      </section>

      <LeadCaptureForm result={result} answers={answers} onNavigate={onNavigate} />

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onRestart}
          className="text-sm text-ink-soft underline underline-offset-4 hover:text-ink"
        >
          Start the quiz again
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface LeadCaptureFormProps {
  result: QuizResponse;
  answers: Record<string, string>;
  onNavigate: (href: string) => void;
}

function LeadCaptureForm({ result, answers, onNavigate }: LeadCaptureFormProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const canSubmit = useMemo(
    () => fullName.trim().length >= 2 && email.includes('@') && consentPrivacy && !submitting,
    [fullName, email, consentPrivacy, submitting],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFields({});

    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          sessionId: getSessionId(),
          answers,
          consentPrivacy,
          consentMarketing,
          source: 'retirement_health_score',
          attribution: readAttribution() ?? undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        leadId?: string;
        error?: string;
        fields?: Record<string, string>;
      };

      if (!response.ok) {
        setFields(payload.fields ?? {});
        throw new Error(payload.error ?? 'We could not save your details.');
      }

      if (payload.leadId) storeLeadId(payload.leadId);

      // Persist the name so the report can be addressed personally.
      storeQuizResult({
        ...result,
        answers,
        completedAt: new Date().toISOString(),
        fullName: fullName.trim(),
      });

      track('report_downloaded', { score: result.score }, payload.leadId);
      onNavigate('/report');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-gold-soft bg-parchment-deep p-6 sm:p-8">
      <h2 className="text-xl font-semibold text-ink">Get your full report</h2>
      <p className="mt-2 text-ink-soft">
        A printable breakdown of all eight answers, your score by area, and the questions worth
        raising with an advisor.
      </p>

      {formError && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-alert/30 bg-alert/5 px-4 py-3 text-sm text-alert"
        >
          {formError}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
        <Field
          label="Full name"
          id="fullName"
          value={fullName}
          onChange={setFullName}
          autoComplete="name"
          required
          error={fields.fullName}
        />
        <Field
          label="Email address"
          id="email"
          type="email"
          inputMode="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
          error={fields.email}
        />
        <Field
          label="Contact number"
          id="phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={setPhone}
          autoComplete="tel"
          hint="Optional — only if you would like a call back."
          error={fields.phone}
        />

        <div className="space-y-3 pt-1">
          <Checkbox
            id="consentPrivacy"
            checked={consentPrivacy}
            onChange={setConsentPrivacy}
            error={fields.consentPrivacy}
          >
            I have read the{' '}
            <Link href="/privacy" className="underline underline-offset-2" target="_blank">
              privacy notice
            </Link>{' '}
            and agree that PFL may store my details to prepare and send my report.
          </Checkbox>

          <Checkbox id="consentMarketing" checked={consentMarketing} onChange={setConsentMarketing}>
            Send me occasional financial education emails. (Optional — you can unsubscribe at any
            time.)
          </Checkbox>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-2 w-full rounded-xl bg-ink px-5 py-3.5 font-medium text-parchment transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Preparing your report…' : 'Show me my full report'}
        </button>

        <p className="text-xs text-ink-muted">
          We never sell your information. You can ask us to delete it at any time.
        </p>
      </form>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

interface FieldProps {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: 'email' | 'tel' | 'text';
  autoComplete?: string;
  required?: boolean;
  hint?: string;
  error?: string;
}

function Field({
  label,
  id,
  value,
  onChange,
  type = 'text',
  inputMode,
  autoComplete,
  required,
  hint,
  error,
}: FieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {!required && <span className="ml-1 font-normal text-ink-muted">(optional)</span>}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={`mt-1.5 w-full rounded-lg border bg-white px-3.5 py-3 text-ink outline-none ${
          error ? 'border-alert' : 'border-line focus:border-ink'
        }`}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface CheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  children: React.ReactNode;
}

function Checkbox({ id, checked, onChange, error, children }: CheckboxProps) {
  return (
    <div>
      <div className="flex gap-3">
        <input
          id={id}
          name={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-ink)]"
        />
        <label htmlFor={id} className="text-sm leading-relaxed text-ink-soft">
          {children}
        </label>
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 ml-7 text-xs text-alert">
          {error}
        </p>
      )}
    </div>
  );
}
