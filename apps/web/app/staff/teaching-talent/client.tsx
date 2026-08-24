'use client';

// /staff/teaching-talent — sustained student-evaluation quality.
//
// The threshold is applied HERE, not on the server: the API returns each
// person's per-year ratings, so moving the selector re-badges instantly
// with no refetch. The export route applies the same rule server-side.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { MultiSelectField } from '../multi-select';
import { DrillDownPivot, type DrillColumn, type DrillRow } from '../drill-down-pivot';

const THRESHOLDS = [4, 4.25, 4.5, 4.75] as const;
const WINDOW_YEARS = 3;

const RANK_ABBREV_TH: Record<string, string> = {
  LECTURER: 'อ.',
  ASST_PROF: 'ผศ.',
  ASSOC_PROF: 'รศ.',
  PROF: 'ศ.',
};

interface YearCell {
  ratingAvg: number | null;
  respondentCount: number;
}

interface InstructorRow {
  facultyMemberId: string;
  nameTh: string;
  nameEn: string;
  rank: string;
  facultyId: string;
  facultyName: string;
  isActive: boolean;
  overallRating: number | null;
  totalRespondents: number;
  courseCount: number;
  byYear: Record<string, YearCell>;
  yearsWithData: number;
  minYearRating: number | null;
}

interface UnmatchedRow {
  kkuEmail: string;
  facultyName: string | null;
  overallRating: number | null;
  totalRespondents: number;
  byYear: Record<string, YearCell>;
  yearsWithData: number;
  minYearRating: number | null;
}

export interface TalentResponse {
  methodologyVersion: string;
  years: number[];
  windowComplete: boolean;
  rows: InstructorRow[];
  unmatched: { teachers: UnmatchedRow[]; unattributableRowCount: number };
  scope?: 'own' | 'scoped' | 'full';
}

/** Mirrors classifyTalent() in @kku/db — compare on the displayed value.
 *  (Duplicated deliberately: @kku/shared and @kku/db have no exports map,
 *  so a runtime import from a client component pulls a node:crypto barrel
 *  and breaks the build. Same posture as apps/web/src/lib/format-cohort.ts.)
 *
 *  The rounding is `Number(v.toFixed(2))`, exactly as displayRating() does
 *  it — NOT Math.round(v * 100) / 100, which disagrees at 4.005 and would
 *  put an unbadged row next to a printed "4.00". */
function isTalent(byYear: Record<string, YearCell>, years: number[], threshold: number): boolean {
  if (years.length !== WINDOW_YEARS) return false;
  for (const year of years) {
    const rating = byYear[String(year)]?.ratingAvg;
    if (rating === null || rating === undefined) return false;
    if (Number(rating.toFixed(2)) < threshold) return false;
  }
  return true;
}

function weightedMean(values: Array<{ rating: number | null; respondents: number }>): number | null {
  let weighted = 0;
  let respondents = 0;
  for (const v of values) {
    if (v.rating === null) continue;
    weighted += v.rating * v.respondents;
    respondents += v.respondents;
  }
  return respondents > 0 ? weighted / respondents : null;
}

export function TeachingTalentClient({
  data,
  initialFilters,
}: {
  data: TalentResponse;
  initialFilters: { facultyName: string[]; threshold: number; talentsOnly: boolean };
}) {
  const router = useRouter();
  const [faculty, setFaculty] = React.useState<string[]>(initialFilters.facultyName);
  const [threshold, setThreshold] = React.useState<number>(initialFilters.threshold);
  const [talentsOnly, setTalentsOnly] = React.useState<boolean>(initialFilters.talentsOnly);
  const [coverageOpen, setCoverageOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);

  const { years, rows, unmatched } = data;
  const ownScope = data.scope === 'own';

  const push = (next: { faculty?: string[]; threshold?: number; talentsOnly?: boolean }) => {
    const params = new URLSearchParams();
    (next.faculty ?? faculty).forEach((v) => params.append('facultyName', v));
    const t = next.threshold ?? threshold;
    if (t !== 4) params.set('threshold', String(t));
    if (next.talentsOnly ?? talentsOnly) params.set('talentsOnly', '1');
    router.push(`/staff/teaching-talent${params.toString() ? `?${params}` : ''}`);
  };

  const talentIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (isTalent(r.byYear, years, threshold)) set.add(r.facultyMemberId);
    return set;
  }, [rows, years, threshold]);

  const eligibleCount = React.useMemo(
    () => rows.filter((r) => r.yearsWithData === WINDOW_YEARS).length,
    [rows],
  );
  const unmatchedQualifying = React.useMemo(
    () => unmatched.teachers.filter((t) => isTalent(t.byYear, years, threshold)).length,
    [unmatched.teachers, years, threshold],
  );

  const facultyOptions = React.useMemo(
    () => [...new Set(rows.map((r) => r.facultyName))].map((f) => ({ value: f, label: f })),
    [rows],
  );

  const columns: DrillColumn[] = React.useMemo(
    () => [
      { key: 'overall', label: 'Overall', format: 'decimal2' },
      { key: 'respondents', label: 'Respondents', format: 'int' },
      ...years.map((y): DrillColumn => ({ key: `y${y}`, label: `BE ${y}`, format: 'decimal2' })),
    ],
    [years],
  );

  const drillRows: DrillRow[] = React.useMemo(() => {
    const byFaculty = new Map<string, InstructorRow[]>();
    for (const r of rows) {
      if (talentsOnly && !talentIds.has(r.facultyMemberId)) continue;
      const list = byFaculty.get(r.facultyName) ?? [];
      list.push(r);
      byFaculty.set(r.facultyName, list);
    }
    return [...byFaculty.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'th'))
      .map(([facultyName, members]) => {
        const talentCount = members.filter((m) => talentIds.has(m.facultyMemberId)).length;
        const eligible = members.filter((m) => m.yearsWithData === WINDOW_YEARS).length;
        const facultyMetrics: DrillRow['metrics'] = {
          overall: weightedMean(
            members.map((m) => ({ rating: m.overallRating, respondents: m.totalRespondents })),
          ),
          respondents: members.reduce((a, m) => a + m.totalRespondents, 0),
        };
        for (const y of years) {
          facultyMetrics[`y${y}`] = weightedMean(
            members.map((m) => ({
              rating: m.byYear[String(y)]?.ratingAvg ?? null,
              respondents: m.byYear[String(y)]?.respondentCount ?? 0,
            })),
          );
        }
        return {
          label: facultyName,
          badge: {
            text: `${talentCount} talent${talentCount === 1 ? '' : 's'} / ${eligible} eligible`,
            tone: 'muted' as const,
          },
          metrics: facultyMetrics,
          children: members
            .sort((a, b) => (b.overallRating ?? 0) - (a.overallRating ?? 0))
            .map((m): DrillRow => {
              const metrics: DrillRow['metrics'] = {
                overall: m.overallRating,
                respondents: m.totalRespondents,
              };
              for (const y of years) metrics[`y${y}`] = m.byYear[String(y)]?.ratingAvg ?? null;
              const talent = talentIds.has(m.facultyMemberId);
              return {
                label: `${RANK_ABBREV_TH[m.rank] ?? ''} ${m.nameTh}`.trim(),
                emphasis: talent ? 'success' : undefined,
                badge: talent
                  ? { text: 'Talent', tone: 'success' }
                  : m.yearsWithData < WINDOW_YEARS
                    ? { text: `${m.yearsWithData}/${WINDOW_YEARS} years`, tone: 'muted' }
                    : undefined,
                metrics,
              };
            }),
        };
      });
  }, [rows, years, talentIds, talentsOnly]);

  async function runExport() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch('/api/staff-talent-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyName: faculty, threshold }),
      });
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match?.[1] ?? 'kku-teaching-talent.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const windowLabel =
    years.length > 0 ? `BE ${years[0]}–${years[years.length - 1]}` : 'no complete years';

  return (
    <div className="flex flex-col gap-4">
      {!data.windowComplete && (
        <Card>
          <p className="text-xs text-warning">
            The talent rule needs {WINDOW_YEARS} completed academic years. Only {years.length}{' '}
            carry evaluation data ({windowLabel}), so nobody is badged. The table below still
            shows the years available.
          </p>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectField
            label="Faculty"
            options={facultyOptions}
            selected={faculty}
            onChange={(vs) => {
              setFaculty(vs);
              push({ faculty: vs });
            }}
          />
          <div className="flex flex-col gap-1">
            <span className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">
              Talent threshold
            </span>
            <div className="flex gap-1">
              {THRESHOLDS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setThreshold(t);
                    push({ threshold: t });
                  }}
                  className={`rounded border px-2 py-1 text-xs ${
                    threshold === t
                      ? 'border-strong bg-accent-subtle text-accent-default'
                      : 'border-subtle bg-surface-1 text-text-secondary hover:bg-surface-2'
                  }`}
                >
                  {t.toFixed(2)}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={talentsOnly}
              onChange={(e) => {
                setTalentsOnly(e.target.checked);
                push({ talentsOnly: e.target.checked });
              }}
            />
            Talents only
          </label>
          {!ownScope && (
            <button
              type="button"
              onClick={runExport}
              disabled={exporting || talentIds.size === 0}
              className="ml-auto inline-flex items-center gap-1.5 rounded border border-subtle bg-surface-1 px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-2 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? 'Preparing…' : `Export ${talentIds.size} talents (xlsx)`}
            </button>
          )}
        </div>
        {exportError && <p className="mt-2 text-xs text-danger">{exportError}</p>}
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Talents"
          value={String(talentIds.size)}
          hint={`at ${threshold.toFixed(2)} and above`}
        />
        <Kpi
          label="Eligible"
          value={String(eligibleCount)}
          hint={`have all ${WINDOW_YEARS} years`}
        />
        <Kpi
          label="Instructors assessed"
          value={String(rows.length)}
          hint="any evaluation in window"
        />
        <Kpi label="Window" value={windowLabel} hint="completed academic years" />
      </div>

      <Card>
        <DrillDownPivot
          rows={drillRows}
          columns={columns}
          rowHeaderLabel="Faculty / staff"
          maxDepth={2}
        />
      </Card>

      {!ownScope && (
        <Card>
          <button
            type="button"
            onClick={() => setCoverageOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 text-left text-xs font-medium hover:text-accent-default"
          >
            {coverageOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Coverage — {unmatched.teachers.length} evaluated teachers have no HR record
            {unmatchedQualifying > 0 && `, ${unmatchedQualifying} of whom would qualify`}
          </button>
          <p className="mt-2 text-xs text-text-secondary">
            {rows.length} evaluated instructors are in the table above. A further{' '}
            {unmatched.teachers.length} teachers were evaluated but match no HR record, so they
            cannot be named or exported.{' '}
            {unmatched.unattributableRowCount.toLocaleString('en-US')} evaluation rows are
            credited to no identifiable person. Fixing this means adding these people to the
            HR-sourced roster (the <code>kku-hr</code> connector), not editing this dashboard.
          </p>
          {coverageOpen && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-subtle text-left text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                    <th className="px-2 py-1.5 font-medium">Email</th>
                    <th className="px-2 py-1.5 font-medium">Faculty (class owner)</th>
                    {years.map((y) => (
                      <th key={y} className="px-2 py-1.5 text-right font-medium">
                        BE {y}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-right font-medium">Respondents</th>
                    <th className="px-2 py-1.5 text-right font-medium">Overall</th>
                    <th className="px-2 py-1.5 font-medium">Would qualify</th>
                  </tr>
                </thead>
                <tbody>
                  {[...unmatched.teachers]
                    .sort((a, b) => {
                      const aq = isTalent(a.byYear, years, threshold) ? 1 : 0;
                      const bq = isTalent(b.byYear, years, threshold) ? 1 : 0;
                      return bq - aq || (b.overallRating ?? 0) - (a.overallRating ?? 0);
                    })
                    .map((t) => (
                      <tr key={t.kkuEmail} className="border-b border-subtle">
                        <td className="px-2 py-1">{t.kkuEmail}</td>
                        <td className="px-2 py-1">{t.facultyName ?? '—'}</td>
                        {years.map((y) => (
                          <td key={y} className="px-2 py-1 text-right font-tabular">
                            {t.byYear[String(y)]?.ratingAvg?.toFixed(2) ?? '—'}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right font-tabular">
                          {t.totalRespondents.toLocaleString('en-US')}
                        </td>
                        <td className="px-2 py-1 text-right font-tabular">
                          {t.overallRating?.toFixed(2) ?? '—'}
                        </td>
                        <td className="px-2 py-1">
                          {isTalent(t.byYear, years, threshold) ? 'yes' : 'no'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <p className="text-xs text-text-tertiary">
        A talent scored {threshold.toFixed(2)} or above in every one of the last {WINDOW_YEARS}{' '}
        completed academic years ({windowLabel}), across all semesters, respondent-weighted.
        Grouped by the instructor&apos;s home faculty — curriculum mapping does not gate this
        list. Methodology {data.methodologyVersion}. For the question-by-question detail behind
        any rating, see Teaching evaluations.
      </p>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <p className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="mt-1 text-xl font-semibold font-tabular">{value}</p>
      <p className="mt-0.5 text-[0.65rem] text-text-tertiary">{hint}</p>
    </Card>
  );
}
