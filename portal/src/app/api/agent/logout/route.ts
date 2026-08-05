/**
 * POST /api/agent/logout — clears the Supabase session cookies.
 */

import { NextResponse } from 'next/server';

import { createUserClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createUserClient();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
