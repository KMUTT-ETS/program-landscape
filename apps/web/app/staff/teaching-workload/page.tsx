import { redirect } from 'next/navigation';
import { canSeeProgramAwareDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import {
  FilterField,
  FilterRail,
  FilterSelect,
} from '@/components/filter-rail';
import { StaffBackLink } from '../back-link';
import { TeachingWorkloadClient } from './client';
import type {
  ByFacultyResponse,
  FilterOptions,
  HistogramResponse,
  StudentsByFacultyResponse,
  Summary,
  TeachersResponse,
} from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Teaching workload — Staff' };

const SEMESTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1', label: 'Semester 1 (main)' },
  { value: '2', label: 'Semester 2 (main)' },
  { value: '3', label: 'Semester 3 (summer)' },
  { value: '4', label: 'Semester 4 (special)' },
];

export default async function TeachingWorkloadPage({
  searchParams,
}: {
  searchParams: Promise<{
    acadYearBE?: string;
    semester?: string;
    levelName?: string;
  }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeProgramAwareDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const acadYearBE = sp.acadYearBE ? Number(sp.acadYearBE) : undefined;
  const semester = sp.semester ? Number(sp.semester) : undefined;
  const levelName = sp.levelName ?? '';

  const qs = new URLSearchParams();
  if (acadYearBE !== undefined && !Number.isNaN(acadYearBE)) qs.set('acadYearBE', String(acadYearBE));
  if (semester !== undefined && !Number.isNaN(semester)) qs.set('semester', String(semester));
  if (levelName) qs.append('levelName', levelName);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  const [summaryRes, histRes, facRes, studentsRes, teachersRes, options] =
    await Promise.all([
      apiFetchSafe<Summary>(`/staff-dashboard/teaching-workload/summary${suffix}`),
      apiFetchSafe<HistogramResponse>(
        `/staff-dashboard/teaching-workload/histogram${suffix}`,
      ),
      apiFetchSafe<ByFacultyResponse>(
        `/staff-dashboard/teaching-workload/by-faculty${suffix}`,
      ),
      apiFetchSafe<StudentsByFacultyResponse>(
        `/staff-dashboard/teaching-workload/students-by-faculty${suffix}`,
      ),
      apiFetchSafe<TeachersResponse>(
        `/staff-dashboard/teaching-workload/teachers${suffix}`,
      ),
      apiFetch<FilterOptions>(
        '/staff-dashboard/teaching-workload/filter-options',
      ).catch(() => null),
    ]);

  if (
    !summaryRes.ok &&
    !histRes.ok &&
    !facRes.ok &&
    !studentsRes.ok &&
    !teachersRes.ok
  ) {
    return (
      <AuthedAppShell user={user}>
        <StaffBackLink />
        <PageHeader
          title="Teaching workload"
          subtitle="Contact hours per teacher per week. Source: POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER."
        />
        <DiagnosticEmptyState
          surface="teaching workload"
          error={summaryRes.ok ? null : summaryRes.error}
        />
      </AuthedAppShell>
    );
  }

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Teaching workload"
        subtitle="Contact hours per teacher per week, summed across every section they teach. Lecture + lab hours come straight from COURSEUNIT (the 'B' and 'C' in 'A (B-C-D)'). Defaults to the most recently completed main term."
      />

      <div className="flex flex-col gap-4">
        {/* Server-form filter rail — same UI as /programs. Reliable
            because state lives in the URL, not in React. */}
        <FilterRail cols={4} action="/staff/teaching-workload" method="get">
          <FilterField label="Academic year (BE)">
            <FilterSelect name="acadYearBE" defaultValue={sp.acadYearBE ?? ''}>
              <option value="">Latest completed</option>
              {(options?.years ?? []).map((y) => (
                <option key={y} value={String(y)}>
                  BE {y} (CE {y - 543})
                </option>
              ))}
            </FilterSelect>
          </FilterField>
          <FilterField label="Semester">
            <FilterSelect name="semester" defaultValue={sp.semester ?? ''}>
              <option value="">Default</option>
              {SEMESTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </FilterSelect>
          </FilterField>
          <FilterField label="Program level">
            <FilterSelect name="levelName" defaultValue={levelName}>
              <option value="">All levels</option>
              {(options?.levels ?? []).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </FilterSelect>
          </FilterField>
          <button type="submit" className="sr-only">
            Apply
          </button>
        </FilterRail>

        <TeachingWorkloadClient
          summary={summaryRes.ok ? summaryRes.data : null}
          histogram={histRes.ok ? histRes.data : null}
          byFaculty={facRes.ok ? facRes.data : null}
          studentsByFaculty={studentsRes.ok ? studentsRes.data : null}
          teachers={teachersRes.ok ? teachersRes.data : null}
          scopeFaculties={options?.faculties ?? []}
        />
      </div>
    </AuthedAppShell>
  );
}
