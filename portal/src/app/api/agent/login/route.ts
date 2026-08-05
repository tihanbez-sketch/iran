/**
 * POST /api/agent/login
 *
 * Password sign-in for call-centre agents. The only /api/agent route the
 * middleware leaves open. Sign-in alone is not enough: a Supabase user
 * without an ACTIVE agent_profiles row is signed straight back out — auth
 * grants nothing without provisioning (mirrors the RLS predicates in 0005).
 */

import { NextResponse } from 'next/server';

import { loginSchema } from '@/lib/agent-validation';
import { createUserClient } from '@/lib/supabase-server';
import { fieldErrors } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Enter your email and password', fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const supabase = await createUserClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // Deliberately the same message for wrong email and wrong password.
    return NextResponse.json({ error: 'Email or password is incorrect' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('agent_profiles')
    .select('display_name, role, active')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (!profile?.active) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: 'This account is not an active agent. Ask an administrator.' },
      { status: 403 },
    );
  }

  return NextResponse.json({
    ok: true,
    agent: { displayName: profile.display_name as string, role: profile.role as string },
  });
}
