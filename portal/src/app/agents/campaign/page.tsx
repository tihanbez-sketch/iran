/**
 * /agents/campaign — the outbound funnel at a glance, per campaign.
 * Reads the campaign_stats view; conversion = booked calls / members.
 */

import { NotProvisioned } from '@/components/agent/NotProvisioned';
import { StatusPill } from '@/components/agent/StatusPill';
import { fetchCampaignStats } from '@/lib/agent-data';
import { getAuthenticatedAgent } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function CampaignPage() {
  const agent = await getAuthenticatedAgent();
  if (!agent) return <NotProvisioned />;

  const result = await fetchCampaignStats(agent.client);
  if (!result.ok) {
    return (
      <p role="alert" className="rounded-lg bg-alert/10 px-4 py-3 text-alert">
        Could not load campaign numbers: {result.error}
      </p>
    );
  }

  if (result.stats.length === 0) {
    return <p className="text-ink-soft">No campaigns yet.</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-ink">Campaigns</h1>

      {result.stats.map((campaign) => {
        const conversion =
          campaign.members > 0 ? Math.round((campaign.converted / campaign.members) * 1000) / 10 : 0;
        const optOutRate =
          campaign.members > 0 ? Math.round((campaign.opted_out / campaign.members) * 1000) / 10 : 0;

        const cells: Array<{ label: string; value: number }> = [
          { label: 'In the book', value: campaign.members },
          { label: 'Still queued', value: campaign.queued },
          { label: 'Callbacks', value: campaign.callback },
          { label: 'Interested', value: campaign.interested },
          { label: 'Booked calls', value: campaign.converted },
          { label: 'Opted out', value: campaign.opted_out },
          { label: 'Exhausted', value: campaign.exhausted },
          { label: 'Total attempts', value: campaign.total_attempts ?? 0 },
        ];

        return (
          <section
            key={campaign.campaign_id}
            className="rounded-2xl border border-line bg-white p-6 sm:p-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-ink">{campaign.name}</h2>
              <StatusPill status={campaign.campaign_status} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {cells.map((cell) => (
                <div key={cell.label} className="rounded-xl border border-line bg-parchment px-4 py-3">
                  <p className="text-2xl font-semibold text-ink tabular-nums">{cell.value}</p>
                  <p className="text-xs text-ink-muted">{cell.label}</p>
                </div>
              ))}
            </div>

            <p className="mt-4 text-sm text-ink-soft">
              Conversion to a booked call: <strong>{conversion}%</strong> · opt-out rate:{' '}
              <strong>{optOutRate}%</strong>
            </p>
          </section>
        );
      })}
    </div>
  );
}
