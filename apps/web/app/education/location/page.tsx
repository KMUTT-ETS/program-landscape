import { redirect } from 'next/navigation';
import { isUniversityWide, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
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
  if (!isUniversityWide(user.role)) redirect('/no-access');

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

  const data = await apiFetch<LocationResponse>(
    `/education/by-location${qs.toString() ? `?${qs}` : ''}`,
  ).catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Student by location"
        subtitle="Where current students went to school — by school name, province, and Thailand region."
      />
      {data ? (
        <LocationClient
          data={data}
          initialFilters={{
            cohortYearBe: cohortYearBe.map(Number).filter((n) => Number.isFinite(n)),
            region: region as ThailandRegion[],
            facultyName,
            programLevel,
            programName,
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
