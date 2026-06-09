'use client';

import * as React from 'react';
import { Card, Section, useChartPalette } from '@kku/ui';
import type { FacultyGpaTrendResponse, FacultyGpaTrendCell } from '../types';

// University-vs-faculty class-GPA trend. X = academic year (BE), Y = credit-
// weighted class GPA. One line per faculty + a distinguished university line.
// Click a legend chip to show/hide that line.

const UNIVERSITY_KEY = '__university__';

export function FacultyGpaTrendSection({ data }: { data: FacultyGpaTrendResponse }) {
  return (
    <Section title="Average GPA by year — University vs faculty">
      <Card padding="md">
        <p className="mb-3 text-xs text-text-tertiary">
          Credit-weighted class GPA (KKU 4.0 scale) per academic year, straight from the registrar&apos;s
          graded class offerings — grouped by the faculty that teaches the course, with no course-to-program
          mapping. The bold dark line is the university overall; each coloured line is a faculty. Click a name
          in the legend to show or hide it. The current in-progress academic year is excluded until enough of
          its classes are graded to be representative.
        </p>
        <FacultyGpaTrendChart data={data} />
      </Card>
    </Section>
  );
}

function gpaFmt(v: number | null): string {
  return v === null ? '—' : v.toFixed(2);
}

function FacultyGpaTrendChart({ data }: { data: FacultyGpaTrendResponse }) {
  const palette = useChartPalette();
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set());
  const [hoverYear, setHoverYear] = React.useState<number | null>(null);

  const years = data.yearsObserved;
  if (years.length === 0) {
    return <p className="text-sm text-text-tertiary">No graded class data yet.</p>;
  }

  // Stable colour per faculty (sorted order from the API).
  const facultyColor = (i: number) => palette.series[i % palette.series.length] ?? palette.text;

  const toggle = (key: string) =>
    setHidden((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const setAllFaculties = (hide: boolean) =>
    setHidden(() => (hide ? new Set(data.faculties.map((f) => f.facultyName)) : new Set()));

  const uniVisible = !hidden.has(UNIVERSITY_KEY);
  const visibleFaculties = data.faculties.filter((f) => !hidden.has(f.facultyName));

  // Y domain from EVERY series (stable across toggles), padded + clamped 0–4.
  let dataMin = Infinity;
  let dataMax = -Infinity;
  const scan = (cells: Record<string, FacultyGpaTrendCell>) => {
    for (const y of years) {
      const v = cells[String(y)]?.averageClassGpa;
      if (v != null) {
        if (v < dataMin) dataMin = v;
        if (v > dataMax) dataMax = v;
      }
    }
  };
  scan(data.university);
  data.faculties.forEach((f) => scan(f.byYear));
  if (!Number.isFinite(dataMin)) { dataMin = 0; dataMax = 4; }
  const yMin = Math.max(0, Math.floor((dataMin - 0.15) * 10) / 10);
  const yMax = Math.min(4, Math.ceil((dataMax + 0.15) * 10) / 10);
  const ySpan = yMax - yMin || 1;

  const W = 720, H = 320;
  const PAD = { top: 14, right: 16, bottom: 34, left: 42 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const xMin = years[0]!, xMax = years[years.length - 1]!;
  const xPx = (y: number) => PAD.left + (xMax === xMin ? innerW / 2 : ((y - xMin) / (xMax - xMin)) * innerW);
  const yPx = (v: number) => PAD.top + (1 - (v - yMin) / ySpan) * innerH;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + t * ySpan);

  // Build segmented polylines (break at missing years) for a series.
  const segments = (cells: Record<string, FacultyGpaTrendCell>): string[] => {
    const segs: string[] = [];
    let cur: string[] = [];
    for (const y of years) {
      const v = cells[String(y)]?.averageClassGpa;
      if (v == null) {
        if (cur.length) { segs.push(cur.join(' ')); cur = []; }
        continue;
      }
      cur.push(`${xPx(y)},${yPx(v)}`);
    }
    if (cur.length) segs.push(cur.join(' '));
    return segs;
  };

  const hoverFrac = hoverYear != null ? xPx(hoverYear) / W : 0;
  const hoverAnchor = hoverFrac < 0.34 ? '0' : hoverFrac > 0.66 ? '-100%' : '-50%';

  // Tooltip rows for the hovered year — visible series, sorted by GPA desc.
  const hoverRows =
    hoverYear == null
      ? []
      : visibleFaculties
          .map((f) => ({ name: f.facultyName, gpa: f.byYear[String(hoverYear)]?.averageClassGpa ?? null }))
          .filter((r) => r.gpa != null)
          .sort((a, b) => (b.gpa ?? 0) - (a.gpa ?? 0));
  const hoverUni = hoverYear == null ? null : data.university[String(hoverYear)]?.averageClassGpa ?? null;

  return (
    <div>
      {/* Legend / toggles */}
      <div className="mb-2 flex items-center gap-2 text-[11px]">
        <button type="button" onClick={() => setAllFaculties(false)} className="rounded-sm border border-border-subtle px-1.5 py-0.5 hover:bg-surface-1">Show all</button>
        <button type="button" onClick={() => setAllFaculties(true)} className="rounded-sm border border-border-subtle px-1.5 py-0.5 hover:bg-surface-1">Hide faculties</button>
        <span className="text-text-tertiary">{visibleFaculties.length}/{data.faculties.length} faculties shown</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => toggle(UNIVERSITY_KEY)}
          aria-pressed={uniVisible}
          className={`flex items-center gap-1.5 text-[11px] font-semibold transition-opacity ${uniVisible ? '' : 'opacity-40'}`}
        >
          <svg width="18" height="8" aria-hidden className="shrink-0"><line x1="0" y1="4" x2="16" y2="4" stroke={palette.text} strokeWidth={3} /></svg>
          <span className={uniVisible ? '' : 'line-through'}>University</span>
        </button>
        {data.faculties.map((f, i) => {
          const off = hidden.has(f.facultyName);
          return (
            <button
              key={f.facultyName}
              type="button"
              onClick={() => toggle(f.facultyName)}
              aria-pressed={!off}
              title={`${f.facultyName} · overall ${gpaFmt(f.overall.averageClassGpa)}`}
              className={`flex items-center gap-1.5 text-[11px] transition-opacity hover:opacity-80 ${off ? 'opacity-40' : ''}`}
            >
              <svg width="16" height="8" aria-hidden className="shrink-0"><line x1="0" y1="4" x2="14" y2="4" stroke={facultyColor(i)} strokeWidth={2} /></svg>
              <span className={off ? 'line-through' : ''} lang="th">{f.facultyName}</span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Average GPA trend by faculty">
          {/* gridlines + y labels */}
          {ticks.map((v, i) => (
            <g key={`g${i}`}>
              <line x1={PAD.left} y1={yPx(v)} x2={W - PAD.right} y2={yPx(v)} stroke={palette.grid} strokeDasharray="2 4" strokeWidth={0.6} />
              <text x={PAD.left - 6} y={yPx(v) + 4} textAnchor="end" className="text-[10px] font-tabular" fill={palette.text} opacity={0.7}>{v.toFixed(2)}</text>
            </g>
          ))}
          {/* x labels + hover guide */}
          {hoverYear != null && (
            <line x1={xPx(hoverYear)} y1={PAD.top} x2={xPx(hoverYear)} y2={PAD.top + innerH} stroke={palette.text} strokeWidth={1} opacity={0.25} />
          )}
          {years.map((y) => (
            <text key={`x${y}`} x={xPx(y)} y={H - PAD.bottom + 16} textAnchor="middle" className="text-[10px] font-tabular" fill={palette.text} opacity={hoverYear === y ? 1 : 0.7}>BE {y}</text>
          ))}

          {/* faculty lines (drawn first, under the university line) */}
          {data.faculties.map((f, i) => {
            if (hidden.has(f.facultyName)) return null;
            const col = facultyColor(i);
            return segments(f.byYear).map((pts, si) => (
              <polyline key={`f${i}-${si}`} points={pts} fill="none" stroke={col} strokeWidth={1.5} opacity={0.85} />
            ));
          })}
          {/* faculty dots */}
          {data.faculties.map((f, i) => {
            if (hidden.has(f.facultyName)) return null;
            const col = facultyColor(i);
            return years.map((y) => {
              const v = f.byYear[String(y)]?.averageClassGpa;
              if (v == null) return null;
              return <circle key={`fd${i}-${y}`} cx={xPx(y)} cy={yPx(v)} r={hoverYear === y ? 2.8 : 2} fill={col} opacity={0.85} />;
            });
          })}

          {/* university line — drawn last, on top, distinguished */}
          {uniVisible && segments(data.university).map((pts, si) => (
            <polyline key={`u${si}`} points={pts} fill="none" stroke={palette.text} strokeWidth={3} />
          ))}
          {uniVisible && years.map((y) => {
            const v = data.university[String(y)]?.averageClassGpa;
            if (v == null) return null;
            return <circle key={`ud${y}`} cx={xPx(y)} cy={yPx(v)} r={hoverYear === y ? 4 : 3} fill={palette.text} />;
          })}

          {/* hover bands */}
          {years.map((y, i) => {
            const prevX = i === 0 ? PAD.left : (xPx(years[i - 1]!) + xPx(y)) / 2;
            const nextX = i === years.length - 1 ? W - PAD.right : (xPx(y) + xPx(years[i + 1]!)) / 2;
            return (
              <rect
                key={`hb${y}`}
                x={prevX}
                y={PAD.top}
                width={Math.max(0, nextX - prevX)}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverYear(y)}
                onMouseLeave={() => setHoverYear((cur) => (cur === y ? null : cur))}
              />
            );
          })}
        </svg>

        {/* hover tooltip */}
        {hoverYear != null && (
          <div
            className="pointer-events-none absolute top-1 z-10 max-h-[15rem] w-max max-w-[18rem] overflow-hidden rounded-md border border-border-subtle bg-surface-1 p-2 shadow-md"
            style={{ left: `${hoverFrac * 100}%`, transform: `translateX(${hoverAnchor})` }}
          >
            <div className="mb-1 text-[11px] font-semibold">
              BE {hoverYear} <span className="font-normal text-text-tertiary">(CE {hoverYear - 543})</span>
            </div>
            {uniVisible && (
              <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                <span className="inline-block h-1.5 w-3 shrink-0" style={{ background: palette.text }} />
                <span>University</span>
                <span className="ml-auto font-tabular">{gpaFmt(hoverUni)}</span>
              </div>
            )}
            <div className="mt-1 flex flex-col gap-0.5">
              {hoverRows.slice(0, 12).map((r) => {
                const idx = data.faculties.findIndex((f) => f.facultyName === r.name);
                return (
                  <div key={r.name} className="flex items-center gap-1.5 text-[10px]">
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: facultyColor(idx) }} />
                    <span className="truncate text-text-secondary" lang="th">{r.name}</span>
                    <span className="ml-auto font-tabular">{gpaFmt(r.gpa)}</span>
                  </div>
                );
              })}
              {hoverRows.length > 12 && (
                <div className="text-[10px] text-text-tertiary">+{hoverRows.length - 12} more</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
