-- ---------------------------------------------------------------------------
-- Agent authentication + RLS, and the anon-policy teardown
--
-- The agent workspace is the app's first authenticated surface. Agents are
-- Supabase Auth users with a row in agent_profiles; RLS gates everything on
-- that row. Provisioning for the pilot is invite-only (see the runbook and
-- the commented snippet at the bottom).
--
-- ⚠ ORDERING IS LOAD-BEARING. This migration REMOVES the anon write policies
-- from 0002 ("Deployment A"). The web funnel keeps working ONLY if
-- SUPABASE_SERVICE_ROLE_KEY is set on the server first:
--
--     1. set SUPABASE_SERVICE_ROLE_KEY in the deployment
--     2. apply this migration
--     3. only then import the book
--
-- With 3,500 real customers' names and phone numbers in `leads`, the 0002
-- anon policies (unrestricted UPDATE among them) must not survive.
--
-- Run after 0004.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- agent_profiles
-- ---------------------------------------------------------------------------

create table if not exists public.agent_profiles (
  user_id      uuid        primary key references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  display_name text        not null,
  role         text        not null default 'agent' check (role in ('agent', 'admin')),
  active       boolean     not null default true
);

comment on table public.agent_profiles is
  'Call-centre agents and admins. A Supabase Auth user without a row here (or with active=false) has no access to anything.';

alter table public.agent_profiles enable row level security;
alter table public.agent_profiles force row level security;

drop policy if exists "agents can read their own profile" on public.agent_profiles;
create policy "agents can read their own profile"
  on public.agent_profiles
  for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Helper predicates. SECURITY DEFINER so policies on other tables can consult
-- agent_profiles without RLS recursion; search_path pinned.
-- ---------------------------------------------------------------------------

create or replace function public.is_active_agent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.agent_profiles
    where user_id = auth.uid() and active
  );
$$;

create or replace function public.is_admin_agent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.agent_profiles
    where user_id = auth.uid() and active and role = 'admin'
  );
$$;

revoke all on function public.is_active_agent() from public;
revoke all on function public.is_admin_agent() from public;
grant execute on function public.is_active_agent() to authenticated;
grant execute on function public.is_admin_agent() to authenticated;

-- ---------------------------------------------------------------------------
-- Grants + policies for authenticated agents
-- ---------------------------------------------------------------------------

-- leads: agents may read, and may update ONLY the annotation/suppression
-- columns. Identity, consent history and attribution are frozen to agents —
-- enforced at the column-privilege level, beneath the row policies.
grant select on public.leads to authenticated;
revoke update on public.leads from authenticated;
grant update (status, advisor_notes, do_not_contact, do_not_contact_reason,
              do_not_contact_at, channel_consent)
  on public.leads to authenticated;

drop policy if exists "agents can read leads" on public.leads;
create policy "agents can read leads"
  on public.leads
  for select
  to authenticated
  using (public.is_active_agent());

drop policy if exists "agents can annotate leads" on public.leads;
create policy "agents can annotate leads"
  on public.leads
  for update
  to authenticated
  using (public.is_active_agent())
  with check (public.is_active_agent());

-- events: agents read history and record dispositions. Points are stamped
-- server-side from lead-scoring.ts; the CHECK 0..1000 still applies.
grant select, insert on public.events to authenticated;

drop policy if exists "agents can read events" on public.events;
create policy "agents can read events"
  on public.events
  for select
  to authenticated
  using (public.is_active_agent());

drop policy if exists "agents can record events" on public.events;
create policy "agents can record events"
  on public.events
  for insert
  to authenticated
  with check (public.is_active_agent());

-- policies / campaigns: read-only for agents; writes are service-role only
-- (import and admin tooling).
grant select on public.policies to authenticated;
grant select on public.campaigns to authenticated;

drop policy if exists "agents can read policies" on public.policies;
alter table public.policies enable row level security;
alter table public.policies force row level security;
create policy "agents can read policies"
  on public.policies
  for select
  to authenticated
  using (public.is_active_agent());

drop policy if exists "agents can read campaigns" on public.campaigns;
alter table public.campaigns enable row level security;
alter table public.campaigns force row level security;
create policy "agents can read campaigns"
  on public.campaigns
  for select
  to authenticated
  using (public.is_active_agent());

-- campaign_members: agents read and transition members. Enrolment (INSERT)
-- is service-role only, at import time.
alter table public.campaign_members enable row level security;
alter table public.campaign_members force row level security;

grant select, update on public.campaign_members to authenticated;

drop policy if exists "agents can read campaign members" on public.campaign_members;
create policy "agents can read campaign members"
  on public.campaign_members
  for select
  to authenticated
  using (public.is_active_agent());

drop policy if exists "agents can transition campaign members" on public.campaign_members;
create policy "agents can transition campaign members"
  on public.campaign_members
  for update
  to authenticated
  using (public.is_active_agent())
  with check (public.is_active_agent());

-- Views: security_invoker, so these grants expose only what the policies
-- above already allow.
grant select on public.campaign_queue to authenticated;
grant select on public.campaign_stats to authenticated;

-- lead_scores and quiz_funnel remain revoked from authenticated (0001/0003/0004)
-- — advisor analytics stay behind privileged access, not agent logins.

-- ---------------------------------------------------------------------------
-- Anon teardown — "Deployment A" from 0002, now mandatory.
-- The web funnel writes via server routes using the service-role key.
-- ---------------------------------------------------------------------------

drop policy if exists "portal can create leads"            on public.leads;
drop policy if exists "portal can refresh leads"           on public.leads;
drop policy if exists "portal can create events"           on public.events;
drop policy if exists "portal can attach events to a lead" on public.events;
drop policy if exists "portal can read own session events" on public.events;

revoke all on public.leads  from anon;
revoke all on public.events from anon;

-- New surfaces: nothing for anon, ever.
revoke all on public.policies         from anon;
revoke all on public.campaigns        from anon;
revoke all on public.campaign_members from anon;
revoke all on public.agent_profiles   from anon;
revoke all on public.campaign_queue   from anon;
revoke all on public.campaign_stats   from anon;

-- ---------------------------------------------------------------------------
-- Provisioning snippet (run per agent, after inviting the user in the
-- dashboard: Authentication -> Users -> Invite user). One named account per
-- human — dispositions, assignment and the consent audit trail are per-agent.
--
--   insert into public.agent_profiles (user_id, display_name, role)
--   values ('<auth user uuid>', 'Agent Full Name', 'agent');
--
--   -- First admin (can import the book):
--   -- values ('<auth user uuid>', 'Admin Full Name', 'admin');
-- ---------------------------------------------------------------------------
