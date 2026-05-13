import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Card, PageHeader } from '@kku/ui';
import {
  FilterField,
  FilterRail,
  FilterSearch,
  FilterSelect,
} from '@/components/filter-rail';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Programs' };

interface FacultyLite {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
}

interface ProgramRow {
  id: string;
  code: string;
  mhesiCode: string | null;
  nameEn: string;
  nameTh: string;
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
  status: 'ACTIVE' | 'PAUSED' | 'SUNSET';
  facultyId: string;
  departmentId: string | null;
  yearEstablished: number | null;
  curriculumYearBE: number | null;
  totalCredits: number | null;
  durationYears: number | null;
  language: string | null;
  degreeAbbrEn: string | null;
  degreeAbbrTh: string | null;
  faculty: FacultyLite | null;
}

// The API controller returns `{ data, meta }` which the envelope
// interceptor FLATTENS — by the time `apiFetch` unwraps the outer
// envelope, we're left with the inner data array directly.
type ProgramsListResponse = ProgramRow[];
type FacultiesListResponse = FacultyLite[];

const STATUS_TONE: Record<
  ProgramRow['status'],
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  SUNSET: 'danger',
};

const LEVEL_LABEL: Record<ProgramRow['level'], string> = {
  BACHELOR: "Bachelor's",
  MASTER: "Master's",
  DOCTORAL: 'Doctoral',
  HIGHER_GRAD_DIPLOMA: 'Higher Grad. Dip.',
};

// Curriculum-year filter options — surfaced as a dropdown. Buddhist
// Era; we list the recent 12 years (2557–2569 BE) which covers KKU's
// canonical curriculum lineage. Years with no programs land as no-ops
// since the DB filter returns an empty set.
const CURRICULUM_YEAR_OPTIONS = Array.from({ length: 13 }, (_, i) => 2569 - i);

export default async function ProgramsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    level?: string;
    q?: string;
    page?: string;
    facultyId?: string;
    curriculumYearBE?: string;
    language?: string;
  }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));
  // Request a large page so we can get everything in one shot — KKU
  // has 297 programs, so pageSize=500 covers the whole portfolio.
  const qs = new URLSearchParams({
    scope: 'university',
    pageSize: '500',
    page: String(page),
  });
  if (sp.status) qs.set('status', sp.status);
  if (sp.level) qs.set('level', sp.level);
  if (sp.facultyId) qs.set('facultyId', sp.facultyId);
  if (sp.curriculumYearBE) qs.set('curriculumYearBE', sp.curriculumYearBE);
  if (sp.q) qs.set('q', sp.q);

  // Fetch programs + faculties in parallel. Both endpoints reject
  // unauthenticated requests; if either fails for an authenticated
  // user the page still renders with a clear empty state.
  const [rows, faculties] = await Promise.all([
    apiFetch<ProgramsListResponse>(`/programs?${qs}`).catch(() => [] as ProgramRow[]),
    // hasPrograms=true drops faculties that have no canonical programs
    // — keeps the Faculty filter aligned with the rows actually shown.
    apiFetch<FacultiesListResponse>('/faculties?hasPrograms=true').catch(
      () => [] as FacultyLite[],
    ),
  ]);

  const total = rows.length;

  // Client-side language filter — the API doesn't accept this filter
  // yet (the field is free-text); we narrow post-hoc at this scale (297
  // programs) for free.
  const filtered = sp.language
    ? rows.filter((r) => (r.language ?? '').toLowerCase() === sp.language!.toLowerCase())
    : rows;

  // Distinct language values present in the result set — used to
  // populate the Language dropdown so we only offer values that exist.
  const languageOptions = Array.from(
    new Set(rows.map((r) => r.language).filter((l): l is string => Boolean(l))),
  ).sort();

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Programs"
        subtitle={`${total} of the 297 canonical KKU programs — click through for the full deep-dive on any program. Legacy and non-canonical programs are excluded from this view but remain joinable from staff and education dashboards.`}
      />
      <div className="flex flex-col gap-4">
        {/* Server-form filter rail — same chrome as the client-side
            client-component rails (Card-wrapped grid, Label per field,
            kku-select), but submits as a plain GET navigation so the
            page can stay a server component. */}
        <FilterRail cols={4} action="/programs" method="get">
          <FilterField label="Search" span={2}>
            <FilterSearch
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="Code, MHESI code, or name…"
            />
          </FilterField>
          <FilterField label="Faculty">
            <FilterSelect name="facultyId" defaultValue={sp.facultyId ?? ''}>
              <option value="">All faculties</option>
              {faculties.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nameEn}
                </option>
              ))}
            </FilterSelect>
          </FilterField>
          <FilterField label="Level">
            <FilterSelect name="level" defaultValue={sp.level ?? ''}>
              <option value="">All levels</option>
              <option value="BACHELOR">Bachelor&rsquo;s</option>
              <option value="MASTER">Master&rsquo;s</option>
              <option value="DOCTORAL">Doctoral</option>
              <option value="HIGHER_GRAD_DIPLOMA">Higher Grad. Dip.</option>
            </FilterSelect>
          </FilterField>
          <FilterField label="Status">
            <FilterSelect name="status" defaultValue={sp.status ?? ''}>
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="SUNSET">Sunset</option>
            </FilterSelect>
          </FilterField>
          <FilterField label="Curriculum year (BE)">
            <FilterSelect
              name="curriculumYearBE"
              defaultValue={sp.curriculumYearBE ?? ''}
            >
              <option value="">Any year</option>
              {CURRICULUM_YEAR_OPTIONS.map((y) => (
                <option key={y} value={String(y)}>
                  BE {y} (CE {y - 543})
                </option>
              ))}
            </FilterSelect>
          </FilterField>
          {languageOptions.length > 0 && (
            <FilterField label="Language">
              <FilterSelect name="language" defaultValue={sp.language ?? ''}>
                <option value="">All languages</option>
                {languageOptions.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </FilterSelect>
            </FilterField>
          )}
          {/* Hidden submit so Enter on the search input commits the form */}
          <button type="submit" className="sr-only">
            Apply
          </button>
        </FilterRail>

        {filtered.length === 0 ? (
          <Card padding="lg">
            <p className="text-center text-sm text-text-tertiary">
              {sp.q
                ? `No programs match "${sp.q}".`
                : 'No programs match these filters.'}
            </p>
          </Card>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b border-subtle bg-surface-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="px-4 py-3">Code · CURR_ID</th>
                  <th className="py-3">Program</th>
                  <th className="py-3">Level</th>
                  <th className="py-3">Degree</th>
                  <th className="py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-subtle align-top transition-colors last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col leading-tight">
                        <Link
                          href={`/programs/${p.id}`}
                          className="font-mono text-xs font-semibold text-accent-default hover:underline"
                        >
                          {p.code}
                        </Link>
                        <span
                          className="font-mono text-[10.5px] font-normal text-text-tertiary"
                          title="UNICON / MHESI curriculum ID — Program.mhesiCode"
                        >
                          {p.mhesiCode ?? '— no CURR_ID —'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <Link
                        href={`/programs/${p.id}`}
                        className="font-medium text-text-primary hover:underline"
                      >
                        {p.nameEn}
                      </Link>
                      <div className="text-xs text-text-secondary">{p.nameTh}</div>
                      {p.faculty && (
                        <div className="mt-0.5 text-[11px] text-text-tertiary">
                          {p.faculty.nameEn}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-xs text-text-secondary">
                      {LEVEL_LABEL[p.level]}
                    </td>
                    <td className="py-3">
                      <Badge tone="outline">
                        {p.degreeAbbrEn ?? defaultDegreeShort(p.level)}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <p className="text-xs text-text-tertiary">
          Showing {filtered.length} of {total} programs.
        </p>
      </div>
    </AuthedAppShell>
  );
}

// Fallback degree short-name when Program.degreeAbbrEn is null (older
// rows that pre-date the curriculum-doc import). Mirrors the previous
// hand-picked defaults from the legacy LEVEL_LABEL map.
function defaultDegreeShort(level: ProgramRow['level']): string {
  switch (level) {
    case 'BACHELOR':
      return 'B.Sc.';
    case 'MASTER':
      return 'M.Sc.';
    case 'DOCTORAL':
      return 'Ph.D.';
    case 'HIGHER_GRAD_DIPLOMA':
      return 'H.Grad.Dip.';
  }
}
