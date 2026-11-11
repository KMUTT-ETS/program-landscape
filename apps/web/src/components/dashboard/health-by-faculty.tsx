'use client';

import * as React from 'react';
import Link from 'next/link';
import { useChartPalette } from '@kku/ui';

interface FacultyHealthRow {
  /** Stable id for the row's drill-in target; meaning depends on
   *  `scopeLevel` — faculty.id, department.id, or program.id. */
  facultyId: string;
  /** What kind of entity this row represents — drives the link href. */
  scopeLevel: 'faculty' | 'department' | 'program';
  scopeLabel: string;
  overallScore: number | null;
  dataCompletenessPct: number;
  dimensions: {
    attractiveness: number | null;
    financial: number | null;
    capability: number | null;
    outcomes: number | null;
    relevance: number | null;
  };
}

interface Props {
  rows: FacultyHealthRow[];
  methodologyVersion: string;
}

// Faculty-level health rollup. One row per academic faculty:
//   - Faculty name (clickable → /cockpit?scope=faculty)
//   - Overall score badge (colour-coded by band)
//   - Five-dimension micro-strip (attractiveness / financial /
//     capability / outcomes / relevance) — each cell is a 0-100 bar
//     so analysts can see WHICH dimension is dragging without leaving
//     the page.
//   - Data-completeness pill (% of dimensions with usable data)
//
// Sorted descending by overall score; nulls sink to the bottom.

const DIMENSION_ORDER = [
  { key: 'attractiveness', label: 'Attr' },
  { key: 'financial', label: 'Fin' },
  { key: 'capability', label: 'Cap' },
  { key: 'outcomes', label: 'Out' },
  { key: 'relevance', label: 'Rel' },
] as const;

// Deliberate exception to the shared health zones (@kku/shared/health/zones,
// < 40 danger / 40–65 needs attention / ≥ 65 healthy): this dashboard bands
// "fair" from 45, so a score of 40–44 reads "poor" here but "needs
// attention" in the cockpit. Kept by owner decision on 2026-11-11; switch to
// healthZone() if the two should agree.
function band(score: number | null): 'good' | 'fair' | 'poor' | 'unknown' {
  if (score === null) return 'unknown';
  if (score >= 65) return 'good';
  if (score >= 45) return 'fair';
  return 'poor';
}

export function HealthByFaculty({ rows, methodologyVersion }: Props) {
  const palette = useChartPalette();

  const bandTone: Record<'good' | 'fair' | 'poor' | 'unknown', string> = {
    good: palette.positive,
    fair: palette.series[2] ?? palette.neutral,
    poor: palette.negative,
    unknown: palette.neutral,
  };

  if (rows.length === 0) {
    return (
      <p className="text-[11px] text-text-tertiary">
        No faculty health rollup available — check that <code className="rounded bg-surface-2 px-1">computeHealthScores</code> is wired.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Column header — only visible on md+ to keep mobile list dense. */}
      <div className="hidden grid-cols-[minmax(0,1.6fr)_56px_minmax(0,1.4fr)_64px] gap-2 px-1 text-[10px] uppercase tracking-wide text-text-tertiary md:grid">
        <span>Faculty</span>
        <span className="text-right">Overall</span>
        <span>Attr · Fin · Cap · Out · Rel</span>
        <span className="text-right">Coverage</span>
      </div>

      <ul className="flex flex-col">
        {rows.map((row) => {
          const overallBand = band(row.overallScore);
          const tone = bandTone[overallBand];
          return (
            <li
              key={row.facultyId}
              className="grid grid-cols-1 gap-2 border-t border-border-subtle py-2 first:border-t-0 md:grid-cols-[minmax(0,1.6fr)_56px_minmax(0,1.4fr)_64px] md:items-center"
            >
              <Link
                href={
                  row.scopeLevel === 'program'
                    ? `/programs/${row.facultyId}`
                    : `/cockpit?scope=${row.scopeLevel}&scopeId=${row.facultyId}`
                }
                className="truncate text-[12px] text-text-primary hover:text-accent-default hover:underline"
                title={row.scopeLabel}
              >
                {row.scopeLabel}
              </Link>
              <span
                className="inline-flex items-center justify-end gap-1.5 text-right md:justify-end"
                title={`Overall score · ${overallBand}`}
              >
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tone }}
                />
                <span className="font-tabular text-[12px] font-semibold text-text-primary">
                  {row.overallScore === null ? '—' : row.overallScore.toFixed(0)}
                </span>
              </span>
              <DimensionStrip
                dims={row.dimensions}
                bandTone={bandTone}
              />
              <span className="font-tabular text-right text-[10.5px] text-text-tertiary">
                {row.dataCompletenessPct.toFixed(0)}%
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[10px] text-text-tertiary opacity-70">
        Methodology <span className="font-tabular text-text-secondary">{methodologyVersion}</span>{' '}
        · 0–100 per dimension; <span className="font-tabular">—</span> = no data; click any row → Cockpit
      </p>
    </div>
  );
}

function DimensionStrip({
  dims,
  bandTone,
}: {
  dims: FacultyHealthRow['dimensions'];
  bandTone: Record<'good' | 'fair' | 'poor' | 'unknown', string>;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {DIMENSION_ORDER.map(({ key, label }) => {
        const score = dims[key];
        const b = band(score);
        return (
          <div
            key={key}
            className="flex flex-1 flex-col items-center gap-0.5"
            title={`${label}: ${score === null ? 'no data' : score.toFixed(0)}`}
          >
            <span className="text-[9px] uppercase text-text-tertiary opacity-70">
              {label}
            </span>
            <div className="h-1 w-full overflow-hidden rounded-sm bg-surface-2">
              {score !== null && (
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(2, Math.min(100, score))}%`,
                    backgroundColor: bandTone[b],
                    opacity: 0.85,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
