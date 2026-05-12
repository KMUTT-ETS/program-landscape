import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Card, PageHeader, Section } from '@kku/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Data quality — Admin' };

interface DataQuality {
  generatedAt: string;
  completeness: Array<{
    metric: string;
    present: number;
    total: number;
    pct: number;
  }>;
  ingestion: {
    extractionsTotal: number;
    extractionFailures: number;
    failurePct: number;
  };
  anomalies: Array<{
    program_id: string;
    metric: string;
    current_year: number;
    current_value: number;
    prior_value: number;
    pct_change: number | null;
    severity: 'critical' | 'high' | 'moderate';
  }>;
}

function severityTone(s: 'critical' | 'high' | 'moderate'): 'danger' | 'warning' | 'neutral' {
  if (s === 'critical') return 'danger';
  if (s === 'high') return 'warning';
  return 'neutral';
}

function toneForPct(pct: number): 'success' | 'warning' | 'danger' {
  if (pct >= 80) return 'success';
  if (pct >= 50) return 'warning';
  return 'danger';
}

export default async function DataQualityPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.role)) redirect('/no-access');

  const dqRes = await apiFetchSafe<DataQuality>('/admin/data-quality');
  const dq = dqRes.ok ? dqRes.data : null;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · Data quality"
        title="Data quality dashboard"
        subtitle="Completeness, ingestion-failure rate, and anomaly detection across the program metrics. Flags are advisory — investigate before acting on affected programs."
      />
      {!dq ? (
        <DiagnosticEmptyState surface="data quality report" error={dqRes.ok ? null : dqRes.error} />
      ) : (
        <div className="flex flex-col gap-6">
          <Section title="Completeness (last 3 years / cohorts)">
            <Card padding="none">
              <table className="w-full text-sm">
                <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="px-4 py-2 text-left">Metric</th>
                    <th className="px-4 py-2 text-right">Coverage</th>
                    <th className="px-4 py-2 text-right">Programs with data</th>
                    <th className="px-4 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {dq.completeness.map((row) => (
                    <tr key={row.metric}>
                      <td className="px-4 py-2 font-medium">{row.metric}</td>
                      <td className="px-4 py-2 text-right font-tabular">
                        {row.pct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2 text-right font-tabular text-text-secondary">
                        {row.present} / {row.total}
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={toneForPct(row.pct)}>
                          {toneForPct(row.pct) === 'success'
                            ? 'good'
                            : toneForPct(row.pct) === 'warning'
                              ? 'gaps'
                              : 'poor'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </Section>

          <Section title="Ingestion quality">
            <Card>
              <div className="flex items-center justify-between text-sm">
                <span>PDF extractions rejected during review</span>
                <span className="font-tabular">
                  <span className="text-text-primary">
                    {dq.ingestion.extractionFailures}
                  </span>
                  <span className="text-text-tertiary">
                    {' '}
                    / {dq.ingestion.extractionsTotal} ({dq.ingestion.failurePct.toFixed(1)}%)
                  </span>
                </span>
              </div>
            </Card>
          </Section>

          <Section title="Drift detection (enrollment · graduated · revenue · employment)">
            <Card padding="none">
              {dq.anomalies.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-text-secondary">
                  No drift flagged across any metric series.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
                    <tr>
                      <th className="px-4 py-2 text-left">Program</th>
                      <th className="px-4 py-2 text-left">Metric</th>
                      <th className="px-4 py-2 text-left">Severity</th>
                      <th className="px-4 py-2 text-right">Year</th>
                      <th className="px-4 py-2 text-right">Prior</th>
                      <th className="px-4 py-2 text-right">Current</th>
                      <th className="px-4 py-2 text-right">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {dq.anomalies.map((a, idx) => (
                      <tr key={`${a.program_id}-${a.metric}-${a.current_year}-${idx}`}>
                        <td className="px-4 py-2">
                          <a
                            href={`/programs/${a.program_id}`}
                            className="font-tabular font-medium text-accent hover:underline"
                          >
                            {a.program_id.slice(0, 10)}…
                          </a>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{a.metric}</td>
                        <td className="px-4 py-2">
                          <Badge tone={severityTone(a.severity)}>{a.severity}</Badge>
                        </td>
                        <td className="px-4 py-2 text-right font-tabular">
                          {a.current_year}
                        </td>
                        <td className="px-4 py-2 text-right font-tabular text-text-secondary">
                          {typeof a.prior_value === 'number' ? a.prior_value.toFixed(2) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-tabular">
                          {typeof a.current_value === 'number' ? a.current_value.toFixed(2) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-tabular">
                          {a.pct_change === null ? (
                            <span className="text-text-tertiary">—</span>
                          ) : (
                            <span
                              className={a.pct_change >= 0 ? 'text-success' : 'text-danger'}
                            >
                              {a.pct_change >= 0 ? '+' : ''}
                              {a.pct_change.toFixed(1)}
                              {a.metric.startsWith('outcome.') ? ' pts' : '%'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </Section>

          <div className="text-right text-xs text-text-tertiary">
            Generated {new Date(dq.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </AuthedAppShell>
  );
}
