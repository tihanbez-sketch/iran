/**
 * GET /agents/auth/confirm — lands the links in Supabase auth emails.
 *
 * Invite and recovery emails point here with ?token_hash=…&type=…; verifying
 * the token creates a session (cookies set on this response), after which the
 * user goes to set-password (invite/recovery) or straight to the queue. The
 * middleware exempts this path, and a bad or expired token falls through to
 * the login page with a notice — never a stack trace.
 *
 * Supabase email templates must use:
 *   {{ .SiteURL }}/agents/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}
 */

import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createUserClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OTP_TYPES: readonly EmailOtpType[] = [
  'invite',
  'recovery',
  'signup',
  'magiclink',
  'email',
  'email_change',
];

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const typeParam = request.nextUrl.searchParams.get('type') as EmailOtpType | null;
  const type = typeParam && OTP_TYPES.includes(typeParam) ? typeParam : null;

  if (tokenHash && type) {
    const supabase = await createUserClient();
    if (supabase) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (!error) {
        const next = type === 'invite' || type === 'recovery' ? '/agents/set-password' : '/agents/queue';
        return NextResponse.redirect(new URL(next, request.url));
      }
      console.warn('[agent] auth confirm failed:', error.message);
    }
  }

  return NextResponse.redirect(new URL('/agents?notice=invite_invalid', request.url));
}
