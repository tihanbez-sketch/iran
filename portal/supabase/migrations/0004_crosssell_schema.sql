-- ---------------------------------------------------------------------------
-- Cross-sell call-centre engine — schema
--
--   leads            relaxed for imported funeral-book customers
--   policies         product holdings per lead
--   campaigns        outbound campaign definitions (attempt policy as data)
--   campaign_members the calling queue, with priority stamped at enrolment
--   campaign_queue   the ONLY read path agents have to workable members —
--                    DNC, attempt caps and cooldowns are enforced in its WHERE
--   campaign_stats   funnel numbers per campaign
--   quiz_funnel      recreated to filter by quiz slug
--
-- Run after 0003. Pair with 0005_agent_auth_rls.sql (auth + RLS) before any
-- import — see the runbook ordering in CALLCENTRE.md.
--
-- Weight/threshold pairings (same convention as lead-scoring.ts <-> lead_scores):
--   campaign_members.priority_score  <- src/lib/campaign-priority.ts (stamped at write)
--   campaign_queue attempt clauses   <- src/lib/campaign-rules.ts (ATTEMPT_POLICY)
--
-- Historical events keep the points stamped when they occurred; the
-- call_booked retune (50 -> 60 in lead-scoring.ts) applies to new events only.
-- That is the stamping design working as intended.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- leads: imported customers have no email and never accepted the web privacy
-- notice; their lawful basis is the existing customer relationship.
-- ---------------------------------------------------------------------------

alter table public.leads alter column email drop not null;
-- NOTE: the existing UNIQUE constraint on email is kept deliberately.
-- Postgres treats NULLs as distinct, so email-less book rows coexist, and the
-- web funnel's upsert ON CONFLICT (email) keeps working. Do not replace it
-- with a partial index — PostgREST cannot target one.

alter table public.leads alter column consent_privacy_at drop not null;

alter table public.leads
  add column if not exists consent_basis text not null default 'web_form';

alter table public.leads drop constraint if exists leads_consent_basis_check;
alter table public.leads
  add constraint leads_consent_basis_check
  check (consent_basis in ('web_form', 'existing_customer'));

-- A row must either carry an explicit web consent timestamp or rest on the
-- existing-customer relationship. Never both absent.
alter table public.leads drop constraint if exists leads_consent_present;
alter table public.leads
  add constraint leads_consent_present
  check (consent_privacy_at is not null or consent_basis = 'existing_customer');

comment on column public.leads.consent_basis is
  'POPIA lawful basis: web_form = accepted the privacy notice on capture; existing_customer = imported from PFL''s own book, direct marketing under the existing relationship with opt-out.';

-- Suppression (do-not-contact). Enforced structurally in campaign_queue.
alter table public.leads add column if not exists do_not_contact boolean not null default false;
alter table public.leads add column if not exists do_not_contact_reason text;
alter table public.leads add column if not exists do_not_contact_at timestamptz;

create index if not exists leads_dnc_idx on public.leads (do_not_contact) where do_not_contact;

comment on column public.leads.do_not_contact is
  'Hard suppression flag. campaign_queue excludes these rows; the reason and timestamp form the POPIA opt-out record.';

-- POPIA s69: which channels this person may be contacted on. Imported book
-- rows default to phone only; electronic channels are added only when the
-- customer asks (recorded via disposition) or s69(3) conditions are documented.
alter table public.leads add column if not exists channel_consent text[] not null default '{phone}';

alter table public.leads drop constraint if exists leads_channel_consent_check;
alter table public.leads
  add constraint leads_channel_consent_check
  check (channel_consent <@ array['phone', 'sms', 'whatsapp', 'email']::text[]);

-- Age band uses the exact quiz vocabulary so book data and quiz answers are
-- comparable. Derived transiently from the SA ID at import; the ID itself is
-- NEVER stored, logged, or echoed anywhere (POPIA minimality).
alter table public.leads add column if not exists age_band text;

alter table public.leads drop constraint if exists leads_age_band_check;
alter table public.leads
  add constraint leads_age_band_check
  check (age_band is null or age_band in ('under_30', '30_39', '40_49', '50_59', '60_plus'));

-- Import dedupe backstop: the importer keys book rows by phone; this index
-- guarantees it even if two imports race.
create unique index if not exists leads_phone_book_unique_idx
  on public.leads (phone) where source = 'funeral_book';

-- leads.status is deliberately unchanged: imported policyholders are 'client'
-- (already in the CHECK list). Call lifecycle is campaign-scoped state and
-- lives on campaign_members.status — a lead can be in several campaigns over
-- time and the web statuses must not be polluted with call dispositions.

-- ---------------------------------------------------------------------------
-- policies — product holdings
-- ---------------------------------------------------------------------------

create table if not exists public.policies (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  lead_id       uuid        not null references public.leads (id) on delete cascade,
  product_type  text        not null
                check (product_type in ('funeral', 'life', 'savings', 'ra', 'estate', 'other')),
  policy_number text        not null,
  -- Integer cents: exact arithmetic, no float ambiguity.
  premium_cents integer     check (premium_cents >= 0),
  start_date    date,
  status        text        not null default 'active'
                check (status in ('active', 'lapsed', 'cancelled', 'claimed', 'unknown')),

  -- Re-run upsert target. Guards against policy-number reuse across products.
  constraint policies_number_product_key unique (policy_number, product_type)
);

comment on table public.policies is
  'Product holdings per lead. Imported from the funeral book; extended as other products are sold. Drives next-best-product logic.';

create index if not exists policies_lead_id_idx on public.policies (lead_id);

drop trigger if exists policies_touch_updated_at on public.policies;
create trigger policies_touch_updated_at
  before update on public.policies
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- campaigns — attempt policy is data, so tuning is an UPDATE not a migration
-- ---------------------------------------------------------------------------

create table if not exists public.campaigns (
  id                  uuid        primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),

  slug                text        not null unique,
  name                text        not null,
  product_type        text        not null,
  status              text        not null default 'draft'
                      check (status in ('draft', 'active', 'paused', 'completed')),

  -- Mirrored by src/lib/campaign-rules.ts ATTEMPT_POLICY.
  max_attempts        integer     not null default 3  check (max_attempts between 1 and 10),
  attempt_window_days integer     not null default 14 check (attempt_window_days between 1 and 90),
  retry_cooldown_days integer     not null default 4  check (retry_cooldown_days between 0 and 30)
);

comment on table public.campaigns is
  'Outbound campaign definitions. Attempt caps and cooldowns live here as data; campaign_queue enforces them.';

insert into public.campaigns (slug, name, product_type, status)
values ('life_cover_gap', 'Life cover gap — funeral book', 'life', 'active')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- campaign_members — the calling queue
-- ---------------------------------------------------------------------------

create table if not exists public.campaign_members (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  campaign_id     uuid        not null references public.campaigns (id) on delete cascade,
  lead_id         uuid        not null references public.leads (id) on delete cascade,

  -- Stamped at enrolment by src/lib/campaign-priority.ts, exactly as events.points
  -- is stamped by lead-scoring.ts: weights live in one place, in code, at write time.
  priority_score  integer     not null default 0 check (priority_score between 0 and 100),
  priority_reasons jsonb      not null default '[]'::jsonb,

  status          text        not null default 'queued'
                  check (status in ('queued', 'assigned', 'contacted', 'callback',
                                    'interested', 'converted', 'opted_out', 'exhausted')),
  callback_at     timestamptz,
  attempts        integer     not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  assigned_to     uuid        references auth.users (id) on delete set null,

  constraint campaign_members_campaign_lead_key unique (campaign_id, lead_id)
);

comment on table public.campaign_members is
  'Per-campaign call state. Terminal statuses: converted, opted_out, exhausted. Transitions validated by src/lib/disposition.ts.';

create index if not exists campaign_members_queue_idx
  on public.campaign_members (campaign_id, status, priority_score desc);
create index if not exists campaign_members_callback_idx
  on public.campaign_members (campaign_id, callback_at) where status = 'callback';

drop trigger if exists campaign_members_touch_updated_at on public.campaign_members;
create trigger campaign_members_touch_updated_at
  before update on public.campaign_members
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- campaign_queue — the workable list, compliance filters built in.
-- security_invoker: the caller's RLS applies underneath (no owner bypass).
-- ---------------------------------------------------------------------------

create or replace view public.campaign_queue
with (security_invoker = true) as
select
  cm.id                                   as member_id,
  cm.campaign_id,
  c.slug                                  as campaign_slug,
  cm.status,
  cm.priority_score,
  cm.priority_reasons,
  cm.attempts,
  cm.last_attempt_at,
  cm.callback_at,
  cm.assigned_to,
  (cm.status = 'callback' and cm.callback_at <= now()) as callback_due,
  l.id                                    as lead_id,
  l.full_name,
  l.phone,
  l.age_band,
  l.tags,
  l.channel_consent,
  coalesce(eng.score, 0)                  as engagement_score,
  eng.last_event_at
from public.campaign_members cm
join public.campaigns c on c.id = cm.campaign_id
join public.leads l     on l.id = cm.lead_id
left join lateral (
  select sum(e.points)::int as score, max(e.created_at) as last_event_at
  from public.events e
  where e.lead_id = l.id
) eng on true
where not l.do_not_contact                                   -- suppression, structural
  and c.status = 'active'
  and cm.status in ('queued', 'assigned', 'callback')
  and (cm.status <> 'callback' or cm.callback_at <= now())   -- future callbacks hidden
  and cm.attempts < c.max_attempts                           -- frequency cap
  and (cm.last_attempt_at is null
       or cm.last_attempt_at < now() - make_interval(days => c.retry_cooldown_days));

comment on view public.campaign_queue is
  'Workable members only: DNC excluded, campaign active, callbacks due, attempt cap and cooldown honoured. Pairs with src/lib/campaign-rules.ts. Agents read the queue through this view exclusively.';

-- ---------------------------------------------------------------------------
-- campaign_stats — funnel numbers for /agents/campaign
-- ---------------------------------------------------------------------------

create or replace view public.campaign_stats
with (security_invoker = true) as
select
  c.id          as campaign_id,
  c.slug,
  c.name,
  c.status      as campaign_status,
  count(cm.id)                                                    as members,
  count(cm.id) filter (where cm.status = 'queued')                as queued,
  count(cm.id) filter (where cm.status = 'callback')              as callback,
  count(cm.id) filter (where cm.status = 'contacted')             as contacted,
  count(cm.id) filter (where cm.status = 'interested')            as interested,
  count(cm.id) filter (where cm.status = 'converted')             as converted,
  count(cm.id) filter (where cm.status = 'opted_out')             as opted_out,
  count(cm.id) filter (where cm.status = 'exhausted')             as exhausted,
  sum(cm.attempts)                                                as total_attempts
from public.campaigns c
left join public.campaign_members cm on cm.campaign_id = c.id
group by c.id;

comment on view public.campaign_stats is
  'Member counts by status per campaign. Read by /agents/campaign.';

-- ---------------------------------------------------------------------------
-- quiz_funnel — recreated to filter by quiz slug so a second quiz cannot
-- contaminate the retirement funnel. Legacy events carry no metadata.quiz and
-- count as the retirement quiz via coalesce.
-- ---------------------------------------------------------------------------

create or replace view public.quiz_funnel as
select f.step, f.label, f.sessions
from (
  select
    0                       as step,
    'Opened the quiz'       as label,
    count(distinct session_id)::int as sessions
  from public.events
  where event_type = 'quiz_started'
    and coalesce(metadata ->> 'quiz', 'retirement_health_score') = 'retirement_health_score'

  union all

  select
    s.step,
    'Answered question ' || s.step,
    count(distinct e.session_id)::int
  from generate_series(1, 8) as s(step)
  left join public.events e
    on e.event_type = 'quiz_question_answered'
   and coalesce(e.metadata ->> 'quiz', 'retirement_health_score') = 'retirement_health_score'
   and case
         when e.metadata ->> 'step' ~ '^[0-9]{1,2}$'
         then (e.metadata ->> 'step')::int
         else 0
       end >= s.step
  group by s.step

  union all

  select
    9,
    'Saw their score',
    count(distinct session_id)::int
  from public.events
  where event_type = 'quiz_completed'
    and coalesce(metadata ->> 'quiz', 'retirement_health_score') = 'retirement_health_score'
) f
order by f.step;

comment on view public.quiz_funnel is
  'Retirement Health Score drop-off by question. sessions = distinct sessions that reached at least this step.';

revoke all on public.quiz_funnel from anon;
revoke all on public.quiz_funnel from authenticated;
