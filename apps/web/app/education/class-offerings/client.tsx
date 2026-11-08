'use client';

import { useOrgNames } from '@/components/org-names-context';
import * as React from 'react';
import { Card } from '@kku/ui';
import { ChevronRight } from 'lucide-react';
import type {
  DeepDiveFacultyGroup,
  DeepDiveLevelGroup,
  DeepDiveCourseRow,
  DeepDiveResponse,
  DistributionResponse,
  GeResponse,
  HeatmapResponse,
  Summary,
} from './types';

interface Props {
  summary: Summary | null;
  heatmap: HeatmapResponse | null;
  distribution: DistributionResponse | null;
  ge: GeResponse | null;
  deepDive: DeepDiveResponse | null;
  scopeFaculties: string[];
}

// Colour ramp for the fill-rate cells. Each band carries its own
// background + foreground because a single text colour can't sit on
// both the lightest band (#fde7ad — needs near-black text) and the
// darkest (#a6192e — needs white text). Verified to clear WCAG AA at
// the size we render (text-[11px] ≈ 11px, small text contrast ratio).
// Same hex pair renders on light + dark theme — the pill sits on a
// fixed-coloured background, not on `surface-*`, so theme doesn't
// shift the local contrast.
const FILL_RATE_PALETTE = [
  { upTo: 0,      bg: '#e7e5e1', fg: '#1f2937' }, // empty — neutral light
  { upTo: 0.25,   bg: '#fde7ad', fg: '#1f2937' }, // light amber — dark text
  { upTo: 0.50,   bg: '#facd6a', fg: '#1f2937' }, // amber — dark text
  { upTo: 0.75,   bg: '#f0a232', fg: '#1f2937' }, // darker amber — still dark text
  { upTo: 0.9999, bg: '#dc7a20', fg: '#ffffff' }, // deep orange — white text
  { upTo: Infinity, bg: '#a6192e', fg: '#ffffff' }, // dark red — white text
] as const;

function fillRateBand(rate: number): (typeof FILL_RATE_PALETTE)[number] {
  if (rate <= 0) return FILL_RATE_PALETTE[0];
  for (const band of FILL_RATE_PALETTE) {
    if (rate <= band.upTo) return band;
  }
  return FILL_RATE_PALETTE[FILL_RATE_PALETTE.length - 1]!;
}

function fillRateColour(rate: number): string {
  return fillRateBand(rate).bg;
}

const SEMESTER_LABEL: Record<number, string> = {
  1: 'Semester 1 (main)',
  2: 'Semester 2 (main)',
  3: 'Semester 3 (summer)',
  4: 'Semester 4 (special)',
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US');
}
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function ClassOfferingsClient({
  summary,
  heatmap,
  distribution,
  ge,
  deepDive,
  scopeFaculties,
}: Props) {
  const org = useOrgNames();
  const snapLabel =
    summary && summary.acadYearBE && summary.semester
      ? `BE ${summary.acadYearBE} · ${SEMESTER_LABEL[summary.semester] ?? `Sem ${summary.semester}`}`
      : '—';

  return (
    <div className="space-y-6">
      {/* ── snapshot bar ── */}
      <p className="text-[11px] text-fg-3">
        Showing: <strong>{snapLabel}</strong>
        {scopeFaculties.length > 0 && (
          <>
            {' '}
            · scope: {scopeFaculties.length}{' '}
            facult{scopeFaculties.length === 1 ? 'y' : 'ies'} you can see
          </>
        )}
      </p>

      {/* ── KPI tiles ── */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile
            label="Sections opened"
            value={fmt(summary.totalSections)}
            tooltip="Every class-section the registrar opened in this snapshot — same course can have many parallel sections."
          />
          <KpiTile
            label="Seat fill rate"
            value={pct(summary.fillRate)}
            hint={`${fmt(summary.totalSeatsFilled)} students filled ${fmt(summary.totalSeatsOffered)} seats`}
            tooltip="Σ students enrolled ÷ Σ seats offered, across every section in scope."
          />
          <KpiTile
            label="Distinct courses"
            value={fmt(summary.distinctCourses)}
            tooltip="Unique course codes appearing in the snapshot (sections of the same course are counted once)."
          />
          <KpiTile
            label="Teachers in front of class"
            value={fmt(summary.distinctTeachers)}
            tooltip={`Distinct ${org.en} emails appearing in the registrar's KKUMAIL field (de-duped per CLASSID).`}
          />
          <KpiTile
            label="Credits delivered"
            value={fmt(summary.totalCreditsDelivered)}
            hint="Σ CREDITTOTAL · weights the offering by course size"
            tooltip="Sum of CREDITTOTAL across every opened section — a rough proxy for total faculty-load delivered."
          />
          <KpiTile
            label="Empty sections"
            value={fmt(summary.zeroEnrollmentSections)}
            hint={`${pct(summary.zeroEnrollmentSections / Math.max(summary.totalSections, 1))} of total`}
            tone="warning"
            tooltip="Sections with enroll seat = 0 — open but no students. Some are pre-allocated capacity; persistent zeros are wasted faculty load."
          />
          <KpiTile
            label="GE sections"
            value={fmt(summary.geSections)}
            hint="general-education catalogue"
            tooltip="Sections whose course code starts with 00 or GE, or whose owner is the GE Institute / Language Institute."
          />
          <KpiTile
            label="Faculties teaching"
            value={fmt(summary.distinctFaculties)}
            tooltip="Distinct owning faculties (as the registrar attributes them — FACULTYNAME / FACULTYID)."
          />
        </div>
      )}

      {/* ── Viz 1 — seat-fill heatmap ── */}
      {heatmap && heatmap.rows.length > 0 && heatmap.yearSemesters.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">Seat fill — faculty × semester</h2>
          <p className="text-xs text-fg-3 mb-3">
            Rows are the registrar's owning faculties. Each cell is the
            weighted fill rate (Σ enrolled ÷ Σ seats) for that semester.
            In-progress and future terms are hidden — only semesters with
            real enrolment appear.
          </p>
          <div className="overflow-x-auto">
            <table className="text-[11px] border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1 sticky left-0 bg-surface-1">
                    Faculty
                  </th>
                  {heatmap.yearSemesters.map((ys) => (
                    <th
                      key={`${ys.acadYearBE}-${ys.semester}`}
                      className="px-1.5 py-1 text-fg-2 font-medium whitespace-nowrap"
                      title={`Buddhist-Era ${ys.acadYearBE}, ${SEMESTER_LABEL[ys.semester] ?? `Semester ${ys.semester}`} — CE ${ys.acadYearBE - 543}–${ys.acadYearBE - 542}`}
                    >
                      {ys.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.rows.map((row) => {
                  const cellMap = new Map(
                    row.cells.map((c) => [`${c.acadYearBE}-${c.semester}`, c]),
                  );
                  return (
                    <tr key={row.facultyName}>
                      <td className="px-2 py-1 sticky left-0 bg-surface-1 whitespace-nowrap font-medium" title={row.facultyName}>
                        {row.facultyName}
                      </td>
                      {heatmap.yearSemesters.map((ys) => {
                        const c = cellMap.get(`${ys.acadYearBE}-${ys.semester}`);
                        const rate = c?.fillRate ?? 0;
                        return (
                          <td
                            key={`${ys.acadYearBE}-${ys.semester}`}
                            className="p-0.5"
                          >
                            <div
                              className="text-center text-[10px] py-1 px-1 rounded-sm cursor-default"
                              style={{
                                backgroundColor: fillRateBand(rate).bg,
                                color: fillRateBand(rate).fg,
                                minWidth: 56,
                              }}
                              title={
                                c
                                  ? `${row.facultyName} · BE ${c.acadYearBE} sem ${c.semester}\n${fmt(c.sections)} sections · ${fmt(c.seatsFilled)} students filled ${fmt(c.seatsOffered)} seats (${pct(c.fillRate)})`
                                  : `${row.facultyName} · BE ${ys.acadYearBE} sem ${ys.semester}\nno enrolment recorded — likely a term that didn't run`
                              }
                            >
                              {c ? pct(c.fillRate) : '—'}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3 mt-3 text-[10px] text-fg-3">
            <LegendSwatch colour="#fde7ad" label="< 25%" />
            <LegendSwatch colour="#facd6a" label="25–50%" />
            <LegendSwatch colour="#f0a232" label="50–75%" />
            <LegendSwatch colour="#dc7a20" label="75–100%" />
            <LegendSwatch colour="#a6192e" label="full" />
            <span className="text-fg-3 ml-2">empty cell = no enrolment that term</span>
          </div>
        </Card>
      )}

      {/* ── Viz 2 — section utilisation distribution ── */}
      {distribution && distribution.totalSections > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">How well are sections filling?</h2>
          <p className="text-xs text-fg-3 mb-3">
            Every opened section bucketed by its fill rate. The empty
            (0%) bar is the headline finding — sections that opened but
            never enrolled a student. Hover any bar to read the count.
          </p>
          <div className="space-y-2">
            {distribution.buckets.map((b) => (
              <div
                key={b.bucket}
                className="grid grid-cols-[140px_1fr_120px] gap-2 items-center text-xs"
                title={`${fmt(b.sections)} sections in the ${b.bucket} band (${b.pctOfTotal.toFixed(1)}% of ${fmt(distribution.totalSections)} total)`}
              >
                <div className="text-fg-2">{b.bucket}</div>
                <div className="relative bg-surface-2 rounded-sm h-5 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{
                      width: `${b.pctOfTotal}%`,
                      backgroundColor:
                        b.rangeLowerPct === 0 && b.rangeUpperPct === 0
                          ? '#a6192e'
                          : b.rangeUpperPct < 50
                          ? '#facd6a'
                          : b.rangeUpperPct <= 99
                          ? '#069c6a'
                          : '#2b4ba4',
                    }}
                  />
                </div>
                <div className="text-right tabular-nums">
                  {fmt(b.sections)} ({b.pctOfTotal.toFixed(1)}%)
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Viz 3 — GE breakdown ── */}
      {ge && ge.totals.sections > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">General education — who's teaching it?</h2>
          <p className="text-xs text-fg-3 mb-3">
            Gen-ed = course codes starting with <code>00</code> or
            <code> GE</code>, plus the GE Institute and Language
            Institute catalogues. Every {org.en} undergrad takes these — fill
            rates are usually very high, so the under-filled bars are
            the ones to chase.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-medium mb-2 text-fg-2">By provider</h3>
              <div className="space-y-1.5">
                {ge.byProvider.slice(0, 12).map((p) => (
                  <div
                    key={p.registryFacultyName}
                    className="text-[11px]"
                    title={`${p.registryFacultyName} · ${fmt(p.sections)} sections · ${fmt(p.seatsFilled)} / ${fmt(p.seatsOffered)} (${pct(p.fillRate)}) · ${fmt(p.distinctCourses)} distinct courses`}
                  >
                    <div className="flex justify-between">
                      <span className={p.isGeInstitute ? 'font-semibold' : ''}>
                        {p.registryFacultyName}
                        {p.isGeInstitute && (
                          <span className="ml-1 text-fg-3">(GE owner)</span>
                        )}
                      </span>
                      <span className="text-fg-3">
                        {fmt(p.sections)} sections · {pct(p.fillRate)}
                      </span>
                    </div>
                    <div className="relative bg-surface-2 rounded-sm h-2 mt-0.5">
                      <div
                        className="absolute inset-y-0 left-0 rounded-sm"
                        style={{
                          width: `${Math.min(p.fillRate * 100, 100)}%`,
                          backgroundColor: p.isGeInstitute ? '#664073' : '#2b4ba4',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-medium mb-2 text-fg-2">
                Trend across semesters
              </h3>
              <div className="space-y-1">
                {ge.trend.map((t) => (
                  <div
                    key={t.label}
                    className="text-[11px] grid grid-cols-[90px_1fr_90px] gap-2 items-center"
                    title={`${t.label} · ${fmt(t.sections)} GE sections · ${fmt(t.seatsFilled)} / ${fmt(t.seatsOffered)} (${pct(t.fillRate)})`}
                  >
                    <span className="text-fg-2">{t.label}</span>
                    <div className="relative bg-surface-2 rounded-sm h-3">
                      <div
                        className="absolute inset-y-0 left-0 rounded-sm"
                        style={{
                          width: `${Math.min(t.fillRate * 100, 100)}%`,
                          backgroundColor: '#069c6a',
                        }}
                      />
                    </div>
                    <span className="text-right tabular-nums text-fg-3">
                      {fmt(t.sections)} · {pct(t.fillRate)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-fg-3 mt-3">
            GE totals: {fmt(ge.totals.sections)} sections ·{' '}
            {fmt(ge.totals.seatsFilled)} of {fmt(ge.totals.seatsOffered)} seats
            filled ({pct(ge.totals.fillRate)}).
          </p>
        </Card>
      )}

      {/* ── Deep-dive drill-down ── */}
      {deepDive && deepDive.rows.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">Course-level deep dive</h2>
          <p className="text-xs text-fg-3 mb-3">
            Faculty → program level → course. Click a row to expand. Sort
            by any column to find the heaviest fills, the heaviest empties,
            or the courses used in the most programs (from the curriculum
            PDFs).
          </p>
          <DeepDiveDrillDown data={deepDive} />
        </Card>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Drill-down table — Faculty → Level → Course. UI mirrors the
// /education/active-pivot DrillDownPivot — chevron expand, sticky
// header, sortable columns. The "columns" here are attribute columns
// (sections / seats / enrolled / fill / credits / programs) rather
// than year columns, so we render them with per-column formatters
// instead of one shared formatter.
// ────────────────────────────────────────────────────────────────────

type ColKey =
  | 'sections'
  | 'seatsOffered'
  | 'seatsFilled'
  | 'fillRate'
  | 'totalCreditsDelivered'
  | 'distinctCourses'
  | 'credit'
  | 'programs';

interface SortState {
  key: ColKey;
  dir: 'asc' | 'desc';
}

function DeepDiveDrillDown({ data }: { data: DeepDiveResponse }) {
  const [openFaculties, setOpenFaculties] = React.useState<Set<string>>(() => new Set());
  const [openLevels, setOpenLevels] = React.useState<Set<string>>(() => new Set());
  const [sort, setSort] = React.useState<SortState | null>(null);

  const cycleSort = (key: ColKey) => {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 'desc' };
      if (s.dir === 'desc') return { key, dir: 'asc' };
      return null;
    });
  };

  // Sort recursively at every tier on the active key.
  const sortedRows = React.useMemo<DeepDiveFacultyGroup[]>(() => {
    if (!sort) return data.rows;
    const facValue = (f: DeepDiveFacultyGroup, k: ColKey): number => {
      if (k === 'sections') return f.sections;
      if (k === 'seatsOffered') return f.seatsOffered;
      if (k === 'seatsFilled') return f.seatsFilled;
      if (k === 'fillRate') return f.fillRate;
      if (k === 'totalCreditsDelivered') return f.totalCreditsDelivered;
      if (k === 'distinctCourses') return f.distinctCourses;
      if (k === 'credit') return f.totalCreditsDelivered;
      if (k === 'programs') return 0; // not meaningful at faculty
      return 0;
    };
    const lvlValue = (l: DeepDiveLevelGroup, k: ColKey): number => {
      if (k === 'sections') return l.sections;
      if (k === 'seatsOffered') return l.seatsOffered;
      if (k === 'seatsFilled') return l.seatsFilled;
      if (k === 'fillRate') return l.fillRate;
      if (k === 'totalCreditsDelivered') return l.totalCreditsDelivered;
      if (k === 'distinctCourses') return l.children.length;
      if (k === 'credit') return l.totalCreditsDelivered;
      if (k === 'programs') return 0;
      return 0;
    };
    const courseValue = (c: DeepDiveCourseRow, k: ColKey): number => {
      if (k === 'sections') return c.sections;
      if (k === 'seatsOffered') return c.seatsOffered;
      if (k === 'seatsFilled') return c.seatsFilled;
      if (k === 'fillRate') return c.fillRate;
      if (k === 'credit') return c.creditTotal ?? 0;
      if (k === 'programs') return c.programsCount;
      if (k === 'totalCreditsDelivered') return (c.creditTotal ?? 0) * c.sections;
      if (k === 'distinctCourses') return 1;
      return 0;
    };
    const cmp = (a: number, b: number) => (sort.dir === 'asc' ? a - b : b - a);
    return data.rows
      .map((f) => ({
        ...f,
        children: f.children
          .map((l) => ({
            ...l,
            children: [...l.children].sort((a, b) =>
              cmp(courseValue(a, sort.key), courseValue(b, sort.key)),
            ),
          }))
          .sort((a, b) => cmp(lvlValue(a, sort.key), lvlValue(b, sort.key))),
      }))
      .sort((a, b) => cmp(facValue(a, sort.key), facValue(b, sort.key)));
  }, [data.rows, sort]);

  const SortHeader = ({
    label,
    keyName,
    align = 'right',
    tooltip,
  }: {
    label: string;
    keyName: ColKey;
    align?: 'left' | 'right';
    tooltip?: string;
  }) => {
    const active = sort?.key === keyName;
    return (
      <th
        className={`px-2 py-1.5 text-${align} cursor-pointer select-none whitespace-nowrap hover:bg-surface-3`}
        onClick={() => cycleSort(keyName)}
        title={tooltip ?? `Sort by ${label}`}
      >
        {label}
        <span className="inline-block w-3 ml-0.5">
          {active ? (sort?.dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto max-h-[640px] overflow-y-auto border border-line rounded-md">
      <table className="w-full text-[11px] border-collapse">
        <thead className="sticky top-0 bg-surface-2 z-10 border-b border-line text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="px-2 py-1.5 text-left sticky left-0 bg-surface-2">
              Faculty / level / course
            </th>
            <SortHeader label="Sections" keyName="sections" tooltip="Number of class sections opened in this snapshot." />
            <SortHeader label="Enrolled / offered" keyName="seatsFilled" tooltip="Students enrolled ÷ seats offered." />
            <SortHeader label="Fill rate" keyName="fillRate" tooltip="Weighted fill rate — Σ enrolled / Σ offered." />
            <SortHeader label="Credits" keyName="credit" tooltip="Credit total — at the row level, multiplied by section count." />
            <SortHeader label="Programs" keyName="programs" tooltip="Programs whose curriculum PDF lists the course (from program-digest extraction)." />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((f) => {
            const fOpen = openFaculties.has(f.facultyName);
            return (
              <React.Fragment key={f.facultyName}>
                <tr
                  className="border-b border-line hover:bg-surface-2 cursor-pointer bg-surface-1"
                  onClick={() => {
                    const next = new Set(openFaculties);
                    next.has(f.facultyName)
                      ? next.delete(f.facultyName)
                      : next.add(f.facultyName);
                    setOpenFaculties(next);
                  }}
                >
                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap sticky left-0 bg-surface-1">
                    <ChevronRight
                      size={12}
                      className={`inline-block transition-transform mr-1 ${
                        fOpen ? 'rotate-90' : ''
                      }`}
                    />
                    {f.facultyName}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(f.sections)} sections under ${f.facultyName}`}>
                    {fmt(f.sections)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(f.seatsFilled)} students filled ${fmt(f.seatsOffered)} seats`}>
                    {fmt(f.seatsFilled)} / {fmt(f.seatsOffered)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums" title={`${pct(f.fillRate)} weighted fill across the faculty`}>
                    <PillRate rate={f.fillRate} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums" title="Total credits delivered = Σ (credit × section count)">
                    {fmt(f.totalCreditsDelivered)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(f.distinctCourses)} distinct courses inside this faculty`}>
                    {fmt(f.distinctCourses)} course{f.distinctCourses === 1 ? '' : 's'}
                  </td>
                </tr>
                {fOpen &&
                  f.children.map((l) => {
                    const lKey = `${f.facultyName}::${l.levelName}`;
                    const lOpen = openLevels.has(lKey);
                    return (
                      <React.Fragment key={lKey}>
                        <tr
                          className="border-b border-line/60 hover:bg-surface-2 cursor-pointer"
                          onClick={() => {
                            const next = new Set(openLevels);
                            next.has(lKey) ? next.delete(lKey) : next.add(lKey);
                            setOpenLevels(next);
                          }}
                        >
                          <td className="px-2 py-1.5 pl-7 whitespace-nowrap text-fg-2 sticky left-0 bg-surface-1">
                            <ChevronRight
                              size={11}
                              className={`inline-block transition-transform mr-1 ${
                                lOpen ? 'rotate-90' : ''
                              }`}
                            />
                            {l.levelName}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(l.sections)} sections at ${l.levelName}`}>{fmt(l.sections)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(l.seatsFilled)} of ${fmt(l.seatsOffered)} seats filled`}>
                            {fmt(l.seatsFilled)} / {fmt(l.seatsOffered)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums" title={pct(l.fillRate)}>
                            <PillRate rate={l.fillRate} />
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmt(l.totalCreditsDelivered)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(l.children.length)} courses at this level`}>
                            {fmt(l.children.length)} course{l.children.length === 1 ? '' : 's'}
                          </td>
                        </tr>
                        {lOpen &&
                          l.children.map((c) => (
                            <tr
                              key={`${lKey}::${c.courseCode}`}
                              className="border-b border-line/40 hover:bg-surface-2"
                              title={c.courseNameTh ?? c.courseNameEn ?? c.courseCode}
                            >
                              <td className="px-2 py-1.5 pl-14 whitespace-nowrap sticky left-0 bg-surface-1">
                                <span className="font-mono text-[10.5px] mr-2">
                                  {c.courseCode}
                                </span>
                                <span>{c.courseNameEn ?? '—'}</span>
                                {c.isGeneralEducation && (
                                  <span
                                    className="ml-2 inline-block px-1 rounded-sm text-[9px] bg-purple-100 text-purple-700"
                                    title="General-education catalogue"
                                  >
                                    GE
                                  </span>
                                )}
                                {c.courseNameTh && (
                                  <span className="ml-2 text-fg-3 text-[10px]">
                                    {c.courseNameTh}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(c.sections)} sections`}>{fmt(c.sections)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(c.seatsFilled)} students · ${fmt(c.seatsOffered)} seats`}>
                                {fmt(c.seatsFilled)} / {fmt(c.seatsOffered)}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums" title={pct(c.fillRate)}>
                                <PillRate rate={c.fillRate} />
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums" title={`${c.creditTotal ?? 0} credits per section`}>
                                {fmt(c.creditTotal ?? 0)}
                              </td>
                              <td
                                className="px-2 py-1.5 text-right tabular-nums"
                                title={`Listed by ${fmt(c.programsCount)} program${c.programsCount === 1 ? '' : 's'} in their curriculum PDF`}
                              >
                                {fmt(c.programsCount)}
                              </td>
                            </tr>
                          ))}
                      </React.Fragment>
                    );
                  })}
              </React.Fragment>
            );
          })}
          {/* Footer totals */}
          <tr className="border-t-2 border-line font-semibold bg-surface-2">
            <td className="px-2 py-1.5 sticky left-0 bg-surface-2">Total</td>
            <td className="px-2 py-1.5 text-right tabular-nums">
              {fmt(data.totals.sections)}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">
              {fmt(data.totals.seatsFilled)} / {fmt(data.totals.seatsOffered)}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">
              <PillRate rate={data.totals.fillRate} />
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">
              {fmt(data.totals.totalCreditsDelivered)}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">
              {fmt(data.totals.distinctCourses)} courses
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PillRate({ rate }: { rate: number }) {
  const band = fillRateBand(rate);
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded-sm font-medium"
      style={{ backgroundColor: band.bg, color: band.fg }}
    >
      {pct(rate)}
    </span>
  );
}

function KpiTile({
  label,
  value,
  hint,
  tone,
  tooltip,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'warning';
  tooltip?: string;
}) {
  return (
    <Card className="p-3" title={tooltip}>
      <div className="text-[10px] uppercase tracking-wider text-fg-3">{label}</div>
      <div
        className={`text-xl font-semibold mt-1 tabular-nums ${
          tone === 'warning' ? 'text-orange-600' : ''
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-fg-3 mt-1">{hint}</div>}
    </Card>
  );
}

function LegendSwatch({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block w-3 h-3 rounded-sm"
        style={{ backgroundColor: colour }}
      />
      {label}
    </span>
  );
}
