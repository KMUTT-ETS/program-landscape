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
import { EducationBackLink } from '../back-link';
import { ClassOfferingsClient } from './client';
import type {
  DeepDiveResponse,
  DistributionResponse,
  FilterOptions,
  GeResponse,
  HeatmapResponse,
  Summary,
} from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Subject offerings & fulfilment — Education' };

// Localised labels for the semester dropdown — Thai operators read
// the registrar's labels every day, so we use those exact words.
const SEMESTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1', label: 'Semester 1 (main)' },
  { value: '2', label: 'Semester 2 (main)' },
  { value: '3', label: 'Semester 3 (summer)' },
  { value: '4', label: 'Semester 4 (special)' },
];

export default async function ClassOfferingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    acadYearBE?: string;
    semester?: string;
    levelName?: string;
    geOnly?: string;
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
  const geOnly = sp.geOnly === 'true' || sp.geOnly === '1';

  const qs = new URLSearchParams();
  if (acadYearBE !== undefined && !Number.isNaN(acadYearBE)) qs.set('acadYearBE', String(acadYearBE));
  if (semester !== undefined && !Number.isNaN(semester)) qs.set('semester', String(semester));
  if (levelName) qs.append('levelName', levelName);
  if (geOnly) qs.set('geOnly', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  // Parallel fetches — apiFetchSafe lets each panel render its own
  // empty state so a single misconfigured connector doesn't take the
  // whole page down.
  const [summaryRes, heatmapRes, distRes, geRes, deepRes, options] =
    await Promise.all([
      apiFetchSafe<Summary>(`/education/class-offerings/summary${suffix}`),
      apiFetchSafe<HeatmapResponse>(`/education/class-offerings/heatmap${suffix}`),
      apiFetchSafe<DistributionResponse>(
        `/education/class-offerings/distribution${suffix}`,
      ),
      apiFetchSafe<GeResponse>(`/education/class-offerings/ge`),
      apiFetchSafe<DeepDiveResponse>(
        `/education/class-offerings/deep-dive${suffix}`,
      ),
      apiFetch<FilterOptions>(
        '/education/class-offerings/filter-options',
      ).catch(() => null),
    ]);

  if (
    !summaryRes.ok &&
    !heatmapRes.ok &&
    !distRes.ok &&
    !geRes.ok &&
    !deepRes.ok
  ) {
    return (
      <AuthedAppShell user={user}>
        <EducationBackLink />
        <PageHeader
          title="Subject offerings & fulfilment"
          subtitle="One row per class section the registrar opened. Source: POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER."
        />
        <DiagnosticEmptyState
          surface="class offerings"
          error={summaryRes.ok ? null : summaryRes.error}
        />
      </AuthedAppShell>
    );
  }

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Subject offerings & fulfilment"
        subtitle="Every course-section the registrar opened in a given semester, with how well each is filling, the gen-ed split, and a faculty → program-level → course drill-down. Defaults to the most recently completed main term."
      />

      <div className="flex flex-col gap-4">
        {/* Server-form filter rail — same UI as /programs.
            Auto-submits on dropdown change. */}
        <FilterRail cols={4} action="/education/class-offerings" method="get">
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
          <FilterField label="General-education only">
            <FilterSelect name="geOnly" defaultValue={geOnly ? 'true' : ''}>
              <option value="">Show all subjects</option>
              <option value="true">GE subjects only</option>
            </FilterSelect>
          </FilterField>
          <button type="submit" className="sr-only">
            Apply
          </button>
        </FilterRail>

        <ClassOfferingsClient
          summary={summaryRes.ok ? summaryRes.data : null}
          heatmap={heatmapRes.ok ? heatmapRes.data : null}
          distribution={distRes.ok ? distRes.data : null}
          ge={geRes.ok ? geRes.data : null}
          deepDive={deepRes.ok ? deepRes.data : null}
          scopeFaculties={options?.faculties ?? []}
        />
      </div>
    </AuthedAppShell>
  );
}
