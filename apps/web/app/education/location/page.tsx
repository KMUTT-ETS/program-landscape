import { redirect } from 'next/navigation';
import { canSeeFacultyDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import type { LocationResponse, ThailandRegion } from '../types';
import { LocationClient } from './client';
import { EducationBackLink } from '../back-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Student by location — Education' };

const REGIONS = [
  'NORTH',
  'NORTHEAST',
  'CENTRAL',
  'EAST',
  'WEST',
  'SOUTH',
] as const;

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function LocationPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeFacultyDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const cohortYearBe = arr(sp.cohortYearBe);
  const facultyName = arr(sp.facultyName);
  const programLevel = arr(sp.programLevel);
  const programName = arr(sp.programName);
  const region = arr(sp.region).filter((r): r is (typeof REGIONS)[number] =>
    (REGIONS as readonly string[]).includes(r),
  );

  const qs = new URLSearchParams();
  cohortYearBe.forEach((v) => qs.append('cohortYearBe', v));
  facultyName.forEach((v) => qs.append('facultyName', v));
  programLevel.forEach((v) => qs.append('programLevel', v));
  programName.forEach((v) => qs.append('programName', v));
  region.forEach((v) => qs.append('region', v));

  const dataRes = await apiFetchSafe<LocationResponse>(
    `/education/by-location${qs.toString() ? `?${qs}` : ''}`,
  );

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Student by location"
        subtitle="Where current students went to school — by school name, province, and Thailand region."
      />
      {dataRes.ok ? (
        <LocationClient
          data={dataRes.data}
          initialFilters={{
            cohortYearBe: cohortYearBe.map(Number).filter((n) => Number.isFinite(n)),
            region: region as ThailandRegion[],
            facultyName,
            programLevel,
            programName,
          }}
        />
      ) : (
        <DiagnosticEmptyState surface="student location" error={dataRes.error} />
      )}
    </AuthedAppShell>
  );
}
