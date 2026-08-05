/**
 * Auth boundary for the agent workspace.
 *
 * Everything under /agents and /api/agent requires a Supabase session; the
 * public site and the three anon API routes are outside the matcher and
 * completely untouched. The login page itself (/agents) and the invite
 * confirmation flow are exempted in-code.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_AGENT_PATHS = ['/agents', '/agents/auth/confirm', '/agents/set-password'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/agent');
  const isPublicPath = PUBLIC_AGENT_PATHS.includes(pathname);
  const isPublicApi = pathname === '/api/agent/login';

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  // Unconfigured environment (local dev without keys): the workspace cannot
  // function; let the login page render its "not configured" notice and fail
  // API calls loudly.
  if (!url || !anonKey) {
    if (isApi && !isPublicApi) {
      return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
    }
    if (!isPublicPath && !isApi) {
      return NextResponse.redirect(new URL('/agents', request.url));
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() validates against the auth server and refreshes tokens —
  // getSession() alone is spoofable and must not gate anything.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (isApi && !isPublicApi) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }
    if (!isPublicPath && !isApi) {
      return NextResponse.redirect(new URL('/agents', request.url));
    }
    return response;
  }

  // Signed in and landing on the login page: straight to work.
  if (pathname === '/agents') {
    return NextResponse.redirect(new URL('/agents/queue', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/agents/:path*', '/api/agent/:path*'],
};
