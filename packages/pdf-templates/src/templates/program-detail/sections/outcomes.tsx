import * as React from 'react';

import { LineTrend, type TrendPoint } from '../../../charts';
import { formatCompactNumber, formatPct } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — Outcomes. `salaryTrajectory` runs into the millions-of-THB range
// across the full salary-scale y-axis in some faculties, so `formatTick`
// (the precedent LineTrend.formatTick already set in batch 1) is required
// here, not optional — the same failure this whole batch exists to fix
// (a raw '3500000' tick) would otherwise reappear on this axis specifically.
//
// The four named numeric fields Task 2 added (employmentRatePct,
// averageSalary, jobRelevanceScorePct, furtherStudyRatePct) are headline
// KPIs, not trajectory points — they render as a `.stat-block` row (the
// same primitive the cover page uses for its three headline stats), never
// re-derived from `salaryTrajectory` or from the display-only `summary`
// KV rows (see schema.ts's header comment: `summary`'s `value` is text,
// never parsed back into a number).
const LEDE_TH =
  'เส้นแนวโน้มนี้แสดงเงินเดือนเริ่มต้นเฉลี่ยของบัณฑิตแยกตามปีที่สำเร็จการศึกษา ' +
  'จากผลสำรวจภาวะการมีงานทำของบัณฑิต';

function statValueClass(isNull: boolean): string {
  return isNull ? 'stat-value muted' : 'stat-value';
}

export function renderOutcomesSection(data: ProgramDetailData): React.ReactElement | null {
  const { outcomes } = data;
  if (!outcomes) return null;

  const points: TrendPoint[] = outcomes.salaryTrajectory
    .filter((p): p is typeof p & { year: number } => p.year !== null)
    .map((p) => ({ x: p.year, y: p.salary }));

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Graduate outcomes</span>
          <h2 className="section-title">Outcomes</h2>
        </div>
      </div>

      <div className="stat-block">
        <div className="stat" data-stat="employment-rate">
          <span className={statValueClass(outcomes.employmentRatePct === null)}>
            {formatPct(outcomes.employmentRatePct)}
          </span>
          <span className="stat-label">Employment rate</span>
        </div>
        <div className="stat" data-stat="average-salary">
          <span className={statValueClass(outcomes.averageSalary === null)}>
            {formatCompactNumber(outcomes.averageSalary)}
          </span>
          <span className="stat-label">Average starting salary (THB / mo)</span>
        </div>
        <div className="stat" data-stat="job-relevance">
          <span className={statValueClass(outcomes.jobRelevanceScorePct === null)}>
            {formatPct(outcomes.jobRelevanceScorePct)}
          </span>
          <span className="stat-label">Job matches field of study</span>
        </div>
        <div className="stat" data-stat="further-study">
          <span className={statValueClass(outcomes.furtherStudyRatePct === null)}>
            {formatPct(outcomes.furtherStudyRatePct)}
          </span>
          <span className="stat-label">Further study</span>
        </div>
      </div>

      <LineTrend
        title="Average starting salary by graduation year (THB / month)"
        ledeTh={LEDE_TH}
        points={points}
        formatTick={formatCompactNumber}
        plotHeightMm={55}
        leftGutterMm={20}
        emptyNote="No salary trajectory recorded — run pnpm outcomes:ingest-xlsx to populate graduate-employment-survey data."
        provenance={{
          source: 'graduate-employment-survey',
          runDate: data.dateLabel,
          method: outcomes.methodologyVersion,
        }}
      />
    </section>
  );
}
