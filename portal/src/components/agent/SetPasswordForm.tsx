'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError('Use at least 12 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/agent/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(
          res.status === 401
            ? 'This link has expired. Ask an administrator to send a new invitation.'
            : (data.error ?? 'Could not set the password.'),
        );
        return;
      }
      router.push('/agents/queue');
      router.refresh();
    } catch {
      setError('Network problem — check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="new-password" className="block text-sm font-medium text-ink">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-ink"
        />
        <p className="mt-1 text-xs text-ink-muted">At least 12 characters.</p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="block text-sm font-medium text-ink">
          Repeat it
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-ink"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-alert/10 px-3.5 py-2.5 text-sm text-alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-ink px-6 py-3 font-medium text-parchment transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Set password and start'}
      </button>
    </form>
  );
}
