import type { ScoreBand } from '@/lib/scoring';

const BAND_COLOUR: Record<ScoreBand, string> = {
  on_track: 'var(--color-positive)',
  solid: 'var(--color-positive)',
  needs_attention: 'var(--color-caution)',
  urgent: 'var(--color-alert)',
};

/** Semicircle: centre (100,100), radius 80, sweeping left to right. */
const RADIUS = 80;
const ARC_PATH = 'M 20 100 A 80 80 0 0 1 180 100';
const ARC_LENGTH = Math.PI * RADIUS;

export interface ScoreGaugeProps {
  score: number;
  band: ScoreBand;
  bandLabel: string;
  /** Renders without the CSS transition, for the printed report. */
  static?: boolean;
}

export function ScoreGauge({ score, band, bandLabel, static: isStatic }: ScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const offset = ARC_LENGTH * (1 - clamped / 100);
  const colour = BAND_COLOUR[band];

  return (
    <figure className="print-block m-0 flex flex-col items-center">
      <svg
        viewBox="0 0 200 128"
        className="w-full max-w-xs"
        role="img"
        aria-label={`Retirement Health Score: ${clamped} out of 100. ${bandLabel}.`}
      >
        <path
          d={ARC_PATH}
          fill="none"
          stroke="var(--color-parchment-deep)"
          strokeWidth={16}
          strokeLinecap="round"
        />
        <path
          d={ARC_PATH}
          fill="none"
          stroke={colour}
          strokeWidth={16}
          strokeLinecap="round"
          strokeDasharray={ARC_LENGTH}
          strokeDashoffset={offset}
          style={isStatic ? undefined : { transition: 'stroke-dashoffset 900ms ease-out' }}
        />

        <text
          x="100"
          y="92"
          textAnchor="middle"
          className="font-serif"
          style={{ fontSize: '44px', fontWeight: 600, fill: 'var(--color-ink)' }}
        >
          {clamped}
        </text>
        <text
          x="100"
          y="114"
          textAnchor="middle"
          style={{ fontSize: '11px', fill: 'var(--color-ink-muted)', letterSpacing: '0.08em' }}
        >
          OUT OF 100
        </text>
      </svg>

      <figcaption
        className="mt-1 rounded-full px-4 py-1 text-sm font-semibold"
        style={{ color: colour, backgroundColor: 'var(--color-parchment-deep)' }}
      >
        {bandLabel}
      </figcaption>
    </figure>
  );
}

export interface BreakdownBarsProps {
  breakdown: Array<{ dimension: string; label: string; points: number; max: number; ratio: number }>;
}

export function BreakdownBars({ breakdown }: BreakdownBarsProps) {
  return (
    <ul className="print-block m-0 list-none space-y-4 p-0">
      {breakdown.map((d) => {
        const pct = Math.round(d.ratio * 100);
        const colour =
          d.ratio >= 0.7
            ? 'var(--color-positive)'
            : d.ratio >= 0.4
              ? 'var(--color-caution)'
              : 'var(--color-alert)';
        return (
          <li key={d.dimension}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-ink">{d.label}</span>
              <span className="shrink-0 tabular-nums text-ink-muted">
                {d.points}/{d.max}
              </span>
            </div>
            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-parchment-deep"
              role="meter"
              aria-valuenow={d.points}
              aria-valuemin={0}
              aria-valuemax={d.max}
              aria-label={d.label}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, backgroundColor: colour }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
