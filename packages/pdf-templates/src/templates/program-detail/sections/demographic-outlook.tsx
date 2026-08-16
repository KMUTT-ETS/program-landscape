import * as React from 'react';

import { LineTrend, type TrendPoint } from '../../../charts';
import { formatCompactNumber } from '../format';
import type { ProgramDetailData } from '../schema';

// §5 — Demographic outlook. Cohort population runs in the millions —
// exactly the case the `formatTick` fix earlier in this batch exists for
// (a raw '3982000' tick is unreadable on a printed axis). Years at/after
// the current-year anchor are forward NESDC population projections, not
// observed history, so they render as LineTrend's dashed "projected"
// segment — the same "hollow/dashed = not an observation" vocabulary the
// primitive already uses elsewhere in this library.
const LEDE_TH =
  'เส้นแนวโน้มนี้แสดงจำนวนประชากรกลุ่มอายุที่เป็นฐานผู้สมัครของหลักสูตรในอนาคต ' +
  'สะท้อนเพดานด้านประชากรศาสตร์ของประเทศไทยต่อหลักสูตรนี้';

export function renderDemographicOutlookSection(data: ProgramDetailData): React.ReactElement | null {
  const { demographic } = data;
  if (!demographic) return null;

  // TrendPoint.x is a plain, non-nullable `number` — a projection row with
  // no year at all cannot be plotted and is excluded outright (distinct
  // from a null cohortPopulation, which LineTrend already renders as a
  // hollow on-axis "not observed" marker via TrendPoint.y).
  const points: TrendPoint[] = demographic.projections
    .filter((p): p is typeof p & { year: number } => p.year !== null)
    .map((p) => ({ x: p.year, y: p.cohortPopulation }));

  const projectedFrom = demographic.projections.find((p) => p.isCurrentYear)?.year ?? undefined;

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Demographic ceiling</span>
          <h2 className="section-title">Demographic outlook</h2>
        </div>
      </div>
      <LineTrend
        title={`Age-cohort (${demographic.ageCohort}) population projection, ${demographic.catchment}`}
        ledeTh={LEDE_TH}
        points={points}
        projectedFrom={projectedFrom}
        formatTick={formatCompactNumber}
        plotHeightMm={60}
        leftGutterMm={18}
        emptyNote="No demographic projection — run pnpm demographics:seed to populate NESDC population projections."
        provenance={{
          source: demographic.source,
          runDate: data.dateLabel,
          method: 'NESDC population projection (raw series, no scoring methodology)',
        }}
      />
    </section>
  );
}
