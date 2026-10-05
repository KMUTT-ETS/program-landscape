'use client';

import * as React from 'react';
import { useChartPalette } from '@kku/ui';

interface LevelMixRow {
  level: string;
  programCount: number;
  enrollmentLatest: number;
}

interface Props {
  rows: LevelMixRow[];
}

const LEVEL_LABEL: Record<string, string> = {
  BACHELOR: "Bachelor's",
  MASTER: "Master's",
  DOCTORAL: 'Doctoral',
  HIGHER_GRAD_DIPLOMA: 'Higher Grad Diploma',
};

// Stacked bar showing degree-level composition. Two stacks side-by-
// side: program count vs latest-intake volume — they tell a story when
// they diverge (e.g., 70 PhDs but only 96 students = 1.4 per
// program).
export function LevelMix({ rows }: Props) {
  const palette = useChartPalette();
  const programTotal = rows.reduce((s, r) => s + r.programCount, 0);
  const enrolTotal = rows.reduce((s, r) => s + r.enrollmentLatest, 0);

  const series = rows.map((r, i) => ({
    label: LEVEL_LABEL[r.level] ?? r.level,
    code: r.level,
    programs: r.programCount,
    students: r.enrollmentLatest,
    perProgram: r.programCount > 0 ? r.enrollmentLatest / r.programCount : 0,
    // Fallback to a neutral chart token when palette.series[i] is somehow
    // undefined. Resolved at runtime via useChartPalette so it tracks
    // theme; the wrapping `oklch(var(...))` is an allowed design-token
    // form (see packages/design ESLint rule).
    color: palette.series[i % palette.series.length] ?? 'oklch(var(--color-text-tertiary))',
  }));

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <StackedBar
        title={`Programs · ${programTotal}`}
        items={series.map((s) => ({ label: s.label, value: s.programs, color: s.color }))}
      />
      <StackedBar
        title={`Latest intake · ${enrolTotal.toLocaleString('en-US')}`}
        items={series.map((s) => ({ label: s.label, value: s.students, color: s.color }))}
      />
      <div className="md:col-span-2">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-text-tertiary">
              <th className="pb-1 font-normal">Level</th>
              <th className="pb-1 text-right font-normal">Programs</th>
              <th className="pb-1 text-right font-normal">Latest intake</th>
              <th className="pb-1 text-right font-normal">Avg / program</th>
              <th className="pb-1 text-right font-normal">Implication</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.code} className="border-t border-subtle">
                <td className="py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                </td>
                <td className="py-1.5 text-right font-tabular">{s.programs}</td>
                <td className="py-1.5 text-right font-tabular">{s.students.toLocaleString('en-US')}</td>
                <td className="py-1.5 text-right font-tabular">{s.perProgram.toFixed(1)}</td>
                <td className="py-1.5 text-right text-text-tertiary">
                  {s.perProgram < 5
                    ? 'Severe under-enrolment'
                    : s.perProgram < 15
                      ? 'Thin cohorts'
                      : 'Healthy scale'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StackedBar({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number; color: string }[];
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-text-tertiary">{title}</p>
      <div className="flex h-7 w-full overflow-hidden rounded">
        {items.map((it, i) => {
          const pct = total > 0 ? (it.value / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={i}
              style={{ width: `${pct}%`, backgroundColor: it.color, opacity: 0.85 }}
              title={`${it.label}: ${it.value.toLocaleString('en-US')} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-tertiary">
        {items.map((it, i) => {
          const pct = total > 0 ? (it.value / total) * 100 : 0;
          return (
            <span key={i} className="font-tabular">
              {it.label}: {pct.toFixed(0)}%
            </span>
          );
        })}
      </div>
    </div>
  );
}
