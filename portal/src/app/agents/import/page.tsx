/**
 * /agents/import — admin-only funeral-book import. The heavy lifting is the
 * ImportForm client component against POST /api/agent/import.
 */

import { ImportForm } from '@/components/agent/ImportForm';
import { requireAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const admin = await requireAdmin();
  if (!admin) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-semibold text-ink">Admin only</h1>
        <p className="mt-3 text-ink-soft">
          Importing the book needs an administrator account. Ask the workspace admin to run it, or
          to grant your profile the admin role.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold text-ink">Import the funeral book</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">
        Paste or choose the policy export. Run the dry run first — it checks every row and shows
        exactly what would happen. Existing customers are refreshed, never duplicated, and their
        consent history is never overwritten.
      </p>
      <div className="mt-7">
        <ImportForm />
      </div>
    </div>
  );
}
