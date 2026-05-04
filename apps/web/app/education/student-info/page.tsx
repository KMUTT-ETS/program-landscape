import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import type { StatusGroup, StudentInfoResponse } from '../types';
import { StudentInfoClient } from './client';
import { EducationBackLink } from '../back-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Student info — Education' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

const VALID_GROUPS = new Set<StatusGroup>(['INCOMING', 'CURRENT', 'FORMER']);

export default async function StudentInfoPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);
  const programLevel = arr(sp.programLevel);
  const programName = arr(sp.programName);
  const statusCode = arr(sp.statusCode);
  const statusGroup = arr(sp.statusGroup).filter((s): s is StatusGroup =>
    VALID_GROUPS.has(s as StatusGroup),
  );

  const qs = new URLSearchParams();
  facultyName.forEach((v) => qs.append('facultyName', v));
  programLevel.forEach((v) => qs.append('programLevel', v));
  programName.forEach((v) => qs.append('programName', v));
  statusCode.forEach((v) => qs.append('statusCode', v));
  statusGroup.forEach((v) => qs.append('statusGroup', v));

  const data = await apiFetch<StudentInfoResponse>(
    `/education/student-info${qs.toString() ? `?${qs}` : ''}`,
  ).catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Student info"
        subtitle="Headcount across demographic and recruitment facets. Defaults to currently-enrolled students; switch to incoming or former groups, or pick a specific status code."
      />
      {data ? (
        <StudentInfoClient
          data={data}
          initialFilters={{
            facultyName,
            programLevel,
            programName,
            statusCode: statusCode.map(Number).filter((n) => Number.isFinite(n)),
            statusGroup,
          }}
        />
      ) : (
        <div className="rounded-md border border-border-subtle bg-surface-1 p-6 text-sm text-text-secondary">
          No data yet — go back to{' '}
          <a className="underline" href="/education">
            Education hub
          </a>{' '}
          and click <strong>Refresh from registry</strong> first.
        </div>
      )}
    </AuthedAppShell>
  );
}
