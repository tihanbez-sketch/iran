/**
 * Shown to a signed-in Supabase user who has no ACTIVE agent_profiles row.
 * The middleware only checks the session; provisioning is checked per page,
 * and this dead-ends politely instead of redirect-looping to the login.
 */

import { SignOutButton } from './SignOutButton';

export function NotProvisioned() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-white p-6 sm:p-8">
      <h1 className="text-2xl font-semibold text-ink">Almost there</h1>
      <p className="mt-3 text-ink-soft">
        You are signed in, but this account has not been activated as an agent yet. Ask an
        administrator to add your profile, then sign in again.
      </p>
      <div className="mt-5">
        <SignOutButton />
      </div>
    </div>
  );
}
