import Link from 'next/link';

const STEPS = [
  {
    title: 'Answer eight questions',
    body: 'Age, savings, contributions, cover and debt. Estimates are fine — this is a directional health check, not an audit.',
  },
  {
    title: 'See your score instantly',
    body: 'A score out of 100 with a breakdown showing exactly which areas earned points and which did not.',
  },
  {
    title: 'Get the full report',
    body: 'A printable summary of your answers, your score by area, and the questions worth raising with an advisor.',
  },
];

const AREAS = [
  { label: 'Retirement savings so far', weight: 30 },
  { label: 'Monthly contribution rate', weight: 20 },
  { label: 'Debt position', weight: 20 },
  { label: 'Retirement structure', weight: 15 },
  { label: 'Life cover', weight: 15 },
];

export default function HomePage() {
  return (
    <>
      <section className="mx-auto max-w-3xl px-5 pt-14 pb-12 text-center sm:pt-20">
        <p className="text-sm font-medium tracking-wide text-gold uppercase">
          Free · Two minutes · No sign-up to see your score
        </p>
        <h1 className="mt-4 text-4xl font-semibold text-balance text-ink sm:text-5xl">
          How healthy is your retirement plan, really?
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-pretty text-ink-soft">
          Most people have a rough sense that they should be doing more, without knowing where they
          actually stand. Eight questions will give you a clear answer.
        </p>

        <div className="mt-9 flex flex-col items-center gap-3">
          <Link
            href="/quiz"
            className="w-full max-w-xs rounded-xl bg-ink px-8 py-4 text-lg font-medium text-parchment transition-opacity hover:opacity-90 sm:w-auto"
          >
            Start my Retirement Health Score
          </Link>
          <p className="text-sm text-ink-muted">
            Your score appears immediately. Details are only needed for the full report.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-8">
        <ol className="grid list-none gap-5 p-0 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-line bg-white p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-parchment-deep font-serif text-sm font-semibold text-ink">
                {index + 1}
              </span>
              <h2 className="mt-4 text-base font-semibold text-ink">{step.title}</h2>
              <p className="mt-2 text-sm text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-10">
        <div className="rounded-2xl border border-line bg-white p-6 sm:p-9">
          <h2 className="text-2xl font-semibold text-ink">What the score measures</h2>
          <p className="mt-3 max-w-2xl text-ink-soft">
            Five areas, weighted by how much each one tends to move a retirement outcome. Your age
            band sets the benchmark your savings are measured against, so a 28-year-old and a
            58-year-old with the same balance do not get the same result.
          </p>

          <ul className="mt-7 list-none space-y-3 p-0">
            {AREAS.map((area) => (
              <li key={area.label} className="flex items-center gap-4">
                <span className="w-56 shrink-0 text-sm font-medium text-ink sm:w-64">
                  {area.label}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-parchment-deep">
                  <span
                    className="block h-full rounded-full bg-gold"
                    style={{ width: `${(area.weight / 30) * 100}%` }}
                  />
                </span>
                <span className="w-14 shrink-0 text-right text-sm tabular-nums text-ink-muted">
                  {area.weight} pts
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-10 text-center">
        <h2 className="text-2xl font-semibold text-ink">Ready when you are</h2>
        <p className="mx-auto mt-3 max-w-lg text-ink-soft">
          Knowing your number is the part most people skip. It takes about two minutes.
        </p>
        <Link
          href="/quiz"
          className="mt-7 inline-block rounded-xl bg-ink px-8 py-4 text-lg font-medium text-parchment transition-opacity hover:opacity-90"
        >
          Check my score
        </Link>
      </section>
    </>
  );
}
