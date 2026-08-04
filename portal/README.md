# PFL Super Lead Portal — Phase 1

Lead capture, qualification and scoring for **PFL Financial Advisors**, an FSCA-licensed
advisory firm in KwaZulu-Natal.

Phase 1 delivers the core capture loop: the **Retirement Health Score** quiz, an instant
scored result with Claude-generated insights, contact capture, and the Supabase schema
that scores leads for the advisor worklist.

> This app lives in `portal/`. The files at the repository root are a built bundle from an
> unrelated project and are untouched.

---

## Quick start

```bash
cd portal
npm install
cp .env.example .env.local     # fill in your keys
npm run dev                    # http://localhost:3000
```

The portal runs with **no keys at all**. Without `ANTHROPIC_API_KEY` it serves pre-approved
template insights; without Supabase it scores and displays results but returns a visible
error on lead capture rather than dropping the lead silently.

| Command            | Does                                          |
| ------------------ | --------------------------------------------- |
| `npm run dev`      | Dev server                                    |
| `npm run build`    | Production build                              |
| `npm test`         | Vitest suite (119 tests)                      |
| `npm run typecheck`| `tsc --noEmit`                                |

### Database

Run the migrations in `supabase/migrations/` in order, via `supabase db push` or the
Supabase SQL editor. `0002_rls.sql` is not optional — it is what keeps lead data
unreadable from a browser. `0003_attribution_and_funnel.sql` adds channel attribution
and the quiz drop-off view; lead capture writes to `leads.attribution`, so it must be
applied before going live.

---

## What Phase 1 includes

- **Landing page** explaining the score and what it measures.
- **Eight-question quiz** — age band, employment type (incl. GEPF), savings band, monthly
  savings rate, RA/pension status, life cover, debt level, biggest worry.
- **Instant result** — score out of 100 on an SVG gauge, a five-bar breakdown, and three
  Claude-generated insight bullets with the mandatory disclaimer.
- **Lead capture** with unbundled POPIA consent, unlocking the full report.
- **Printable report** — score, breakdown, insights, questions to ask an advisor, and all
  eight answers. "Download as PDF" prints to PDF.
- **Supabase backend** — `leads`, `events`, and a `lead_scores` view that ranks the
  advisor worklist.
- **Privacy / POPIA notice** (three `[CONFIRM]` placeholders for the compliance officer).

---

## How the score works

Five weighted dimensions, 100 points total:

| Dimension                  | Weight |
| -------------------------- | -----: |
| Retirement savings so far  |     30 |
| Monthly contribution rate  |     20 |
| Debt position              |     20 |
| Retirement structure       |     15 |
| Life cover                 |     15 |

Age band, employment type and biggest worry score **nothing**. Age sets the benchmark that
savings adequacy is measured against, so a 28-year-old and a 58-year-old with the same
balance get different results. The other two drive segmentation tags
(`gepf`, `risk`, `debt`, `retirement`, `new_investor`, `pre_retirement`, `self_employed`)
used for nurture routing.

Bands: **80+** on track · **60–79** solid · **40–59** needs attention · **<40** time to act.

All of this is pure and covered by tests in `tests/scoring.test.ts`, including an
exhaustive sweep of all 15 625 scored answer combinations asserting the score always lands
in 0–100 and always equals the sum of its parts.

### Lead scoring

Weights are exactly as specified (`src/lib/lead-scoring.ts`): quiz +20, calculator +10,
policy upload +40, chatbot qualified +15, call booked +50, email open +2, click +5,
7-day return +10. **≥60 hot · 30–59 warm · <30 nurture.**

Points are written to `events.points` at insert time from that single source of truth, so
the `lead_scores` view is a plain `SUM` and retuning weights later cannot silently rewrite
historical scores. The client sends an event *type*, never a score — a lead's score cannot
be inflated from the browser.

---

## Attribution, sharing and the funnel

Getting people to the quiz is a channel question, and the code now answers "which
channel worked":

- **First-touch attribution** (`src/lib/attribution.ts`). `utm_*` parameters and a short
  `?ref=` code (for posters/QR) are captured on arrival and stored in the browser. The
  record rides along with quiz completion and lead capture into `leads.attribution` and
  event metadata, so channel → lead volume *and* channel → score quality are both
  queryable. First touch wins; an organic first visit is upgraded by a later campaign
  visit. `lead_scores` exposes a `channel` column for the advisor worklist.
- **Share loop** (`src/lib/share.ts` + the panel on `/report`). WhatsApp, native share
  and copy-link, all pointing at the **quiz** (never the sharer's report) with
  `utm_source=whatsapp|share&utm_medium=referral`, so referred leads attribute. The
  prefilled message is asserted by the test suite to pass the same FAIS screening as
  generated output. Each share fires a `share_clicked` event.
- **Share preview card** (`src/app/opengraph-image.png`, 1200×630). Forwarded links
  render as a proper card on WhatsApp and Facebook instead of bare text. Regenerate by
  editing the design and re-screenshotting at 1200×630. Set `NEXT_PUBLIC_SITE_URL` in
  production — WhatsApp requires the absolute og:image URL it feeds.
- **Drop-off funnel**. Every answered question fires `quiz_question_answered`
  (0 points), and the `quiz_funnel` view turns those into per-question reach: a big
  drop between adjacent steps points at the question to fix.

Suggested link conventions: staffroom/QR placements use `?ref=<placement>`, paid and
social use standard `utm_source`/`utm_medium`/`utm_campaign`.

---

## The compliance layer

The spec's guardrails are enforced structurally, not just by prompting.

`src/lib/compliance.ts` screens **every** generated line before a visitor sees it, for:

1. **Named products or providers** — a blocklist of SA providers. Generic category terms
   ("retirement annuity", "living annuity", "unit trust") are explicitly allowed.
2. **Guarantees and performance claims** — "guaranteed", "risk-free", "will return",
   "outperform", any `N% per year`.
3. **Personal advice** — "you should invest", "we recommend", "the best option for you is".

Anything that fails is **dropped and replaced with a pre-approved template**, and the
rejection is logged for the compliance audit trail. The mandatory disclaimer is appended
to every AI output and is never duplicated.

The templates in `src/lib/insight-templates.ts` are the compliance officer's sign-off
surface, and the test suite asserts that every template passes its own screening — so the
fallback can never be the thing that breaks the rules.

### Claude integration

`src/lib/insights.ts` calls `claude-opus-5` with a structured-output JSON schema and
`effort: 'low'` (a short, well-specified task; keeps latency down on a page the visitor is
waiting on). The model is pinned deliberately — a silent upgrade would bypass compliance
sign-off.

`generateInsights()` **never throws and never blocks a result.** Missing API key, timeout,
API error, `stop_reason: "refusal"`, or unparseable output all degrade to templates.

> **On refusal fallbacks:** the API supports re-running a refused request on a fallback
> model. That is not wired up here, deliberately. A refusal on a retirement quiz is
> near-impossible, and for FAIS purposes a guaranteed-compliant template is a better
> failure mode than another model's free text — which would still have to pass the same
> screening. If PFL later wants it, add `fallbacks: "default"` on the beta endpoint.

Quiz answers are sent to the API **without name, email or phone attached**.

---

## Data protection (POPIA)

- **Consent at every capture point.** Unbundled: privacy consent is required, marketing
  consent is separate and optional. Nothing is pre-ticked, and the acceptance timestamp is
  stored on the lead.
- **No Supabase key reaches the browser.** All writes go through server-side API routes.
- **RLS on by default, `FORCE`d**, with no `SELECT` policy on `leads` — there is no path to
  read lead records from a browser. `lead_scores` is revoked from `anon` and
  `authenticated`.
- **Retention** is stubbed with ready-to-enable `pg_cron` jobs in `0002_rls.sql`; the
  period needs the compliance officer's sign-off. Anonymous events purge at 90 days.
- The report is rendered from the visitor's own answers in their own browser. The email
  gate is a conversion mechanism, not a security boundary — nothing sensitive sits behind
  it, and `/report` is `noindex`.

---

## Layout

```
portal/
├── src/
│   ├── app/
│   │   ├── page.tsx                 landing
│   │   ├── quiz/ report/ privacy/
│   │   └── api/quiz|leads|events/   server routes
│   ├── components/                  QuizFlow, ReportView, ScoreGauge
│   └── lib/
│       ├── scoring.ts               quiz score        (pure, tested)
│       ├── lead-scoring.ts          event points      (pure, tested)
│       ├── compliance.ts            FAIS screening    (pure, tested)
│       ├── insight-templates.ts     approved fallbacks (tested)
│       ├── insights.ts              Claude call
│       ├── quiz-questions.ts        the 8 questions
│       ├── validation.ts            zod schemas
│       ├── supabase.ts              server-side data access
│       └── session.ts               anonymous session id
├── supabase/migrations/             schema + RLS
└── tests/                           119 tests
```

---

## Before this goes live

1. **Compliance officer sign-off** on the quiz insight templates, the system prompt in
   `src/lib/insights.ts`, and the report copy — as the spec requires, once each, then the
   templates run automatically.
2. **Fill the three `[CONFIRM]` placeholders** in `src/app/privacy/page.tsx`: information
   officer, privacy contact address, retention period.
3. **Extend the product blocklist** in `src/lib/compliance.ts` with any provider names the
   compliance officer wants added.
4. **Set `SUPABASE_SERVICE_ROLE_KEY`** and drop the anon write policies (the commented
   block at the bottom of `0002_rls.sql`).
5. **Add rate limiting** on `/api/leads` and `/api/quiz`. There is none yet; each quiz
   submission costs a Claude call.
6. **Set `NEXT_PUBLIC_SITE_URL`** to the production domain — share previews on WhatsApp
   and Facebook need the absolute og:image URL it produces.

### Known tuning note

`call_booked` is worth 50 and the hot threshold is 60, so a booking with no other recorded
activity scores as *warm*. Unreachable through the current funnel — anyone booking has
completed the quiz (+20 = 70, hot) — but if bookings ever arrive from an external channel,
raise `call_booked` to 60. Covered by an explicit test.

---

## Next phases

**2** — Claude chatbot widget, Calendly booking, CRM sync.
**3** — Second Opinion PDF analyzer (the report's "questions to ask an advisor" section is
already written in the question-not-advice framing that analyzer needs), WhatsApp capture.
**4** — 30-Day Money Reset Challenge, nurture sequences, review automation, advisor
dashboard with AI call briefings.
