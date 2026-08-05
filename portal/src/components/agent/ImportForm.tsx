'use client';

/**
 * Admin book import. The flow is deliberately two-step: a dry run parses,
 * validates and plans without writing anything, and only a successful dry
 * run unlocks the live button — nobody imports 3,500 customers unreviewed.
 */

import { useState } from 'react';

interface RowIssue {
  rowNumber: number;
  errors?: string[];
  warnings?: string[];
  reason?: string;
}

interface ImportReport {
  parsed: number;
  creates: number;
  merges: number;
  links: number;
  skipped: number;
  errorRows: number;
  warnings: RowIssue[];
  rowErrors: RowIssue[];
  skippedRows: RowIssue[];
}

interface ExecutionReport {
  leadsCreated: number;
  leadsMerged: number;
  leadsLinked: number;
  policiesUpserted: number;
  membersEnrolled: number;
  failures: Array<{ rowNumber: number; stage: string; message: string }>;
}

interface ImportResponse {
  ok?: boolean;
  dryRun?: boolean;
  report?: ImportReport;
  execution?: ExecutionReport;
  error?: string;
}

const CAMPAIGN_SLUG = 'life_cover_gap';
const MAX_LISTED = 50;

function IssueTable({ title, rows }: { title: string; rows: RowIssue[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold text-ink">
        {title} ({rows.length})
      </h3>
      <div className="mt-2 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-100 border-collapse bg-white text-sm">
          <thead>
            <tr className="bg-parchment-deep text-left">
              <th className="px-3 py-2 font-medium text-ink">Row</th>
              <th className="px-3 py-2 font-medium text-ink">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, MAX_LISTED).map((row) => (
              <tr key={`${title}-${row.rowNumber}`} className="border-t border-line align-top">
                <td className="px-3 py-2 tabular-nums text-ink-soft">{row.rowNumber}</td>
                <td className="px-3 py-2 text-ink-soft">
                  {(row.errors ?? row.warnings ?? [row.reason ?? '']).join('; ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > MAX_LISTED && (
        <p className="mt-1 text-xs text-ink-muted">…and {rows.length - MAX_LISTED} more.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <p className="text-2xl font-semibold text-ink tabular-nums">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}

export function ImportForm() {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState<'dry' | 'live' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [dryRunPassed, setDryRunPassed] = useState(false);

  function loadFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ''));
      setResult(null);
      setDryRunPassed(false);
    };
    reader.readAsText(file);
  }

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'dry' : 'live');
    setError(null);
    try {
      const res = await fetch('/api/agent/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, dryRun, campaignSlug: CAMPAIGN_SLUG }),
      });
      const data = (await res.json().catch(() => ({}))) as ImportResponse;
      if (!res.ok) {
        setError(data.error ?? 'Import failed.');
        setResult(null);
        return;
      }
      setResult(data);
      if (dryRun) setDryRunPassed(true);
    } catch {
      setError('Network problem — nothing was imported.');
    } finally {
      setBusy(null);
    }
  }

  const report = result?.report;
  const execution = result?.execution;

  return (
    <div>
      <div className="rounded-2xl border border-line bg-white p-6">
        <label htmlFor="book-csv" className="block text-sm font-medium text-ink">
          Paste the book export (CSV) or choose the file
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => loadFile(e.target.files?.[0])}
          className="mt-2 block text-sm text-ink-soft"
        />
        <textarea
          id="book-csv"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setResult(null);
            setDryRunPassed(false);
          }}
          rows={8}
          spellCheck={false}
          placeholder={'name,phone,id_number,policy_number,premium,start_date\n…'}
          className="mt-3 w-full rounded-lg border border-line bg-parchment px-3.5 py-2.5 font-mono text-xs text-ink"
        />
        <p className="mt-2 text-xs text-ink-muted">
          Needs at least name, phone and policy number columns. SA ID numbers are used only to work
          out an age band and are never stored. Delete the source file once the import is done.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy !== null || csv.trim().length === 0}
            onClick={() => void run(true)}
            className="rounded-xl bg-ink px-6 py-3 text-sm font-medium text-parchment transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === 'dry' ? 'Checking…' : 'Dry run (nothing is written)'}
          </button>
          <button
            type="button"
            disabled={busy !== null || !dryRunPassed}
            onClick={() => void run(false)}
            className="rounded-xl border border-alert/40 px-6 py-3 text-sm font-medium text-alert transition-colors hover:bg-alert/10 disabled:opacity-50"
            title={dryRunPassed ? undefined : 'Run the dry run first'}
          >
            {busy === 'live' ? 'Importing…' : 'Import for real'}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-alert/10 px-3.5 py-2.5 text-sm text-alert">
          {error}
        </p>
      )}

      {report && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-ink">
            {result?.dryRun ? 'Dry-run result' : 'Import result'}
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Rows parsed" value={report.parsed} />
            <Stat label="New customers" value={report.creates} />
            <Stat label="Book re-runs" value={report.merges} />
            <Stat label="Linked to web leads" value={report.links} />
            <Stat label="Skipped duplicates" value={report.skipped} />
            <Stat label="Rows with errors" value={report.errorRows} />
          </div>

          {execution && (
            <div className="mt-5 rounded-2xl border border-positive/30 bg-positive/5 p-5">
              <h3 className="text-sm font-semibold text-ink">Written to the database</h3>
              <p className="mt-2 text-sm text-ink-soft">
                {execution.leadsCreated} customers created, {execution.leadsMerged} refreshed,{' '}
                {execution.leadsLinked} linked · {execution.policiesUpserted} policies ·{' '}
                {execution.membersEnrolled} enrolled into the campaign queue.
              </p>
              {execution.failures.length > 0 && (
                <IssueTable
                  title="Rows that failed to write"
                  rows={execution.failures.map((f) => ({
                    rowNumber: f.rowNumber,
                    reason: `${f.stage}: ${f.message}`,
                  }))}
                />
              )}
            </div>
          )}

          <IssueTable title="Rows rejected" rows={report.rowErrors} />
          <IssueTable title="Skipped (duplicates in file)" rows={report.skippedRows} />
          <IssueTable title="Warnings" rows={report.warnings} />
        </section>
      )}
    </div>
  );
}
