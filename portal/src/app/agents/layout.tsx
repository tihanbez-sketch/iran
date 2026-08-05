/**
 * Agent workspace shell. Renders inside the public site layout; the nav only
 * appears for a signed-in, ACTIVE agent (the middleware already bounced
 * everyone else off the nested pages — this layout also wraps the login page,
 * which is why the nav is conditional).
 */

import Link from 'next/link';

import { SignOutButton } from '@/components/agent/SignOutButton';
import { getAuthenticatedAgent } from '@/lib/supabase-server';

export const metadata = {
  title: 'Agent workspace',
  robots: { index: false, follow: false },
};

export default async function AgentsLayout({ children }: { children: React.ReactNode }) {
  const agent = await getAuthenticatedAgent();

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      {agent && (
        <nav
          aria-label="Agent workspace"
          className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line pb-4"
        >
          <Link href="/agents/queue" className="text-sm font-medium text-ink hover:underline">
            Call queue
          </Link>
          <Link href="/agents/campaign" className="text-sm font-medium text-ink hover:underline">
            Campaign
          </Link>
          {agent.profile.role === 'admin' && (
            <Link href="/agents/import" className="text-sm font-medium text-ink hover:underline">
              Import
            </Link>
          )}
          <span className="ml-auto flex items-center gap-3 text-sm text-ink-muted">
            {agent.profile.display_name}
            {agent.profile.role === 'admin' && (
              <span className="rounded-full bg-gold-soft px-2 py-0.5 text-xs font-medium text-ink">
                admin
              </span>
            )}
            <SignOutButton />
          </span>
        </nav>
      )}
      {children}
    </div>
  );
}
