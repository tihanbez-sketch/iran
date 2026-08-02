'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { BreakdownBars, ScoreGauge } from '@/components/ScoreGauge';
import { labelFor, QUIZ_QUESTIONS, type QuestionId } from '@/lib/quiz-questions';
import type { ScoreBand } from '@/lib/scoring';
import { readLeadId, readQuizResult, type StoredQuizResult } from '@/lib/session';

/**
 * Questions worth raising with an advisor.
 *
 * Deliberately phrased as questions, never recommendations — the same
 * "questions to ask, not advice to follow" framing the Phase 3 Second Opinion
 * analyzer will use. Keyed to the weakest areas so the list stays relevant.
 */
const ADVISOR_QUESTIONS: Record<string, string[]> = {
  savings: [
    'What monthly income would my current retirement savings realistically support?',
    'How does my balance compare to a benchmark for someone my age?',
  ],
  savingsRate: [
    'What contribution rate would I need to close the gap between now and my target retirement age?',
    'Am I making full use of the tax deductions available on retirement contributions?',
  ],
  debt: [
    'Given my interest rates, does it make sense to prioritise debt repayment or retirement contributions?',
    'How would clearing my most expensive debt change what I can afford to save?',
  ],
  retirementVehicle: [
    'What retirement products do I currently hold, and what does each one cost me annually?',
    'Are my existing retirement savings in the most appropriate structure for my situation?',
  ],
  lifeCover: [
    'How much life cover would my dependants actually need if something happened to me?',
    'Does my cover end if I leave my current employer, and what would replacing it cost?',
  ],
};

const GENERAL_QUESTIONS = [
  'What are the total annual fees across everything I currently hold?',
  'What assumptions is any projection you show me based on?',
];

export function ReportView() {
  const [result, setResult] = useState<StoredQuizResult | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setResult(readQuizResult());
    setUnlocked(Boolean(readLeadId()));
    setLoaded(true);
  }, []);

  if (!loaded) {
    return <div className="mx-auto max-w-3xl px-5 py-24" aria-busy="true" />;
  }

  // The full report is gated on contact details. The quiz result itself stays
  // freely visible on /quiz — only this deeper artefact is behind the form.
  if (result && !unlocked) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-24 text-center">
        <h1 className="text-2xl font-semibold text-ink">Your report is ready to open</h1>
        <p className="mt-3 text-ink-soft">
          Add your name and email on your results page and the full report opens straight away. Your
          score and answers are still saved in this browser.
        </p>
        <Link
          href="/quiz"
          className="mt-7 inline-block rounded-xl bg-ink px-6 py-3.5 font-medium text-parchment"
        >
          Back to my results
        </Link>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-24 text-center">
        <h1 className="text-2xl font-semibold text-ink">We could not find your results</h1>
        <p className="mt-3 text-ink-soft">
          Your report is prepared in your browser and clears when you close the tab. Taking the quiz
          again takes about two minutes.
        </p>
        <Link
          href="/quiz"
          className="mt-7 inline-block rounded-xl bg-ink px-6 py-3.5 font-medium text-parchment"
        >
          Retake the quiz
        </Link>
      </div>
    );
  }

  const weakest = result.breakdown
    .slice()
    .sort((a, b) => a.ratio - b.ratio || b.max - a.max)
    .slice(0, 2);

  const questions = [
    ...weakest.flatMap((d) => ADVISOR_QUESTIONS[d.dimension] ?? []),
    ...GENERAL_QUESTIONS,
  ].slice(0, 5);

  const completed = new Date(result.completedAt);
  const formattedDate = Number.isNaN(completed.getTime())
    ? ''
    : completed.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <div className="no-print mb-8 flex flex-wrap items-center justify-between gap-3">
        <Link href="/quiz" className="text-sm text-ink-soft underline underline-offset-4">
          ← Back to my results
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-xl bg-ink px-5 py-3 text-sm font-medium text-parchment transition-opacity hover:opacity-90"
        >
          Download as PDF
        </button>
      </div>

      <article className="rounded-2xl border border-line bg-white p-6 sm:p-10 print:rounded-none print:border-0 print:p-0">
        <header className="print-block border-b border-line pb-6">
          <p className="font-serif text-lg font-semibold text-ink">PFL Financial Advisors</p>
          <h1 className="mt-3 text-3xl font-semibold text-ink">Retirement Health Report</h1>
          <p className="mt-2 text-ink-muted">
            {result.fullName ? `Prepared for ${result.fullName}` : 'Prepared for you'}
            {formattedDate ? ` · ${formattedDate}` : ''}
          </p>
        </header>

        <section className="print-block mt-8 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <div className="w-full sm:w-1/2">
            <ScoreGauge
              score={result.score}
              band={result.band as ScoreBand}
              bandLabel={result.bandLabel}
              static
            />
          </div>
          <div className="w-full sm:w-1/2">
            <h2 className="text-lg font-semibold text-ink">What this means</h2>
            <p className="mt-2 text-ink-soft">{result.bandSummary}</p>
          </div>
        </section>

        <section className="print-block mt-10">
          <h2 className="text-lg font-semibold text-ink">Your score by area</h2>
          <div className="mt-5">
            <BreakdownBars breakdown={result.breakdown} />
          </div>
        </section>

        <section className="print-block mt-10">
          <h2 className="text-lg font-semibold text-ink">What stands out</h2>
          <ul className="mt-4 list-none space-y-4 p-0">
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
        </section>

        <section className="print-block mt-10">
          <h2 className="text-lg font-semibold text-ink">Questions worth asking an advisor</h2>
          <p className="mt-2 text-sm text-ink-muted">
            These are questions, not recommendations. Bring them to any licensed advisor — including
            one who is not us.
          </p>
          <ol className="mt-4 list-decimal space-y-2.5 pl-5">
            {questions.map((question) => (
              <li key={question} className="pl-1 text-ink-soft">
                {question}
              </li>
            ))}
          </ol>
        </section>

        <section className="print-block mt-10">
          <h2 className="text-lg font-semibold text-ink">Your answers</h2>
          <dl className="mt-4 divide-y divide-line border-t border-line">
            {QUIZ_QUESTIONS.map((q) => (
              <div key={q.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
                <dt className="text-sm text-ink-muted sm:w-1/2">{q.question}</dt>
                <dd className="m-0 text-sm font-medium text-ink sm:w-1/2">
                  {result.answers[q.id]
                    ? labelFor(q.id as QuestionId, result.answers[q.id])
                    : '—'}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <footer className="print-block mt-10 border-t border-line pt-6">
          <p className="text-sm text-ink-soft">{result.disclaimer}</p>
          <p className="mt-3 text-xs text-ink-muted">
            PFL Financial Advisors is an authorised financial services provider in terms of the
            Financial Advisory and Intermediary Services Act, 2002 (FAIS). This report is generated
            from self-reported answers and has not been verified. It is not a financial needs
            analysis.
          </p>
        </footer>
      </article>
    </div>
  );
}
