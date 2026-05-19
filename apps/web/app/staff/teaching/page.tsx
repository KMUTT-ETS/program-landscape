import { redirect } from 'next/navigation';
import { canSeeProgramAwareDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { TeachingSection } from './teaching-section';
import { StaffBackLink } from '../back-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Teaching evaluations — Staff' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function StaffTeachingEvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const role = user.effectiveRole ?? user.role;
  if (!canSeeProgramAwareDashboards(role)) redirect('/no-access');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);
  const qs = new URLSearchParams();
  facultyName.forEach((v) => qs.append('facultyName', v));
  qs.append('semester', '1');
  qs.append('semester', '2');
  const qsString = `?${qs}`;

  const overallRes = await apiFetchSafe<unknown>(`/staff/teaching/overall${qsString}`);
  const byProgram = await apiFetch<unknown>(`/staff/teaching/by-program${qsString}`).catch(
    () => null,
  );

  // For PROGRAM_USER, pre-load their personal data so the drill opens
  // immediately (the API marks `scope: 'own'` on overall).
  const isOwnOnly =
    overallRes.ok && (overallRes.data as { scope?: string }).scope === 'own';
  const ownPersonal = isOwnOnly
    ? await apiFetch<unknown>(`/staff/teaching/me${qsString}`).catch(() => null)
    : null;
  // For own-only, surface the facultyMemberId from the by-program payload's
  // single row (the API filters server-side).
  const ownFacultyMemberId =
    isOwnOnly && byProgram && (byProgram as { rows: Array<{ facultyMemberId: string }> }).rows[0]
      ? (byProgram as { rows: Array<{ facultyMemberId: string }> }).rows[0]!.facultyMemberId
      : null;

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Teaching evaluations"
        subtitle="How students rate each teacher. Drill from faculty → degree level → program → teacher; hover any rating cell to see the question-by-question breakdown; click a teacher to open the full detail panel below. Course-only views without instructor names live on Education → Student evaluations."
      />
      {overallRes.ok ? (
        <TeachingSection
          overall={overallRes.data as Parameters<typeof TeachingSection>[0]['overall']}
          byProgramInitial={
            byProgram as Parameters<typeof TeachingSection>[0]['byProgramInitial']
          }
          facultyNameFilter={facultyName}
          ownPersonal={ownPersonal as Parameters<typeof TeachingSection>[0]['ownPersonal']}
          ownFacultyMemberId={ownFacultyMemberId}
        />
      ) : (
        <DiagnosticEmptyState surface="teaching evaluations" error={overallRes.error} />
      )}
    </AuthedAppShell>
  );
}
