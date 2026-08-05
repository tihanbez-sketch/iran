# Call-centre cross-sell engine — pilot runbook

The outbound counterpart to the inbound quiz funnel: PFL's ~3,500 funeral policyholders,
imported into the portal, prioritised, and worked by call-centre agents from an
authenticated queue at **`/agents`**. Pilot campaign: **life cover gap**.

This document is the operating manual: what to deploy in what order, the compliance
model, and how the pieces fit. The design rationale lives in the code comments.

---

## The moving parts

| Piece | Where | What it does |
| --- | --- | --- |
| Schema | `supabase/migrations/0004_crosssell_schema.sql` | Relaxes `leads` for imported customers; adds `policies`, `campaigns`, `campaign_members`, the `campaign_queue` + `campaign_stats` views; recreates `quiz_funnel` filtered by quiz slug |
| Auth + RLS | `supabase/migrations/0005_agent_auth_rls.sql` | `agent_profiles`, role predicates, agent grants (column-scoped on `leads`), **and the anon-policy teardown** |
| Import | `src/lib/book-import.ts` (pure) + `src/lib/import-executor.ts` (writes) + `POST /api/agent/import` + `/agents/import` (admin UI) | CSV → validated rows → create/merge/link plan → leads, policies, campaign enrolment |
| Priority | `src/lib/campaign-priority.ts` | Who gets called first: age 35 + premium 30 + tenure 25 + engagement 10, stamped at enrolment with human-readable reasons |
| Queue rules | `src/lib/campaign-rules.ts` ↔ `campaign_queue` WHERE | 3 attempts / 14 days / 4-day cooldown, enforced in the view agents read |
| Dispositions | `src/lib/disposition.ts` + `POST /api/agent/disposition` | The only write path agents have; state machine with terminal states and the DNC patch |
| Scripts | `src/lib/call-scripts.ts` | Opening disclosure, talking points, outbound messages — every string passes `screenText()`, asserted by tests |
| Workspace | `/agents/queue`, `/agents/leads/[id]`, `/agents/campaign`, `/agents/import` | Next-call card with disposition buttons, customer detail, funnel numbers, admin import |

## Deployment order — load-bearing, do not shuffle

1. **Deploy the portal** with `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   **`SUPABASE_SERVICE_ROLE_KEY`** (now mandatory — the web funnel writes through it once
   anon is revoked) and `NEXT_PUBLIC_SITE_URL` (the quiz links agents send must point at
   the real domain).
2. **Apply `0004`** then **`0005`** (after 0001–0003). 0005 drops the anon policies from
   0002; applying it *before* the service key is set breaks web lead capture.
3. **Configure Supabase Auth**: in Authentication → URL Configuration set the site URL;
   in Email Templates point invite/recovery links at
   `{{ .SiteURL }}/agents/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}`.
4. **Provision agents** — one named account per human, no shared floor logins:
   dashboard → Authentication → Invite user, then the `agent_profiles` INSERT from the
   bottom of 0005 (`role='admin'` for whoever runs imports). The invite email lands on
   `/agents/auth/confirm` → set password → queue.
5. **Compliance sign-off gate — before any dialling**:
   - `src/lib/call-scripts.ts`: fill the `[CONFIRM]` FSP number, approve every string.
   - Privacy notice: extend to cover direct marketing to existing customers; fill the
     three `[CONFIRM]` placeholders in `src/app/privacy/page.tsx`.
   - Decide call recording (evidence for "customer asked for the link" requests).
6. **Import the book** at `/agents/import` (admin): **dry run first**, read the report
   (rejected rows, duplicates, warnings), then live. Delete the source CSV after —
   SA ID numbers exist only inside the import request; nothing stores them.
7. **Start calling** at `/agents/queue`.

## The compliance model (enforced in code, not memos)

- **Lawful basis**: imported rows carry `consent_basis='existing_customer'` — POPIA
  direct marketing to PFL's own customers by **phone**, opt-out honoured. They have no
  web consent timestamp and the schema knows that's legitimate (`leads_consent_present`).
- **s69 electronic channels**: imported customers start with `channel_consent={phone}`.
  SMS/WhatsApp send buttons are disabled until the agent ticks *"the customer asked for
  the link on this call"*; the API rejects link dispositions without it, and the grant is
  recorded onto `channel_consent`.
- **Opt-out**: the agent reads the confirmation line back, the lead patch writes
  `do_not_contact` + reason + timestamp (the suppression record) **before** anything
  else; `campaign_queue` structurally excludes DNC rows, so a suppressed customer cannot
  be served to any agent again.
- **Frequency**: max 3 attempts, 4-day cooldown between attempts, enforced in the view's
  WHERE — an over-called customer drops out of the queue by construction.
- **FAIS**: agents generate leads and read screened, factual scripts; advice stays with
  licensed advisors ("interested" hands off). Every agent-facing string passes the same
  `screenText()` gate as the quiz insights — a non-compliant edit fails the test suite.
- **Data minimality**: SA ID numbers are Luhn-validated, age-banded and discarded inside
  the importer. No column, no metadata, no log carries them; a test asserts no 13-digit
  number survives into any output.

## How the queue decides who's next

`campaign_queue` (the only read path agents have) already excludes DNC, inactive
campaigns, non-workable statuses, future callbacks, attempt-capped and cooling-off
members. Ordering: **due callbacks → priority score → least recently attempted**.

Priority v1 (stamped at enrolment, reasons shown as chips on the call card):

| Dimension | Max | Peak |
| --- | --- | --- |
| Age band | 35 | 30–39 (35), 40–49 (30) — the dependant-raising years |
| Premium | 30 | ≥R200/m (30), ≥R100 (22), ≥R50 (15) — affordability proxy |
| Tenure | 25 | 2–10 years (25) — proven payer, established relationship |
| Engagement | 10 | Completed the quiz (10) |

## Dispositions

| Button | Member becomes | Attempt? | Also |
| --- | --- | --- | --- |
| No answer | unchanged (→ exhausted at cap) | yes | |
| Not interested | exhausted | yes | lead NOT suppressed — this campaign stops, nothing else |
| Call back later | callback (hidden until due) | yes | needs a future time |
| Interested | interested (leaves queue) | yes | hand-off to a licensed advisor |
| Booked a call | converted | yes | logs `call_booked` (60 → hot lead) |
| Do not contact | opted_out (terminal) | yes | DNC + reason + timestamp written first |
| Send WhatsApp/SMS link | unchanged | no | s69 checkbox required; grants the channel; opens the prefilled message |

Sends use `wa.me` / `sms:` deep links with the agent's own attribution
(`?ref=agent-…&utm_source=callcentre&utm_medium=whatsapp|sms&utm_campaign=life_cover_gap`),
so a customer who takes the quiz from a sent link shows up attributed to that agent and
their engagement feeds the existing lead scoring.

## Post-import verification (run in the SQL editor)

```sql
-- Imported rows: correct basis, no fabricated web consent, phone-only channels
select count(*) from leads where source = 'funeral_book'
  and (consent_basis <> 'existing_customer' or consent_privacy_at is not null);
-- expect 0

-- The queue never serves a suppressed or over-called customer
select count(*) from campaign_queue q
  join leads l on l.id = q.lead_id
  where l.do_not_contact or q.attempts >= 3;
-- expect 0

-- Anon really is out (run with the anon key): both must be denied
-- select * from leads limit 1;
-- insert into events (session_id, event_type) values ('probe', 'quiz_started');
```

## Deliberately not in this sprint

- **Automated SMS sending (Twilio)** — sprint 2, behind a server-side `channel_consent`
  recheck. Sprint 1 sends from the agent's handset via deep links: zero integration, and
  the s69 trail already exists.
- **Agent-assisted quiz capture** — needs signed-off verbal-consent wording. The schema
  is ready (`quiz_assisted` event type); sprint 2 is UI only.
- **Family Protection Score quiz** — content behind compliance sign-off; the funnel view
  already filters by quiz slug so it can land without contaminating retirement numbers.
- **Dashboards / weight retuning** — after the pilot produces conversion data.
