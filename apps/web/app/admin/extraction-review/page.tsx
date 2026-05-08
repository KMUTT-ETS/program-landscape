import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Card, ConfidenceBadge, EmptyState, PageHeader, Section } from '@kku/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Extraction Review — Admin' };

interface AiExtractionRow {
  id: string;
  sourceEntityType: string;
  sourceEntityId: string;
  extractionKind: string;
  confidence: number;
  methodVersion: string;
  reviewStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED';
  reasoning: string | null;
  createdAt: string;
  aiInference: {
    id: string;
    model: string;
    latencyMs: number | null;
    costEstimateUsd: number | null;
  } | null;
}

interface Stats {
  windowDays: number;
  perModule: Array<{
    module: string;
    calls: number;
    tokensInput: number;
    tokensOutput: number;
    costUsd: number;
    avgLatencyMs: number | null;
    avgConfidence: number | null;
  }>;
}

export default async function AdminExtractionReviewPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.role)) redirect('/no-access');

  const [pending, stats] = await Promise.all([
    apiFetch<AiExtractionRow[]>('/ai/extractions?status=PENDING_REVIEW&limit=100').catch(
      () => [] as AiExtractionRow[],
    ),
    apiFetch<Stats>('/ai/inferences/stats').catch(() => null),
  ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="AI extraction review"
        subtitle="LLM outputs that landed below the auto-approve threshold. Each row is one extraction — approve to materialise it into the domain tables."
      />
      {stats && <StatsStrip stats={stats} />}
      <Section title={`Pending review (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState
            title="Queue is empty"
            description="AI jobs haven't produced any low-confidence extractions yet. Set AI_PROVIDER + the provider API key and run a job to see this populate."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pending.map((row) => (
              <Link key={row.id} href={`/admin/extraction-review/${row.id}`} className="block">
                <Card className="h-full transition-shadow hover:shadow-elevation-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{row.extractionKind}</div>
                        <div className="truncate text-xs text-text-tertiary">
                          {row.sourceEntityType} · {row.sourceEntityId.slice(0, 8)}…
                        </div>
                      </div>
                      <ConfidenceBadge value={row.confidence} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                      <Badge tone="neutral">{row.methodVersion}</Badge>
                      {row.aiInference && (
                        <>
                          <span>·</span>
                          <span>{row.aiInference.model}</span>
                          <span>·</span>
                          <span className="font-tabular">
                            {row.aiInference.latencyMs
                              ? `${(row.aiInference.latencyMs / 1000).toFixed(1)}s`
                              : ''}
                          </span>
                          {row.aiInference.costEstimateUsd !== null && (
                            <>
                              <span>·</span>
                              <span className="font-tabular">
                                ${row.aiInference.costEstimateUsd.toFixed(4)}
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </div>
                    {row.reasoning && (
                      <p className="line-clamp-2 text-xs text-text-tertiary">
                        {row.reasoning}
                      </p>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </AuthedAppShell>
  );
}

function StatsStrip({ stats }: { stats: Stats }) {
  const totals = stats.perModule.reduce(
    (acc, m) => ({
      calls: acc.calls + m.calls,
      cost: acc.cost + m.costUsd,
      tokens: acc.tokens + m.tokensInput + m.tokensOutput,
    }),
    { calls: 0, cost: 0, tokens: 0 },
  );
  return (
    <Section title={`AI usage (last ${stats.windowDays} days)`}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Calls</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">{totals.calls}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Tokens</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {(totals.tokens / 1000).toFixed(1)}k
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Cost</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            ${totals.cost.toFixed(2)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Modules</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {stats.perModule.length}
          </div>
        </Card>
      </div>
      {stats.perModule.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-text-secondary">
              <tr>
                <th className="px-3 py-2 text-left">Module</th>
                <th className="px-3 py-2 text-right font-tabular">Calls</th>
                <th className="px-3 py-2 text-right font-tabular">Tokens in</th>
                <th className="px-3 py-2 text-right font-tabular">Tokens out</th>
                <th className="px-3 py-2 text-right font-tabular">Avg latency</th>
                <th className="px-3 py-2 text-right font-tabular">Avg conf</th>
                <th className="px-3 py-2 text-right font-tabular">Cost</th>
              </tr>
            </thead>
            <tbody>
              {stats.perModule.map((m) => (
                <tr key={m.module} className="border-t border-border-subtle">
                  <td className="px-3 py-2 font-medium">{m.module}</td>
                  <td className="px-3 py-2 text-right font-tabular">{m.calls}</td>
                  <td className="px-3 py-2 text-right font-tabular">{m.tokensInput}</td>
                  <td className="px-3 py-2 text-right font-tabular">{m.tokensOutput}</td>
                  <td className="px-3 py-2 text-right font-tabular">
                    {m.avgLatencyMs ? `${m.avgLatencyMs.toFixed(0)} ms` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-tabular">
                    {m.avgConfidence ? m.avgConfidence.toFixed(2) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-tabular">
                    ${m.costUsd.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
