import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { Badge, Card, PageHeader } from '@kku/ui';
import Link from 'next/link';
import type { RiskRowDto } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gap Risks' };

interface RiskResponse {
  filter: Record<string, unknown>;
  rows: RiskRowDto[];
  asOf: string;
  lowConfidenceReason: string | null;
}

const HINT_LABELS: Record<
  RiskRowDto['recommendationHint'],
  { label: string; tone: 'outline' | 'neutral' | 'warning' | 'danger' }
> = {
  'reduce-intake': { label: 'Reduce intake', tone: 'danger' },
  repurpose: { label: 'Repurpose', tone: 'danger' },
  rebalance: { label: 'Rebalance', tone: 'warning' },
  watch: { label: 'Watch', tone: 'outline' },
};

export default async function RisksPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; scopeId?: string; region?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const qs = new URLSearchParams({
    scope: sp.scope ?? 'university',
    region: sp.region ?? 'Northeast',
    limit: '50',
  });
  if (sp.scopeId) qs.set('scopeId', sp.scopeId);

  const dataRes = await apiFetchSafe<RiskResponse>(`/gap/risks?${qs}`);
  const data = dataRes.ok ? dataRes.data : null;
  const dataError = dataRes.ok ? null : dataRes.error;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Gap Risks"
        subtitle="Programs whose projected supply exceeds regional demand, adjusted for Thailand's shrinking youth cohort."
      />
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 text-xs text-text-tertiary">
          <Link href="/gap-analysis" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            ← Back to Gap Analyzer
          </Link>
          <Link href="/gap-analysis/opportunities" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            Opportunities →
          </Link>
          <Link
            href="/gap-analysis/digital-competency"
            className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2"
          >
            Digital competency →
          </Link>
        </div>

        <Card padding="md">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary">
              Oversupply risks — {data?.rows.length ?? 0}
            </h3>
            <span className="text-xs text-text-tertiary">
              5-year projection · demographic-adjusted
            </span>
          </div>
          {data?.lowConfidenceReason && (
            <div className="mb-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
              {data.lowConfidenceReason}
            </div>
          )}
          {!data ? (
            <DiagnosticEmptyState surface="gap risks" error={dataError} />
          ) : data.rows.length === 0 ? (
            <EmptyMessage />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary">
                    <th className="py-2 pr-3">Program</th>
                    <th className="py-2 pr-3 text-right">Graduating now</th>
                    <th className="py-2 pr-3 text-right">Proj. 5yr (linear)</th>
                    <th className="py-2 pr-3 text-right">After demographic</th>
                    <th className="py-2 pr-3 text-right">Regional demand</th>
                    <th className="py-2 pr-3 text-right">Oversupply</th>
                    <th className="py-2 pr-3">Hint</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const hint = HINT_LABELS[r.recommendationHint];
                    return (
                      <tr key={r.programId} className="border-b border-subtle last:border-0">
                        <td className="py-2 pr-3">
                          <Link href={`/programs/${r.programId}`} className="font-medium text-text-primary hover:underline">
                            {r.nameEn}
                          </Link>
                          <div className="text-xs text-text-tertiary">
                            <span className="font-mono">{r.programCode}</span> · {r.nameTh}
                            {r.curriculumYearBE != null && (
                              <span title="Curriculum revision year"> · Rev. BE {r.curriculumYearBE}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-xs">{r.currentGraduates}</td>
                        <td className="py-2 pr-3 text-right font-mono text-xs">{r.projectedSupply5yr.toFixed(0)}</td>
                        <td className="py-2 pr-3 text-right font-mono text-xs">{r.projectedSupplyAfterDemographic.toFixed(0)}</td>
                        <td className="py-2 pr-3 text-right font-mono text-xs">{r.estimatedRegionalDemand}</td>
                        <td className="py-2 pr-3 text-right font-mono text-xs">
                          <span className={r.oversupplyPct > 50 ? 'text-danger' : r.oversupplyPct > 20 ? 'text-warning' : 'text-text-secondary'}>
                            {r.oversupplyPct.toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={hint.tone}>{hint.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <p className="text-xs text-text-tertiary">
          Forecasts use{' '}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">forecasting.v1</code>{' '}
          (linear + demographic). Regional demand is a v1 proxy; per-program demand-supply matching via KKU-Alumni crosswalk lands with prompt 14.
        </p>
      </div>
    </AuthedAppShell>
  );
}

function EmptyMessage() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <div className="text-sm font-semibold text-text-primary">No risk rows yet</div>
      <p className="max-w-md text-xs text-text-tertiary">
        Enrollment history needs ≥ 2 years per program for a linear projection. Seed data currently has 3 years across seeded programs; real data per program lands with prompt 14.
      </p>
    </div>
  );
}
