import Link from 'next/link';
import { Card } from '@kku/ui';
import {
  FilterField,
  FilterRail,
  FilterSearch,
  FilterSelect,
} from '@/components/filter-rail';

// Shared programs directory — the filter rail + table used by both
// /programs and /benchmarking so the two stay pixel-identical. Server
// component: filters submit as a plain GET navigation to `basePath`, and
// each row links via `programHref` (deep-dive on /programs, benchmarking
// sub-page on /benchmarking).

export interface FacultyLite {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
}

export interface ProgramRow {
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
export type ProgramsListResponse = ProgramRow[];
export type FacultiesListResponse = FacultyLite[];

export interface ProgramsDirectoryFilters {
  status?: string;
  level?: string;
  q?: string;
  facultyId?: string;
  curriculumYearBE?: string;
  language?: string;
}

const LEVEL_LABEL: Record<ProgramRow['level'], string> = {
  BACHELOR: "Bachelor's",
  MASTER: "Master's",
  DOCTORAL: 'Doctoral',
  HIGHER_GRAD_DIPLOMA: 'Higher Grad. Dip.',
};

// Curriculum-year filter options — Buddhist Era; recent 13 years
// (2557–2569 BE) which covers KKU's canonical curriculum lineage.
const CURRICULUM_YEAR_OPTIONS = Array.from({ length: 13 }, (_, i) => 2569 - i);

// Fallback degree short-name when Program.degreeAbbrEn is null.
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

export function ProgramsDirectory({
  rows,
  faculties,
  sp,
  basePath,
  programHref,
}: {
  rows: ProgramRow[];
  faculties: FacultyLite[];
  sp: ProgramsDirectoryFilters;
  basePath: string;
  programHref: (id: string) => string;
}) {
  const total = rows.length;

  // Client-side language filter — the API doesn't accept this filter
  // yet (the field is free-text); we narrow post-hoc at this scale.
  const filtered = sp.language
    ? rows.filter((r) => (r.language ?? '').toLowerCase() === sp.language!.toLowerCase())
    : rows;

  const languageOptions = Array.from(
    new Set(rows.map((r) => r.language).filter((l): l is string => Boolean(l))),
  ).sort();

  return (
    <div className="flex flex-col gap-4">
      <FilterRail cols={4} action={basePath} method="get">
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
          <FilterSelect name="curriculumYearBE" defaultValue={sp.curriculumYearBE ?? ''}>
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
        <button type="submit" className="sr-only">
          Apply
        </button>
      </FilterRail>

      {filtered.length === 0 ? (
        <Card padding="lg">
          <p className="text-center text-sm text-text-tertiary">
            {sp.q ? `No programs match "${sp.q}".` : 'No programs match these filters.'}
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
                        href={programHref(p.id)}
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
                      href={programHref(p.id)}
                      className="font-medium text-text-primary hover:underline"
                    >
                      {p.nameEn}
                    </Link>
                    <div className="text-xs text-text-secondary">{p.nameTh}</div>
                    <div className="mt-0.5 text-[11px] text-text-tertiary">
                      {p.faculty && <span>{p.faculty.nameEn}</span>}
                      {p.faculty && p.curriculumYearBE != null && <span> · </span>}
                      {p.curriculumYearBE != null && (
                        <span title="Curriculum revision year">
                          Rev. BE {p.curriculumYearBE} (CE {p.curriculumYearBE - 543})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 text-xs text-text-secondary">{LEVEL_LABEL[p.level]}</td>
                  <td className="py-3 text-xs text-text-secondary">
                    {p.degreeAbbrEn ?? defaultDegreeShort(p.level)}
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
  );
}
