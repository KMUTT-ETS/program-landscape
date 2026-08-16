import * as React from 'react';

import { BarsStacked, type StackedCategory } from '../../../charts';
import type { ProgramDetailData } from '../schema';

// §4 — Cohort distribution. `cohortDistribution.rows` is one row PER ENTRY
// YEAR (student_cohort_distributions is unique on (programId, entryYearBE)
// — see the schema comment on that model) — each row already carries a
// single computed `status` for its whole entry-year cohort, not a
// breakdown across statuses within the year. BarsStacked's own contract
// (see bars-stacked.tsx's buildLegend) requires every category to define
// the SAME segment labels at the SAME index, zero-filling rather than
// omitting one that doesn't apply — so each entry year here becomes a
// 3-segment stack (Incoming / On track / Delayed) with only the one
// matching its real status non-zero. That keeps colour and legend
// consistent across bars even though, today, every bar only lights up one
// segment.
const STATUSES = ['Incoming', 'On track', 'Delayed'] as const;

const LEDE_TH =
  'แผนภูมินี้แสดงจำนวนนักศึกษาปัจจุบันจำแนกตามปีที่เข้าศึกษาและสถานะความก้าวหน้า ' +
  '(เข้าใหม่ / ตามแผน / ล่าช้า)';

function buildCategories(
  rows: NonNullable<ProgramDetailData['cohortDistribution']>['rows'],
): StackedCategory[] {
  const byYear = new Map<number, Map<string, number>>();
  for (const row of rows) {
    if (row.cohortBE === null || row.students === null) continue;
    const statusTotals = byYear.get(row.cohortBE) ?? new Map<string, number>();
    statusTotals.set(row.status, (statusTotals.get(row.status) ?? 0) + row.students);
    byYear.set(row.cohortBE, statusTotals);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, statusTotals]) => ({
      category: String(year),
      segments: STATUSES.map((label) => ({ label, value: statusTotals.get(label) ?? 0 })),
    }));
}

export function renderCohortDistributionSection(data: ProgramDetailData): React.ReactElement | null {
  const { cohortDistribution } = data;
  if (!cohortDistribution) return null;

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Student population</span>
          <h2 className="section-title">Cohort distribution</h2>
        </div>
      </div>
      <BarsStacked
        title="Active students by entry year"
        ledeTh={LEDE_TH}
        categories={buildCategories(cohortDistribution.rows)}
        plotHeightMm={60}
        columnWidthMm={18}
        emptyNote="No cohort data — run pnpm programs:link-cohorts to populate from registrar data."
        provenance={{
          source: 'kku-registry',
          table: 'student_cohort_distributions',
          runDate: data.dateLabel,
          method: 'kku-registry cohort tally (raw counts, no scoring methodology)',
        }}
      />
    </section>
  );
}
