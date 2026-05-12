import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { GapAnalysisClient } from './client';
import type {
  OpportunityResponse,
  ProgramDemandGapResponse,
  SkillGapResponse,
} from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Demand-Supply Gap Analyzer' };

export default async function GapAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; scopeId?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const scope = sp.scope ?? 'university';
  const scopeId = sp.scopeId ?? '';

  const qs = new URLSearchParams({ scope, limit: '20' });
  if (scopeId) qs.set('scopeId', scopeId);

  // Three real-data fetches. skillGap is the canary — a failure on it
  // means the user can't see anything useful, so we surface the
  // diagnostic instead. opportunities + programGaps stay best-effort.
  const skillGapRes = await apiFetchSafe<SkillGapResponse>(`/gap/skills?${qs}`);
  const skillGap = skillGapRes.ok ? skillGapRes.data : null;
  const skillGapError = skillGapRes.ok ? null : skillGapRes.error;
  const [opportunities, programGaps] = await Promise.all([
    apiFetch<OpportunityResponse>(`/gap/opportunities?${qs}`).catch(() => null),
    apiFetch<ProgramDemandGapResponse>(`/gap/program-demand-gaps?${qs}`).catch(() => null),
  ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Demand-Supply Gap Analyzer"
        subtitle="Where labour-market demand and KKU graduate supply diverge — LinkedIn-derived skill demand (subscribed by MHESI) × KKU alumni cohort outcomes."
      />
      {skillGapError ? (
        <DiagnosticEmptyState surface="gap analysis" error={skillGapError} />
      ) : (
        <GapAnalysisClient
          initialFilters={{ scope, scopeId }}
          data={{ skillGap, opportunities, programGaps }}
        />
      )}
    </AuthedAppShell>
  );
}
