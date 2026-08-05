/**
 * /agents/set-password — lands after the invite (or recovery) link has been
 * verified by /agents/auth/confirm. The API route behind the form requires
 * the session that verification created.
 */

import { SetPasswordForm } from '@/components/agent/SetPasswordForm';

export const dynamic = 'force-dynamic';

export default function SetPasswordPage() {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold text-ink">Choose your password</h1>
      <p className="mt-2 text-ink-soft">
        Your account is verified — set the password you will sign in with. Never share it: every
        action in the workspace is recorded against your name.
      </p>
      <div className="mt-7 rounded-2xl border border-line bg-white p-6 sm:p-8">
        <SetPasswordForm />
      </div>
    </div>
  );
}
