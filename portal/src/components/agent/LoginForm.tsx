'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/agent/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Sign-in failed. Try again.');
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
        <label htmlFor="agent-email" className="block text-sm font-medium text-ink">
          Email
        </label>
        <input
          id="agent-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-ink"
        />
      </div>
      <div>
        <label htmlFor="agent-password" className="block text-sm font-medium text-ink">
          Password
        </label>
        <input
          id="agent-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
