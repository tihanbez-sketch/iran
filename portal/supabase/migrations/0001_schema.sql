-- ---------------------------------------------------------------------------
-- PFL Super Lead Portal — Phase 1 schema
--
--   leads        one row per person who has given us their details
--   events       every tracked interaction, carrying its point value
--   lead_scores  view summing points per lead into a score and a band
--
-- Run with: supabase db push   (or paste into the SQL editor)
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------

create table if not exists public.leads (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  full_name           text        not null,
  -- Normalised to lowercase by the application before insert, so this plain
  -- unique constraint is enough for ON CONFLICT and needs no citext extension.
  email               text        not null unique,
  phone               text,

  source              text        not null default 'retirement_health_score',
  status              text        not null default 'new'
                      check (status in ('new', 'contacted', 'qualified', 'client', 'archived')),

  -- Interest tags from the quiz (retirement / risk / debt / gepf / ...),
  -- used to route the lead into the matching nurture sequence.
  tags                text[]      not null default '{}',

  -- POPIA. consent_privacy_at is when the visitor accepted the privacy policy;
  -- consent_marketing is separate and genuinely optional.
  consent_privacy_at  timestamptz not null,
  consent_marketing   boolean     not null default false,

  advisor_notes       text,

  constraint leads_email_not_blank check (length(trim(email)) > 0)
);

comment on table  public.leads is 'People who have given PFL their contact details. Personal information under POPIA.';
comment on column public.leads.tags is 'Interest tags derived from quiz answers; drives nurture sequence selection.';
comment on column public.leads.consent_privacy_at is 'When the visitor accepted the privacy policy. Required at every capture point.';

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_tags_idx        on public.leads using gin (tags);

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  -- Null until the visitor identifies themselves. Anonymous events are
  -- stitched to the lead by session_id at capture time.
  lead_id     uuid        references public.leads (id) on delete cascade,
  session_id  text        not null,

  event_type  text        not null,
  metadata    jsonb       not null default '{}'::jsonb,

  -- Written by the application from src/lib/lead-scoring.ts so the weights
  -- live in exactly one place and the view below stays a plain SUM.
  points      integer     not null default 0,

  constraint events_points_sane check (points between 0 and 1000)
);

comment on table  public.events is 'Every tracked interaction. Sums into a lead score via public.lead_scores.';
comment on column public.events.points is 'Point value at time of insert, from src/lib/lead-scoring.ts. Historical scores stay stable if weights are retuned.';
comment on column public.events.metadata is 'Event payload. For quiz_completed this holds the answers, score and breakdown.';

create index if not exists events_lead_id_idx    on public.events (lead_id, created_at desc);
create index if not exists events_session_id_idx on public.events (session_id, created_at desc);
create index if not exists events_type_idx       on public.events (event_type, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_touch_updated_at on public.leads;
create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- lead_scores — the advisor's ranked worklist
--
-- Thresholds mirror src/lib/lead-scoring.ts:
--   >= 60  hot      call today
--   30-59  warm     nurture and follow up this week
--   <  30  nurture  nurture sequence only
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
  max(e.created_at)                        as last_event_at
from public.leads l
left join public.events e on e.lead_id = l.id
group by l.id;

comment on view public.lead_scores is 'Ranked advisor worklist. Order by score desc for hottest-first.';
