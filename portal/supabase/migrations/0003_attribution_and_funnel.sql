-- ---------------------------------------------------------------------------
-- Channel attribution + quiz funnel
--
-- 1. leads.attribution — which channel produced this lead (first touch).
-- 2. lead_scores gains a `channel` column so the advisor worklist can be
--    filtered by where leads came from.
-- 3. quiz_funnel — per-question drop-off, so a weak question shows up in
--    numbers instead of hunches.
--
-- Run after 0001 and 0002.
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists attribution jsonb not null default '{}'::jsonb;

comment on column public.leads.attribution is
  'First-touch channel record from src/lib/attribution.ts: source/medium/campaign/ref, referrer hostname, landing path, firstSeenAt. No personal information.';

-- ---------------------------------------------------------------------------
-- lead_scores: same view as 0001 with channel + attribution appended.
-- (CREATE OR REPLACE VIEW may only append columns at the end.)
-- ---------------------------------------------------------------------------

create or replace view public.lead_scores as
select
  l.id                                    as lead_id,
  l.full_name,
  l.email,
  l.phone,
  l.source,
  l.status,
  l.tags,
  l.created_at,
  coalesce(sum(e.points), 0)::int          as score,
  case
    when coalesce(sum(e.points), 0) >= 60 then 'hot'
    when coalesce(sum(e.points), 0) >= 30 then 'warm'
    else 'nurture'
  end                                      as band,
  count(e.id)::int                         as event_count,
  max(e.created_at)                        as last_event_at,
  l.attribution ->> 'source'               as channel,
  l.attribution
from public.leads l
left join public.events e on e.lead_id = l.id
group by l.id;

comment on view public.lead_scores is
  'Ranked advisor worklist. Order by score desc for hottest-first; filter by channel to compare acquisition sources.';

revoke all on public.lead_scores from anon;
revoke all on public.lead_scores from authenticated;

-- ---------------------------------------------------------------------------
-- quiz_funnel: how far sessions get through the eight questions.
--
--   step 0    opened the quiz (quiz_started — fired on fresh starts only,
--             not when a stored result is restored)
--   step 1-8  answered question N (quiz_question_answered, metadata.step)
--   step 9    saw their score (quiz_completed)
--
-- A big drop between adjacent steps points at the question to fix.
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

  union all

  select
    s.step,
    'Answered question ' || s.step,
    count(distinct e.session_id)::int
  from generate_series(1, 8) as s(step)
  left join public.events e
    on e.event_type = 'quiz_question_answered'
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
) f
order by f.step;

comment on view public.quiz_funnel is
  'Quiz drop-off by question. sessions = distinct sessions that reached at least this step.';

revoke all on public.quiz_funnel from anon;
revoke all on public.quiz_funnel from authenticated;
