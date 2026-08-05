/**
 * POST /api/agent/disposition
 *
 * The one write path agents have: record what happened on a call. Validation
 * is the DISPOSITIONS state machine; writes run through recordDisposition()
 * on the agent's OWN RLS-constrained client — the column grants in 0005 are
 * live here, not decoration. Lead patch first, member second, events last.
 */

import { NextResponse } from 'next/server';

import { recordDisposition } from '@/lib/agent-data';
import { dispositionSchema } from '@/lib/agent-validation';
import { getAuthenticatedAgent } from '@/lib/supabase-server';
import { fieldErrors } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const agent = await getAuthenticatedAgent();
  if (!agent) {
    return NextResponse.json({ error: 'Not signed in as an active agent' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = dispositionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid disposition', fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const outcome = await recordDisposition(agent.client, {
    ...parsed.data,
    agentUserId: agent.user.id,
  });

  if (!outcome.ok) {
    if (outcome.status >= 500) console.error('[disposition]', outcome.error);
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  return NextResponse.json({
    ok: true,
    memberStatus: outcome.memberStatus,
    attempts: outcome.attempts,
  });
}
