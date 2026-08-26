'use client';

// /teaching-learning — AUN-QA faculty readiness overview.
//
// ── WHAT THIS TABLE SAYS ──────────────────────────────────────────────
// Every number here counts EVIDENCE THE PLATFORM HOLDS, never how well a
// programme teaches. "no-evidence" means we cannot yet show the evidence
// for that programme; it is not a verdict on the programme. Nothing on
// this page is, or may be captioned as, an AUN-QA 1-7 rating — assessors
// award those and this platform does not.
// ──────────────────────────────────────────────────────────────────────
//
// A plain table, deliberately: the codebase already has two drill-down
// pivots (Education's and Staff's) and neither carries row links, text
// cells or band chips. A third shared component would be the one nobody
// maintains, so this one stays local to the page it serves.
//
// Types are declared here rather than imported: a client component may
// only `import type` from @kku/shared / @kku/db, and the shapes below
// mirror `AunqaFacultyOverview` in apps/api/src/aunqa/aunqa.service.ts.

import * as React from 'react';
import Link from 'next/link';
import { Badge, Card } from '@kku/ui';

export type ReadinessBand = 'well-evidenced' | 'partly-evidenced' | 'no-evidence';

export interface OverviewProgram {
  id: string;
  code: string;
  nameEn: string | null;
  nameTh: string;
  level: string;
  facultyId: string;
  facultyNameTh: string;
  facultyNameEn: string | null;
}

export interface OverviewCriterionCompleteness {
  criterionId: string;
  title: string;
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: ReadinessBand;
}

export interface OverviewRow {
  program: OverviewProgram;
  criteria: OverviewCriterionCompleteness[];
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: ReadinessBand;
}

export interface FacultyOverviewResponse {
  criteria: Array<{ id: string; title: string; subCriteriaTotal: number }>;
  programs: OverviewRow[];
  unevidencedCriteria: ReadonlyArray<{ id: string; title: string; whyAbsent: string }>;
}

const BAND_LABEL: Record<ReadinessBand, string> = {
  'well-evidenced': 'Well evidenced',
  'partly-evidenced': 'Partly evidenced',
  'no-evidence': 'No evidence yet',
};

/** `no-evidence` is neutral, NOT danger. A red chip on a row that only
 *  means "we hold nothing about this programme" reads as a judgement on
 *  the programme, which is the one thing this table must not say. */
const BAND_TONE: Record<ReadinessBand, 'success' | 'warning' | 'neutral'> = {
  'well-evidenced': 'success',
  'partly-evidenced': 'warning',
  'no-evidence': 'neutral',
};

const LEVEL_LABEL: Record<string, string> = {
  BACHELOR: 'Bachelor',
  MASTER: 'Master',
  DOCTORAL: 'Doctoral',
  HIGHER_GRAD_DIPLOMA: 'Higher Grad. Diploma',
};

type SortKey = 'program' | 'faculty' | 'completeness' | { criterionId: string };
type SortDir = 'asc' | 'desc';

function sortKeyId(key: SortKey): string {
  return typeof key === 'string' ? key : `c:${key.criterionId}`;
}

function programLabel(p: OverviewProgram): string {
  return p.nameEn ?? p.nameTh;
}

function facultyLabel(p: OverviewProgram): string {
  return p.facultyNameEn ?? p.facultyNameTh;
}

/** "14 of 21" as three nodes, not one run-together string — the count and
 *  its denominator must stay legible as two separate figures. */
function OfCount({ have, total }: { have: number; total: number }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-tabular tabular-nums">{have}</span>
      <span className="text-text-tertiary"> of </span>
      <span className="font-tabular tabular-nums">{total}</span>
    </span>
  );
}

export function TeachingLearningOverviewClient({ data }: { data: FacultyOverviewResponse }) {
  const [sortKey, setSortKey] = React.useState<SortKey>('completeness');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');
  const [faculty, setFaculty] = React.useState<string>('__all__');
  const [query, setQuery] = React.useState<string>('');

  const faculties = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of data.programs) {
      if (!seen.has(row.program.facultyId)) {
        seen.set(row.program.facultyId, facultyLabel(row.program));
      }
    }
    return [...seen.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en'));
  }, [data.programs]);

  const rows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = data.programs.filter((row) => {
      if (faculty !== '__all__' && row.program.facultyId !== faculty) return false;
      if (needle.length === 0) return true;
      const haystack = [
        row.program.code,
        row.program.nameTh,
        row.program.nameEn ?? '',
        facultyLabel(row.program),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'program') {
        return dir * programLabel(a.program).localeCompare(programLabel(b.program), 'en');
      }
      if (sortKey === 'faculty') {
        return dir * facultyLabel(a.program).localeCompare(facultyLabel(b.program), 'en');
      }
      if (sortKey === 'completeness') {
        // Share, not raw count: every programme is measured against the
        // same sub-criteria today, but a criterion edit would change the
        // denominator and a raw-count sort would quietly mislead.
        const av = a.subCriteriaTotal > 0 ? a.subCriteriaWithEvidence / a.subCriteriaTotal : 0;
        const bv = b.subCriteriaTotal > 0 ? b.subCriteriaWithEvidence / b.subCriteriaTotal : 0;
        if (av !== bv) return dir * (av - bv);
        return programLabel(a.program).localeCompare(programLabel(b.program), 'en');
      }
      const ac = a.criteria.find((c) => c.criterionId === sortKey.criterionId);
      const bc = b.criteria.find((c) => c.criterionId === sortKey.criterionId);
      const av = ac?.subCriteriaWithEvidence ?? 0;
      const bv = bc?.subCriteriaWithEvidence ?? 0;
      if (av !== bv) return dir * (av - bv);
      return programLabel(a.program).localeCompare(programLabel(b.program), 'en');
    });
  }, [data.programs, faculty, query, sortKey, sortDir]);

  function clickSort(key: SortKey) {
    const id = sortKeyId(key);
    if (sortKeyId(sortKey) === id) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSortKey(key);
    // Text columns read best A→Z on first click; counts read best
    // highest-first, which is the order a dean sequences programmes in.
    setSortDir(key === 'program' || key === 'faculty' ? 'asc' : 'desc');
  }

  function sortMark(key: SortKey): string {
    if (sortKeyId(sortKey) !== sortKeyId(key)) return '';
    return sortDir === 'desc' ? ' ↓' : ' ↑';
  }

  const bandCounts = React.useMemo(() => {
    const counts: Record<ReadinessBand, number> = {
      'well-evidenced': 0,
      'partly-evidenced': 0,
      'no-evidence': 0,
    };
    for (const row of rows) counts[row.band] += 1;
    return counts;
  }, [rows]);

  return (
    <div className="mt-4 space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            <span>Faculty</span>
            <select
              value={faculty}
              onChange={(e) => setFaculty(e.target.value)}
              className="h-8 min-w-[16rem] rounded-md border border-border-default bg-surface-1 px-2 text-sm text-text-primary"
            >
              <option value="__all__">All faculties in your scope</option>
              {faculties.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            <span>Find a programme</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or code"
              className="h-8 min-w-[16rem] rounded-md border border-border-default bg-surface-1 px-2 text-sm text-text-primary"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
            <span className="font-tabular tabular-nums text-text-primary">{rows.length}</span>
            <span>programmes shown</span>
            <span aria-hidden className="text-text-tertiary">
              ·
            </span>
            <Badge tone="success" size="sm">
              {bandCounts['well-evidenced']} well evidenced
            </Badge>
            <Badge tone="warning" size="sm">
              {bandCounts['partly-evidenced']} partly evidenced
            </Badge>
            <Badge tone="neutral" size="sm">
              {bandCounts['no-evidence']} no evidence yet
            </Badge>
          </div>
        </div>
      </Card>

      {/* Named once, beside the table it qualifies — a reader must not
          infer that six criteria are the whole framework. */}
      <Card className="p-4 text-xs leading-relaxed text-text-secondary">
        <p>
          The six columns below are the AUN-QA criteria this platform can evidence from data it
          already holds. Two further criteria exist in the framework and are not shown here
          because the platform holds nothing that could evidence them for any programme:
        </p>
        <ul className="mt-2 space-y-1">
          {data.unevidencedCriteria.map((c) => (
            <li key={c.id}>
              <span className="font-medium text-text-primary">
                Criterion {c.id} — {c.title}.
              </span>{' '}
              {c.whyAbsent}
            </li>
          ))}
        </ul>
        <p className="mt-2">
          Column headings are abbreviated: {data.criteria.map((c) => `C${c.id} ${c.title}`).join(' · ')}.
        </p>
      </Card>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-surface-1">
              <tr className="border-b border-border-default text-left text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                <th
                  scope="col"
                  className="cursor-pointer select-none px-3 py-2 font-medium hover:text-text-primary"
                  onClick={() => clickSort('program')}
                >
                  Programme{sortMark('program')}
                </th>
                <th
                  scope="col"
                  className="cursor-pointer select-none px-3 py-2 font-medium hover:text-text-primary"
                  onClick={() => clickSort('faculty')}
                >
                  Faculty{sortMark('faculty')}
                </th>
                <th
                  scope="col"
                  className="cursor-pointer select-none px-3 py-2 text-right font-medium hover:text-text-primary"
                  onClick={() => clickSort('completeness')}
                >
                  Sub-criteria evidenced{sortMark('completeness')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Evidence held
                </th>
                {data.criteria.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    title={c.title}
                    className="cursor-pointer select-none px-3 py-2 text-right font-medium hover:text-text-primary"
                    onClick={() => clickSort({ criterionId: c.id })}
                  >
                    C{c.id}
                    {sortMark({ criterionId: c.id })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.program.id}
                  className="border-b border-border-subtle align-top hover:bg-surface-2"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/teaching-learning/${row.program.id}`}
                      className="font-medium text-accent-default hover:underline"
                    >
                      {programLabel(row.program)}
                    </Link>
                    <div className="mt-0.5 text-[0.7rem] text-text-tertiary">
                      <span className="font-tabular">{row.program.code}</span>
                      <span aria-hidden> · </span>
                      <span>{LEVEL_LABEL[row.program.level] ?? row.program.level}</span>
                    </div>
                    {row.program.nameEn !== null && (
                      <div className="text-[0.7rem] text-text-tertiary">{row.program.nameTh}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{facultyLabel(row.program)}</td>
                  <td className="px-3 py-2 text-right">
                    <OfCount have={row.subCriteriaWithEvidence} total={row.subCriteriaTotal} />
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={BAND_TONE[row.band]} size="sm">
                      {BAND_LABEL[row.band]}
                    </Badge>
                  </td>
                  {data.criteria.map((col) => {
                    const cell = row.criteria.find((c) => c.criterionId === col.id);
                    return (
                      <td key={col.id} className="px-3 py-2 text-right">
                        {cell === undefined ? (
                          <span className="text-text-tertiary">—</span>
                        ) : (
                          <span
                            className={
                              cell.subCriteriaWithEvidence === 0 ? 'text-text-tertiary' : undefined
                            }
                          >
                            <OfCount
                              have={cell.subCriteriaWithEvidence}
                              total={cell.subCriteriaTotal}
                            />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={4 + data.criteria.length}
                    className="px-3 py-8 text-center text-text-tertiary"
                  >
                    No programme matches this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
