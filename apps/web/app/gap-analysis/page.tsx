import { orgShortNamesForRequest } from '@/lib/branding';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { ApiSuccess, SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchEnvelope, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { GapMapSections } from './sections';
import { resolveGapParams, type GapMapT } from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gap Analyzer' };

export default async function GapAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const org = await orgShortNamesForRequest();

  const sp = await searchParams;
  // Programme scope is the Deep-Dive's job — a single programme is not a
  // portfolio map, and the api refuses that scope outright.
  if (sp.scope === 'program' && sp.scopeId) redirect(`/programs/${sp.scopeId}`);
  const params = resolveGapParams(sp);

  const qs = new URLSearchParams({
    scope: params.scope,
    under: String(params.under),
    over: String(params.over),
    basis: params.basis,
  });
  if (params.scopeId) qs.set('scopeId', params.scopeId);

  // apiFetchEnvelope carries meta (the provenance drawer needs it) and throws
  // on failure; the failure arm re-fetches through apiFetchSafe, whose typed
  // error is what DiagnosticEmptyState renders.
  let page: ReactNode;
  try {
    const env = (await apiFetchEnvelope<GapMapT>(`/gap/map?${qs}`)) as ApiSuccess<GapMapT>;
    page = <GapMapSections data={{ params, map: env.data, meta: env.meta }} orgName={org.en} />;
  } catch {
    const safe = await apiFetchSafe<GapMapT>(`/gap/map?${qs}`);
    page = <DiagnosticEmptyState surface="gap map" error={safe.ok ? null : safe.error} />;
  }

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title={`Gap Analyzer — which parts of the labour market does ${org.en} serve?`}
        subtitle={`One row per field of study that employers ask for. Demand share from JobThai adverts; ${org.en} share from graduates per year; the verdict compares the two. Open a row for the occupations, the programmes and what is coming.`}
      />
      {page}
    </AuthedAppShell>
  );
}
