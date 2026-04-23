import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { GapAnalysisClient } from './client';
import type {
  OccupationGapResponse,
  RegionalGapResponse,
  SectorGapResponse,
  SkillGapResponse,
} from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Demand-Supply Gap Analyzer — KKU' };

export default async function GapAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{
    dimension?: string;
    region?: string;
    horizon?: string;
    comparison?: string;
    scope?: string;
    scopeId?: string;
  }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const dimension = (sp.dimension ?? 'skills') as 'skills' | 'occupations' | 'sectors';
  const region = sp.region ?? 'TH';
  const horizon = sp.horizon ?? '0';
  const comparison = sp.comparison ?? 'absolute';
  const scope = sp.scope ?? 'university';
  const scopeId = sp.scopeId ?? '';

  const qs = new URLSearchParams({
    scope,
    region,
    horizon,
    comparison,
    limit: '30',
  });
  if (scopeId) qs.set('scopeId', scopeId);

  // Fan-out: one request per panel. Above-the-fold paints first even if
  // one source is slow.
  const [skills, sectors, occupations, regional] = await Promise.all([
    apiFetch<SkillGapResponse>(`/gap/skills?${qs}`).catch(() => null),
    apiFetch<SectorGapResponse>(`/gap/sectors?${qs}`).catch(() => null),
    apiFetch<OccupationGapResponse>(`/gap/occupations?${qs}`).catch(() => null),
    apiFetch<RegionalGapResponse>(`/gap/regional/${encodeURIComponent(region)}?${qs}`).catch(
      () => null,
    ),
  ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Demand-Supply Gap Analyzer"
        subtitle="Labor market demand vs KKU graduate supply — by skill, occupation, sector, and region."
      />
      <GapAnalysisClient
        initialFilters={{ dimension, region, horizon, comparison, scope, scopeId }}
        data={{ skills, sectors, occupations, regional }}
      />
    </AuthedAppShell>
  );
}
