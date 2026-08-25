import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { Badge, Card, PageHeader } from '@kku/ui';
import Link from 'next/link';
import type { OpportunityRowDto } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gap Opportunities' };

interface OpportunityResponse {
  filter: Record<string, unknown>;
  rows: OpportunityRowDto[];
  asOf: string;
}

export default async function OpportunitiesPage({
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
    region: sp.region ?? 'TH',
    limit: '50',
  });
  if (sp.scopeId) qs.set('scopeId', sp.scopeId);

  const dataRes = await apiFetchSafe<OpportunityResponse>(`/gap/opportunities?${qs}`);
  const data = dataRes.ok ? dataRes.data : null;
  const dataError = dataRes.ok ? null : dataRes.error;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Gap Opportunities"
        subtitle="Skills with strong market demand but few or no KKU programs covering them."
      />
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 text-xs text-text-tertiary">
          <Link href="/gap-analysis" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            ← Back to Gap Analyzer
          </Link>
          <Link href="/gap-analysis/risks" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            Risks →
          </Link>
          <Link
            href="/gap-analysis/digital-competency"
            className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2"
          >
            Digital competency →
          </Link>
        </div>

        <Card padding="md">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary">
              Underserved skills — {data?.rows.length ?? 0}
            </h3>
            <span className="text-xs text-text-tertiary">
              positive gap + demand &gt; 5 + little-to-no KKU supply
            </span>
          </div>

          {!data ? (
            <DiagnosticEmptyState surface="gap opportunities" error={dataError} />
          ) : data.rows.length === 0 ? (
            <EmptyMessage />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary">
                    <th className="py-2 pr-3">Skill</th>
                    <th className="py-2 pr-3 text-right">Recent demand</th>
                    <th className="py-2 pr-3 text-right">Cohort est.</th>
                    <th className="py-2 pr-3 text-right">KKU programs</th>
                    <th className="py-2 pr-3 text-right">Peer coverage</th>
                    <th className="py-2 pr-3">Fit note</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.skillId} className="border-b border-subtle last:border-0">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-text-primary">{r.nameEn}</div>
                        <div className="text-xs text-text-tertiary">{r.nameTh}</div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-xs">{r.recentDemand.toFixed(0)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs">{r.estimatedCohortSize}</td>
                      <td className="py-2 pr-3 text-right">
                        {r.existingProgramCount === 0 ? (
                          <Badge tone="outline">None</Badge>
                        ) : (
                          <span className="font-mono text-xs">{r.existingProgramCount}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {r.peerProgramCount === 0 ? (
                          <span className="text-xs text-text-tertiary">prompt 10</span>
                        ) : (
                          <span className="font-mono text-xs">{r.peerProgramCount}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-text-secondary">{r.fitNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <p className="text-xs text-text-tertiary">
          Per-skill AI proposals (new course / new track / new program) live under{' '}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">POST /gap/insights/generate</code>{' '}
          with mode <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">strategic-top-5</code>. Peer-coverage column lights up when prompt 10 wires real peer programs.
        </p>
      </div>
    </AuthedAppShell>
  );
}

function EmptyMessage() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <div className="text-sm font-semibold text-text-primary">No opportunity rows yet</div>
      <p className="max-w-md text-xs text-text-tertiary">
        Demand-side signal is sparse until prompt 14 wires real JobThai / JobsDB / GoldenPath connectors. Seeded sample data should still surface a handful of skills with positive gaps.
      </p>
    </div>
  );
}
