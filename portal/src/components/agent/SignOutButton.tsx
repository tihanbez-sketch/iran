'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/agent/logout', { method: 'POST' });
    } finally {
      router.push('/agents');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-parchment-deep disabled:opacity-50"
    >
      Sign out
    </button>
  );
}
