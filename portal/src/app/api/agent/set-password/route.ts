/**
 * POST /api/agent/set-password
 *
 * Completes the invite flow: /agents/auth/confirm verified the invite token
 * and created a session; this sets the account's real password. The
 * middleware guarantees a signed-in user — an agent_profiles row is NOT
 * required here, because a freshly invited but mis-provisioned user must
 * still be able to finish the flow (login will then tell them to ask an
 * administrator).
 */

import { NextResponse } from 'next/server';

import { setPasswordSchema } from '@/lib/agent-validation';
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

  const parsed = setPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Choose a longer password', fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const supabase = await createUserClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error('[agent] set-password failed', error.message);
    return NextResponse.json({ error: 'Could not set the password. Try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
