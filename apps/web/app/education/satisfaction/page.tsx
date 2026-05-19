import { redirect } from 'next/navigation';
import { canSeeProgramAwareDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { SatisfactionSection } from './satisfaction-section';
import { EducationBackLink } from '../back-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Student evaluations — Education' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function SatisfactionPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeProgramAwareDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);

  const overallQs = new URLSearchParams();
  facultyName.forEach((v) => overallQs.append('facultyName', v));
  const overallQsString = overallQs.toString() ? `?${overallQs}` : '';

  const tableQs = new URLSearchParams(overallQs);
  tableQs.append('semester', '1');
  tableQs.append('semester', '2');
  const tableQsString = `?${tableQs}`;

  const overallRes = await apiFetchSafe<unknown>(
    `/education/satisfaction/overall${overallQsString}`,
  );

  const [byProgram, trend] = await Promise.all([
    apiFetch<unknown>(`/education/satisfaction/by-program${tableQsString}`).catch(
      () => null,
    ),
    apiFetch<unknown>(`/education/satisfaction/trend${overallQsString}`).catch(() => null),
  ]);

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Student evaluations"
        subtitle="What students said about their courses. Drill from faculty down to a single course; hover any course name to see how it scored on each evaluation question. Per-instructor scores live on Staff → Teaching evaluations."
      />
      {overallRes.ok ? (
        <SatisfactionSection
          overall={overallRes.data as Parameters<typeof SatisfactionSection>[0]['overall']}
          trend={trend as Parameters<typeof SatisfactionSection>[0]['trend']}
          byProgramInitial={
            byProgram as Parameters<typeof SatisfactionSection>[0]['byProgramInitial']
          }
          facultyNameFilter={facultyName}
        />
      ) : (
        <DiagnosticEmptyState surface="student evaluations" error={overallRes.error} />
      )}
    </AuthedAppShell>
  );
}
