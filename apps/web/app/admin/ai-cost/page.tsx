import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Card, PageHeader, Section } from '@kku/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI cost — Admin' };

interface AiCost {
  windowDays: number;
  generatedAt: string;
  total: {
    calls: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    avgLatencyMs: number | null;
    avgConfidence: number | null;
  };
  byModule: Array<{ module: string; calls: number; costUsd: number }>;
  byDay: Array<{ day: string; module: string; costUsd: number; calls: number }>;
  byUser: Array<{
    userId: string;
    email: string;
    name: string | null;
    role: string;
    costUsd: number;
    calls: number;
  }>;
}

export default async function AiCostPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (user.role !== 'ADMIN') redirect('/');

  const params = await searchParams;
  const days = params.days ?? '30';
  const data = await apiFetch<AiCost>(`/admin/ai-cost?days=${days}`).catch(
    () => null,
  );

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · AI cost"
        title="AI cost rollup"
        subtitle={`Per-module and per-user AI spend over the last ${days} days. Derived from AiInference rows; every call includes token counts and the provider's per-1k-token rate.`}
        actions={
          <div className="flex items-center gap-2">
            {(['7', '30', '90'] as const).map((d) => (
              <a
                key={d}
                href={`/admin/ai-cost?days=${d}`}
                className={`rounded-md border border-border-default px-3 py-1 text-xs ${
                  d === days
                    ? 'bg-surface-3 text-text-primary'
                    : 'text-text-secondary hover:bg-surface-1'
                }`}
              >
                {d} days
              </a>
            ))}
          </div>
        }
      />
      {!data ? (
        <Card>
          <div className="py-6 text-center text-text-secondary">
            AI cost report unavailable.
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <Stat label="Calls" value={data.total.calls.toString()} />
              <Stat
                label="Cost"
                value={`$${data.total.costUsd.toFixed(4)}`}
              />
              <Stat
                label="Input tokens"
                value={data.total.inputTokens.toLocaleString()}
              />
              <Stat
                label="Output tokens"
                value={data.total.outputTokens.toLocaleString()}
              />
              <Stat
                label="Avg confidence"
                value={
                  data.total.avgConfidence != null
                    ? `${Math.round(data.total.avgConfidence * 100)}%`
                    : '—'
                }
              />
            </div>
          </Card>

          <Section title="By module">
            <Card padding="none">
              <table className="w-full text-sm">
                <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="px-4 py-2 text-left">Module</th>
                    <th className="px-4 py-2 text-right">Calls</th>
                    <th className="px-4 py-2 text-right">Cost</th>
                    <th className="px-4 py-2 text-right">% of total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {data.byModule.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-text-tertiary">
                        No AI calls in window.
                      </td>
                    </tr>
                  ) : (
                    data.byModule.map((row) => (
                      <tr key={row.module}>
                        <td className="px-4 py-2 font-medium">{row.module}</td>
                        <td className="px-4 py-2 text-right font-tabular">
                          {row.calls}
                        </td>
                        <td className="px-4 py-2 text-right font-tabular">
                          ${row.costUsd.toFixed(4)}
                        </td>
                        <td className="px-4 py-2 text-right font-tabular text-text-secondary">
                          {data.total.costUsd
                            ? ((row.costUsd / data.total.costUsd) * 100).toFixed(1)
                            : '0.0'}
                          %
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </Section>

          <Section title="Top 20 users by spend">
            <Card padding="none">
              <table className="w-full text-sm">
                <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="px-4 py-2 text-left">User</th>
                    <th className="px-4 py-2 text-left">Role</th>
                    <th className="px-4 py-2 text-right">Calls</th>
                    <th className="px-4 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {data.byUser.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-text-tertiary">
                        No user-attributed AI calls in window.
                      </td>
                    </tr>
                  ) : (
                    data.byUser.map((row) => (
                      <tr key={row.userId}>
                        <td className="px-4 py-2">
                          <div className="flex flex-col">
                            <span className="font-medium">{row.name ?? row.email}</span>
                            <span className="text-xs text-text-tertiary">
                              {row.email}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <Badge tone="neutral">{row.role}</Badge>
                        </td>
                        <td className="px-4 py-2 text-right font-tabular">
                          {row.calls}
                        </td>
                        <td className="px-4 py-2 text-right font-tabular">
                          ${row.costUsd.toFixed(4)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </Section>

          <div className="text-right text-xs text-text-tertiary">
            Window: last {data.windowDays} days · generated{' '}
            {new Date(data.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </AuthedAppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      <span className="font-tabular text-lg font-medium">{value}</span>
    </div>
  );
}
