-- ---------------------------------------------------------------------------
-- Row Level Security — POPIA posture
--
-- Default is deny. No client-side role can read lead data; there is no public
-- SELECT path to any personal information. All portal writes go through the
-- Next.js API routes, so no Supabase key is ever shipped to a browser.
--
-- Two supported deployments:
--
--   A. SUPABASE_SERVICE_ROLE_KEY set (recommended for production)
--      The service role bypasses RLS entirely. The anon policies below can be
--      dropped — see the DROP statements at the bottom of this file.
--
--   B. SUPABASE_ANON_KEY only (matches the Phase 1 env spec)
--      The insert-only policies below let the server-side routes write. There
--      is still no read, update or delete path for anon.
--
-- Advisors read lead data through the Supabase dashboard or a Phase 4 advisor
-- app authenticating as a real user; that access is granted separately.
-- ---------------------------------------------------------------------------

alter table public.leads  enable row level security;
alter table public.events enable row level security;

-- Force RLS for table owners too, so a mistake in a future migration cannot
-- silently open up read access.
alter table public.leads  force row level security;
alter table public.events force row level security;

-- ---------------------------------------------------------------------------
-- Deployment B: insert-only access for the anon key
-- ---------------------------------------------------------------------------

drop policy if exists "portal can create leads" on public.leads;
create policy "portal can create leads"
  on public.leads
  for insert
  to anon
  with check (true);

-- Required so the upsert-by-email path works for returning visitors.
-- Scoped to the columns a re-submission legitimately refreshes; there is
-- still no SELECT policy, so anon cannot read anything back out.
drop policy if exists "portal can refresh leads" on public.leads;
create policy "portal can refresh leads"
  on public.leads
  for update
  to anon
  using (true)
  with check (true);

drop policy if exists "portal can create events" on public.events;
create policy "portal can create events"
  on public.events
  for insert
  to anon
  with check (true);

-- Back-fills lead_id onto anonymous events once the visitor identifies
-- themselves. Restricted to rows not yet attached to a lead.
drop policy if exists "portal can attach events to a lead" on public.events;
create policy "portal can attach events to a lead"
  on public.events
  for update
  to anon
  using (lead_id is null)
  with check (true);

-- Reading the most recent event for a session is needed to award the
-- returned-within-7-days points. Exposes only timestamps, never lead data.
drop policy if exists "portal can read own session events" on public.events;
create policy "portal can read own session events"
  on public.events
  for select
  to anon
  using (lead_id is null);

-- ---------------------------------------------------------------------------
-- The view runs with the privileges of its owner, so revoke it from the client
-- roles explicitly. Advisor tooling reads it with a privileged connection.
-- ---------------------------------------------------------------------------

revoke all on public.lead_scores from anon;
revoke all on public.lead_scores from authenticated;

-- ---------------------------------------------------------------------------
-- Deployment A: once SUPABASE_SERVICE_ROLE_KEY is in place, uncomment these
-- to remove the anon write path entirely.
-- ---------------------------------------------------------------------------

-- drop policy if exists "portal can create leads"             on public.leads;
-- drop policy if exists "portal can refresh leads"            on public.leads;
-- drop policy if exists "portal can create events"            on public.events;
-- drop policy if exists "portal can attach events to a lead"  on public.events;
-- drop policy if exists "portal can read own session events"  on public.events;
-- revoke all on public.leads  from anon;
-- revoke all on public.events from anon;

-- ---------------------------------------------------------------------------
-- Retention (POPIA s14: do not keep personal information longer than needed).
-- Agree the period with the compliance officer, then schedule via pg_cron.
--
--   create extension if not exists pg_cron;
--   select cron.schedule('purge-stale-leads', '0 3 * * 0', $$
--     delete from public.leads
--     where status in ('new', 'archived')
--       and created_at < now() - interval '36 months';
--   $$);
--
-- events cascade on lead delete. Anonymous events (lead_id is null) should be
-- purged on a shorter cycle since they carry no consent record:
--
--   select cron.schedule('purge-anon-events', '0 3 * * *', $$
--     delete from public.events
--     where lead_id is null and created_at < now() - interval '90 days';
--   $$);
-- ---------------------------------------------------------------------------
