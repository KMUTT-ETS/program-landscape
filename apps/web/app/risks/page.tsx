import { redirect } from 'next/navigation';
import type { ApiMeta, SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchEnvelope, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { RisksPortfolioClient } from './portfolio-client';
import { SelfCompetitionPanel } from './self-competition-panel';
import type { PortfolioResponse, SelfCompetitionRow } from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Risk Management' };

export default async function RisksPage({
  searchParams,
}: {
  searchParams: Promise<{ erm?: string; faculty?: string; l?: string; i?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  // Always fetch all rows — filtering happens client-side now so the
  // ERM-level filter (`?erm=HIGH`) and the cell filter (`?l=4&i=3`) can
  // both narrow the same dataset without round-tripping. Faculty stays
  // server-side because it's a DB-level filter (cheaper than fetching
  // all 297 program rows when only 1 faculty is needed).
  const qs = new URLSearchParams({ level: 'BACHELOR' });
  if (sp.faculty) qs.set('facultyId', sp.faculty);

  // Self-competition (program-overlap spec §10.2): pairs breaching the two
  // overlap KRIs, same level + faculty filter as the portfolio. Fetched as an
  // envelope so the panel's provenance drawer shows the endpoint's sources.
  const [portfolioRes, selfCompetition] = await Promise.all([
    apiFetchSafe<PortfolioResponse>(`/risks/portfolio?${qs}`),
    apiFetchEnvelope<SelfCompetitionRow[]>(`/risks/self-competition?${qs}`).catch(() => null),
  ]);
  const selfCompetitionRows: SelfCompetitionRow[] | null = selfCompetition?.data ?? null;
  const selfCompetitionMeta: ApiMeta | null = selfCompetition?.meta ?? null;
  const portfolio = portfolioRes.ok ? portfolioRes.data : null;
  const portfolioError = portfolioRes.ok ? null : portfolioRes.error;

  // Parse L × I cell filter — bounded to 1..5; ignores invalid values.
  const lParsed = sp.l ? Number.parseInt(sp.l, 10) : null;
  const iParsed = sp.i ? Number.parseInt(sp.i, 10) : null;
  const cellL = lParsed != null && lParsed >= 1 && lParsed <= 5 ? lParsed : null;
  const cellI = iParsed != null && iParsed >= 1 && iParsed <= 5 ? iParsed : null;

  // Validate ERM filter against the enum.
  const validErm: Array<'NEEDS_DATA' | 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH'> = [
    'NEEDS_DATA',
    'LOW',
    'MODERATE',
    'HIGH',
    'VERY_HIGH',
  ];
  const ermFilter = sp.erm && (validErm as string[]).includes(sp.erm)
    ? (sp.erm as 'NEEDS_DATA' | 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH')
    : null;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Risk Management"
        subtitle="Likelihood × impact scoring of every undergraduate program. Driven by recruitment data, AI-disruption exposure, and the demographic ceiling. Recommendations are program-specific, not categories."
      />
      {portfolio ? (
        portfolio.rows.length === 0 ? (
          <DiagnosticEmptyState
            surface="risk portfolio"
            error={null}
            emptyMessage="No program-level risk assessments have been computed yet. Run pnpm risks:assess --all to populate the portfolio."
          />
        ) : (
          <RisksPortfolioClient
            portfolio={portfolio}
            initialFilters={{
              erm: ermFilter,
              faculty: sp.faculty ?? '',
              cellL,
              cellI,
            }}
          />
        )
      ) : (
        <DiagnosticEmptyState surface="risk portfolio" error={portfolioError} />
      )}
      <div className="mt-[24px]">
        <SelfCompetitionPanel rows={selfCompetitionRows} meta={selfCompetitionMeta} />
      </div>
    </AuthedAppShell>
  );
}
