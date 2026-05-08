import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { RiskMatrixClient } from './client';
import { RisksBackNav } from '../viz';
import type { PortfolioResponse } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Risk Matrix' };

export default async function RiskMatrixPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const portfolio = await apiFetch<PortfolioResponse>('/risks/portfolio?level=BACHELOR').catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <RisksBackNav current="Likelihood × Impact matrix" />
      <PageHeader
        title="Likelihood × Impact matrix"
        subtitle="Two views of the same dataset: BCG-style bubble plot for analytic clarity (X = composite likelihood, Y = log-impact, bubble size = THB at risk) and the institutional ERM 5×5 heatmap."
      />
      {portfolio ? (
        <RiskMatrixClient
          rows={portfolio.rows}
          methodology={portfolio.methodologyVersion}
          kkuMatrixCells={portfolio.summary.kkuMatrixCells}
          kkuLevelCounts={portfolio.summary.byKkuLevel}
        />
      ) : (
        <div className="rounded-md border border-border-default bg-surface-1 p-8 text-center text-text-secondary">
          Unable to load risk data.
        </div>
      )}
    </AuthedAppShell>
  );
}
