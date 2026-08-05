/**
 * /agents — sign-in for the call-centre workspace. Signed-in users never see
 * this: the middleware redirects them to the queue.
 */

import { LoginForm } from '@/components/agent/LoginForm';
import { isAuthConfigured } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function AgentLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold text-ink">Agent workspace</h1>
      <p className="mt-2 text-ink-soft">
        For PFL call-centre staff. Accounts are created by invitation only.
      </p>

      {notice === 'invite_invalid' && (
        <p role="alert" className="mt-5 rounded-lg bg-alert/10 px-3.5 py-2.5 text-sm text-alert">
          That invitation link is invalid or has expired. Ask an administrator to send a new one.
        </p>
      )}

      <div className="mt-7 rounded-2xl border border-line bg-white p-6 sm:p-8">
        {isAuthConfigured() ? (
          <LoginForm />
        ) : (
          <p className="text-sm text-ink-soft">
            Sign-in is not configured in this environment. Set SUPABASE_URL and SUPABASE_ANON_KEY,
            then apply migrations 0004 and 0005.
          </p>
        )}
      </div>
    </div>
  );
}
