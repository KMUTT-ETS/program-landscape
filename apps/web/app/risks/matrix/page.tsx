import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
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

  const portfolioRes = await apiFetchSafe<PortfolioResponse>('/risks/portfolio?level=BACHELOR');

  return (
    <AuthedAppShell user={user}>
      <RisksBackNav current="Likelihood × Impact matrix" />
      <PageHeader
        title="Likelihood × Impact matrix"
        subtitle="Two views of the same dataset: BCG-style bubble plot for analytic clarity (X = composite likelihood, Y = log-impact, bubble size = THB at risk) and the institutional ERM 5×5 heatmap."
      />
      {portfolioRes.ok ? (
        portfolioRes.data.rows.length === 0 ? (
          <DiagnosticEmptyState
            surface="risk matrix"
            error={null}
            emptyMessage="No program-level risk assessments have been computed yet."
          />
        ) : (
          <RiskMatrixClient
            rows={portfolioRes.data.rows}
            methodology={portfolioRes.data.methodologyVersion}
            kkuMatrixCells={portfolioRes.data.summary.kkuMatrixCells}
            kkuLevelCounts={portfolioRes.data.summary.byKkuLevel}
          />
        )
      ) : (
        <DiagnosticEmptyState surface="risk matrix" error={portfolioRes.error} />
      )}
    </AuthedAppShell>
  );
}
