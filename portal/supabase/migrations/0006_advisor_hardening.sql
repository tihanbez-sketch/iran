-- ---------------------------------------------------------------------------
-- Security-advisor hardening (findings from the first production lint)
--
-- 1. Supabase's default privileges grant EXECUTE on new functions to anon,
--    authenticated and service_role — so 0005's `revoke ... from public` did
--    not strip anon's explicitly-defaulted grant on the two role predicates.
--    They only return booleans, but anon has no business calling anything.
--    authenticated KEEPS execute: RLS policy expressions evaluate them as the
--    querying role — that advisor warning is intentional and accepted.
--
-- 2. touch_updated_at() had a role-mutable search_path. It references no
--    tables (only NEW), so an empty pinned search_path is correct.
--
-- Run after 0005.
-- ---------------------------------------------------------------------------

revoke execute on function public.is_active_agent()  from anon;
revoke execute on function public.is_admin_agent()   from anon;

alter function public.touch_updated_at() set search_path = '';
