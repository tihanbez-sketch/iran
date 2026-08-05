/**
 * POST /api/agent/import — admin-only funeral-book import.
 *
 * Body: { csv, dryRun = true, campaignSlug = 'life_cover_gap' }.
 *
 * Dry run parses, validates and plans, and returns the full report without
 * touching the database — the admin reads it BEFORE running live; the UI
 * defaults to it. The live run needs the SERVICE ROLE key explicitly: after
 * 0005 the anon key can neither read nor write these tables, and the runbook
 * ordering (key set → 0005 applied → import) is enforced here, not assumed.
 *
 * POPIA note: the CSV passes through this handler transiently. SA ID numbers
 * are consumed inside validateRow() to derive an age band and appear in no
 * output, no log and no stored row — asserted by tests/book-import.test.ts.
 */

import { NextResponse } from 'next/server';

import {
  mapColumns,
  parseCsv,
  planImport,
  summarizeImport,
  validateRow,
} from '@/lib/book-import';
import { importSchema } from '@/lib/agent-validation';
import {
  executeImportPlan,
  fetchCampaignBySlug,
  fetchExistingForImport,
} from '@/lib/import-executor';
import { getSupabase } from '@/lib/supabase';
import { requireAdmin } from '@/lib/supabase-server';
import { fieldErrors } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 3,500 rows in chunked round-trips can exceed the default budget.
export const maxDuration = 300;

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid import request', fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  // The runbook gate. Without the service key we could neither read existing
  // leads (for dedupe) nor write — fail loudly with the fix, not a mystery.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      {
        error:
          'SUPABASE_SERVICE_ROLE_KEY is not set. The runbook order is: set the key, apply migration 0005, then import.',
      },
      { status: 503 },
    );
  }
  const service = getSupabase();
  if (!service) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  }

  /* ---- Parse + validate (pure) ------------------------------------------- */

  const { header, rows, errors: csvErrors } = parseCsv(parsed.data.csv);
  const mapping = mapColumns(header);
  if (mapping.missing.length > 0) {
    return NextResponse.json(
      {
        error: `Missing required columns: ${mapping.missing.join(', ')}`,
        detectedHeader: header,
      },
      { status: 400 },
    );
  }

  const asOf = new Date();
  const results = rows.map((row, i) => validateRow(row, mapping, i + 2, asOf));

  /* ---- Plan against what already exists ---------------------------------- */

  const phones = results.flatMap((r) => (r.ok ? [r.lead.phoneE164] : []));
  const policyNumbers = results.flatMap((r) => (r.ok ? [r.policy.policyNumber] : []));

  const existing = await fetchExistingForImport(service, phones, policyNumbers);
  if (!existing.ok) {
    console.error('[import] existing-data lookup failed', existing.error);
    return NextResponse.json({ error: existing.error }, { status: 500 });
  }

  const plan = planImport(results, {
    leadsByPhone: existing.leadsByPhone,
    policyKeys: existing.policyKeys,
  });
  const report = summarizeImport(plan, results);

  if (parsed.data.dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, report, csvErrors });
  }

  /* ---- Live run ----------------------------------------------------------- */

  const campaign = await fetchCampaignBySlug(service, parsed.data.campaignSlug);
  if (!campaign.ok) {
    return NextResponse.json({ error: campaign.error }, { status: 400 });
  }

  const execution = await executeImportPlan(service, plan, campaign.campaign, asOf);
  if (execution.failures.length > 0) {
    console.error(
      `[import] ${execution.failures.length} row(s) failed`,
      JSON.stringify(execution.failures.slice(0, 20)),
    );
  }

  return NextResponse.json({ ok: true, dryRun: false, report, csvErrors, execution });
}
