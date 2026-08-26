import { notFound, redirect } from 'next/navigation';
// DQ_MODULES is plain data, but importing it in the client component would
// pull the `@kku/shared` barrel (and `node:crypto`) into the browser
// bundle — so it is read here, on the server, and passed down.
import { DQ_MODULES, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import {
  AunqaProgramClient,
  type AunqaNarrativeDraft,
  type AunqaProgramAnalysis,
} from './client';

// Teaching & Learning — one programme against the AUN-QA v4 criteria.
//
// The page composes nothing: `GET /aunqa/program/:programId` already
// carries the criteria in registry order, every binding resolved, the
// completeness counts, and the criteria the platform can evidence for
// nobody. Adding a data source stays a registry entry plus a resolver.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Teaching & Learning' };

export default async function TeachingLearningProgramPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const { programId } = await params;

  // The API is the authority on who may see this programme
  // (`assertProgramAccessible`): 404 for an unknown one, 403 for one
  // outside the caller's scopes. Re-deriving that gate here would be a
  // second copy of the rule, free to drift from the one that matters.
  const res = await apiFetchSafe<AunqaProgramAnalysis>(`/aunqa/program/${programId}`);
  if (!res.ok) {
    if (res.error.category === 'notFound') notFound();
    return (
      <AuthedAppShell user={user}>
        <PageHeader title="Teaching & Learning" />
        <DiagnosticEmptyState surface="this programme's AUN-QA analysis" error={res.error} />
      </AuthedAppShell>
    );
  }
  const analysis = res.data;
  const program = analysis.program;

  /**
   * Drafts the self-assessment for ONE criterion, on demand.
   *
   * A server action rather than a browser fetch: the NestJS API is
   * internal, and the session token that authorises the call lives in an
   * httpOnly cookie the browser cannot read. One criterion per call —
   * there is no bulk route to reach for even if the page wanted one.
   */
  async function generateNarrative(
    criterionId: string,
  ): Promise<{ ok: true; draft: AunqaNarrativeDraft } | { ok: false; message: string }> {
    'use server';
    try {
      const draft = await apiFetch<AunqaNarrativeDraft>(
        `/aunqa/program/${programId}/criterion/${criterionId}/narrative`,
        { method: 'POST' },
      );
      return { ok: true, draft };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  // 45 of 301 programmes carry no `nameEn`. The English title is then a
  // record the platform does not hold, so the Thai name IS the title —
  // rather than an empty heading, or a subtitle with a separator dangling
  // where a name should be.
  const hasEnglishName = program.nameEn !== null && program.nameEn.trim().length > 0;
  const title = hasEnglishName ? (program.nameEn as string) : program.nameTh;
  const subtitleParts = [
    program.code,
    hasEnglishName ? program.nameTh : null,
    program.facultyNameEn ?? program.facultyNameTh,
  ].filter((p): p is string => typeof p === 'string' && p.trim().length > 0);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title={title}
        subtitle={`${subtitleParts.join(' · ')} — evidence this platform holds against the AUN-QA v4 criteria, for accreditation preparation.`}
      />
      <AunqaProgramClient
        analysis={analysis}
        // The DQ radar plots the framework's theory modules; the workshop
        // rows are a different instrument and are not on these axes.
        dqModules={DQ_MODULES.filter((m) => m.kind === 'THEORY')}
        generateNarrative={generateNarrative}
      />
    </AuthedAppShell>
  );
}
