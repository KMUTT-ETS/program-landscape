import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { GapAnalysisClient } from './client';
import type { GapAnalysisResponse } from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gap Analyzer' };

export default async function GapAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; scopeId?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const qs = new URLSearchParams({ scope: sp.scope ?? 'university' });
  if (sp.scopeId) qs.set('scopeId', sp.scopeId);

  const res = await apiFetchSafe<GapAnalysisResponse>(`/gap/analysis?${qs}`);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Gap Analyzer"
        subtitle="Seven gap lenses across the portfolio — skill/market, content, AI readiness, recruitment, staff capability, demographic ceiling, and systemic white-spaces — rolled up into a Composite Gap Index."
      />
      {res.ok ? (
        <GapAnalysisClient data={res.data} />
      ) : (
        <DiagnosticEmptyState surface="gap analysis" error={res.error} />
      )}
    </AuthedAppShell>
  );
}
