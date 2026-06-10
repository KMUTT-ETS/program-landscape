// Curriculum modernity verdict — the OLD_SCHOOL → FRONTIER spectrum of KKU's
// AI-reviewed curricula, as a modern donut (85% of the panel width) with the
// legend + data labels BELOW it in a SINGLE column. Shared between
// /benchmarking (full) and the executive landscape dashboard (compact).
//
// Readability (see [[feedback-text-readability-adjacency]]): the legend is one
// column — never a 2-col grid, where col-1's "0%" touches col-2's label. In a
// row, the label and the stat are pushed to opposite ends (ml-auto), and the
// stat itself uses an explicit "·" + unit word ("59% · 174 programs"). Never
// rely on a flex gap alone between two numbers.

type Verdict = 'OLD_SCHOOL' | 'IN_BETWEEN' | 'FRONTIER' | 'UNKNOWN';

export interface ModernityCounts {
  OLD_SCHOOL: number;
  IN_BETWEEN: number;
  FRONTIER: number;
  UNKNOWN: number;
}

const MODERNITY: Array<{ key: Verdict; label: string; desc: string; ink: string }> = [
  { key: 'FRONTIER', label: 'Frontier', desc: 'Built around what the next decade demands', ink: 'text-success' },
  { key: 'IN_BETWEEN', label: 'In between', desc: 'Solid fundamentals + selective frontier patches', ink: 'text-info' },
  { key: 'OLD_SCHOOL', label: 'Old school', desc: 'Pre-2020 fundamentals; missing the frontier', ink: 'text-warning' },
  { key: 'UNKNOWN', label: 'Not yet judged', desc: 'No AI review on file yet', ink: 'text-text-tertiary' },
];

function takeaway(counts: ModernityCounts): string {
  const judged = counts.OLD_SCHOOL + counts.IN_BETWEEN + counts.FRONTIER;
  if (judged === 0) return 'No curricula have been AI-reviewed for modernity yet.';
  const frontierPct = Math.round((counts.FRONTIER / judged) * 100);
  const oldPct = Math.round((counts.OLD_SCHOOL / judged) * 100);
  if (counts.OLD_SCHOOL >= counts.IN_BETWEEN && counts.OLD_SCHOOL >= counts.FRONTIER) {
    return `${oldPct}% of reviewed curricula are still old-school — modernizing content is the portfolio's biggest opportunity.`;
  }
  if (counts.FRONTIER >= counts.IN_BETWEEN) {
    return `${frontierPct}% of reviewed curricula already sit at the frontier — a strong base to build on.`;
  }
  return `Most curricula blend solid fundamentals with selective frontier content; only ${frontierPct}% are fully at the frontier.`;
}

// Responsive donut — fills its container (set to 85% of the panel width by the
// caller), fixed viewBox so it scales cleanly, center label stays centered.
function Donut({ counts }: { counts: ModernityCounts }) {
  const V = 200;
  const stroke = 28;
  const r = (V - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = V / 2;
  const judged = counts.OLD_SCHOOL + counts.IN_BETWEEN + counts.FRONTIER + counts.UNKNOWN;
  let offset = 0;
  return (
    <div className="relative aspect-square w-full">
      <svg viewBox={`0 0 ${V} ${V}`} className="block h-full w-full" role="img" aria-label="Curriculum modernity distribution">
        <g transform={`rotate(-90 ${cx} ${cx})`}>
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="currentColor" className="text-surface-2" strokeWidth={stroke} />
          {judged > 0 &&
            MODERNITY.map((m) => {
              const n = counts[m.key];
              if (n === 0) return null;
              const len = (n / judged) * c;
              const seg = (
                <circle
                  key={m.key}
                  cx={cx}
                  cy={cx}
                  r={r}
                  fill="none"
                  stroke="currentColor"
                  className={m.ink}
                  strokeWidth={stroke}
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return seg;
            })}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-tabular text-4xl font-bold text-text-primary">{judged}</span>
        <span className="mt-1.5 text-[11px] uppercase tracking-wide text-text-tertiary">reviewed</span>
      </div>
    </div>
  );
}

export function CurriculumModernity({
  counts,
  variant = 'full',
}: {
  counts: ModernityCounts;
  variant?: 'full' | 'compact';
}) {
  const judged = counts.OLD_SCHOOL + counts.IN_BETWEEN + counts.FRONTIER + counts.UNKNOWN;
  const pct = (n: number) => (judged > 0 ? Math.round((n / judged) * 100) : 0);
  const compact = variant === 'compact';

  return (
    <div className="flex flex-col gap-4">
      {/* Donut — 85% of the panel width, centered. */}
      <div className="flex justify-center pt-1">
        <div className="w-[85%] max-w-[300px]">
          <Donut counts={counts} />
        </div>
      </div>

      {/* Legend — single column, full width. Label on the left, stat pushed to
          the right (ml-auto). The stat uses explicit "·" + a unit word so the
          percent and count never read as one token. */}
      <ul className="flex flex-col divide-y divide-border-subtle/70">
        {MODERNITY.map((m) => {
          const n = counts[m.key];
          return (
            <li key={m.key} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
              <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-current ${m.ink}`} aria-hidden />
              <div className="min-w-0">
                <span className={`text-sm font-semibold ${m.ink}`}>{m.label}</span>
                {!compact && <div className="text-[11px] leading-snug text-text-tertiary">{m.desc}</div>}
              </div>
              <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-text-tertiary">
                <span className="font-tabular text-base font-bold text-text-primary">{pct(n)}%</span>
                <span className="px-1.5 text-text-tertiary">·</span>
                {n} {n === 1 ? 'program' : 'programs'}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="rounded-md bg-surface-2/60 px-3 py-2 text-xs leading-relaxed text-text-secondary">
        {takeaway(counts)}
      </p>
    </div>
  );
}
