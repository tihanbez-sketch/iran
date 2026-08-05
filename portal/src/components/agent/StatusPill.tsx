/**
 * Small status chip for queue members, campaigns and leads. Pure — renders
 * server- or client-side. Unknown statuses fall back to neutral so a new
 * lifecycle state can never crash a page.
 */

const STYLES: Record<string, string> = {
  queued: 'bg-parchment-deep text-ink-soft',
  assigned: 'bg-parchment-deep text-ink-soft',
  contacted: 'bg-parchment-deep text-ink-soft',
  callback: 'bg-gold-soft text-ink',
  interested: 'bg-positive/10 text-positive',
  converted: 'bg-positive text-white',
  opted_out: 'bg-alert/10 text-alert',
  exhausted: 'bg-parchment-deep text-ink-muted',
  active: 'bg-positive/10 text-positive',
  paused: 'bg-gold-soft text-ink',
  draft: 'bg-parchment-deep text-ink-soft',
  completed: 'bg-parchment-deep text-ink-muted',
  do_not_contact: 'bg-alert text-white',
};

const LABELS: Record<string, string> = {
  queued: 'Queued',
  assigned: 'Assigned',
  contacted: 'Contacted',
  callback: 'Callback',
  interested: 'Interested',
  converted: 'Booked',
  opted_out: 'Opted out',
  exhausted: 'Exhausted',
  do_not_contact: 'Do not contact',
};

export function StatusPill({ status }: { status: string }) {
  const style = STYLES[status] ?? 'bg-parchment-deep text-ink-soft';
  const label = LABELS[status] ?? status.replace(/_/g, ' ');
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${style}`}
    >
      {label}
    </span>
  );
}
