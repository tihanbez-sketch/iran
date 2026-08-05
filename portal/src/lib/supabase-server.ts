/**
 * User-context Supabase clients — the agent workspace's data path.
 *
 * The split with ./supabase.ts is deliberate:
 *
 *   supabase.ts        service-role/anon singleton. Anon-facing routes and
 *                      admin batch writes (import). RLS does not constrain it.
 *   supabase-server.ts per-request clients bound to the signed-in agent's
 *                      session cookies. RLS genuinely constrains every query,
 *                      so a bug in an agent route cannot read or write more
 *                      than 0005's policies allow. Defence in depth.
 *
 * No Supabase key ever ships to the browser: sign-in happens in a route
 * handler and the browser holds only the session cookies.
 */

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export interface AgentProfile {
  user_id: string;
  display_name: string;
  role: 'agent' | 'admin';
  active: boolean;
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

/** Per-request client authenticated as whoever owns the session cookies. */
export async function createUserClient(): Promise<SupabaseClient | null> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies; middleware refreshes the
          // session, so swallowing here is the documented @supabase/ssr shape.
        }
      },
    },
  });
}

export interface AuthenticatedAgent {
  user: User;
  profile: AgentProfile;
  client: SupabaseClient;
}

/**
 * The signed-in agent, or null. A Supabase user WITHOUT an active
 * agent_profiles row is treated as unauthenticated — auth alone grants
 * nothing (mirrors the RLS predicates in 0005).
 */
export async function getAuthenticatedAgent(): Promise<AuthenticatedAgent | null> {
  const client = await createUserClient();
  if (!client) return null;

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  const { data: profile } = await client
    .from('agent_profiles')
    .select('user_id, display_name, role, active')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || !(profile as AgentProfile).active) return null;
  return { user, profile: profile as AgentProfile, client };
}

export async function requireAdmin(): Promise<AuthenticatedAgent | null> {
  const agent = await getAuthenticatedAgent();
  if (!agent || agent.profile.role !== 'admin') return null;
  return agent;
}
