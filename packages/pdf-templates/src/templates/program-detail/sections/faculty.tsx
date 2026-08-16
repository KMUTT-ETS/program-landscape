import * as React from 'react';

import { BarsH, type BarRow } from '../../../charts';
import { formatCount, formatPct } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — Faculty capability. Reads ONLY `faculty.rankDistribution` (rank +
// headcount + share, never a name) and the three aggregate companions
// (`seniorRankCount` / `totalRankedCount` / `seniorRankSharePct`). This is
// deliberate, not incidental: under `COUNCIL` visibility, member names are
// stripped upstream at the Prisma `select` layer (see program-deep-dive.ts
// / this schema's FacultySchema comment on `roster[].name`), and this
// component must not introduce a new path that could print one even when
// a name IS present in the payload (e.g. under `full detail` visibility).
// `faculty.roster` is never imported here for exactly that reason — Task 8
// adds the redaction test across the whole template; this section's job
// is to not give that test anything to catch.
const LEDE_TH =
  'แผนภูมินี้แสดงจำนวนอาจารย์ประจำหลักสูตรแยกตามตำแหน่งทางวิชาการ ' +
  'สะท้อนความพร้อมด้านบุคลากรและโครงสร้างอาวุโสของหลักสูตร';

function statValueClass(isNull: boolean): string {
  return isNull ? 'stat-value muted' : 'stat-value';
}

export function renderFacultySection(data: ProgramDetailData): React.ReactElement | null {
  const { faculty } = data;
  if (!faculty) return null;

  const rows: BarRow[] = faculty.rankDistribution
    .filter((r): r is typeof r & { count: number } => r.count !== null)
    .map((r) => ({ label: r.rank, value: r.count }));

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Institutional capacity</span>
          <h2 className="section-title">Faculty capability</h2>
        </div>
      </div>

      <div className="stat-block">
        <div className="stat" data-stat="senior-count">
          <span className={statValueClass(faculty.seniorRankCount === null)}>
            {formatCount(faculty.seniorRankCount)}
          </span>
          <span className="stat-label">Senior faculty (Prof + Assoc Prof)</span>
        </div>
        <div className="stat" data-stat="total-ranked">
          <span className={statValueClass(faculty.totalRankedCount === null)}>
            {formatCount(faculty.totalRankedCount)}
          </span>
          <span className="stat-label">Total ranked faculty</span>
        </div>
        <div className="stat" data-stat="senior-share">
          <span className={statValueClass(faculty.seniorRankSharePct === null)}>
            {formatPct(faculty.seniorRankSharePct)}
          </span>
          <span className="stat-label">Senior share</span>
        </div>
      </div>

      <BarsH
        title="Academic rank distribution"
        ledeTh={LEDE_TH}
        rows={rows}
        labelWidthMm={55}
        rowHeightMm={12}
        formatValue={formatCount}
        emptyNote="No faculty rank data — run the kku-hr connector to link FacultyMember rows to this program."
        provenance={{
          source: 'kku-hr',
          runDate: data.dateLabel,
          method: `roster scope: ${faculty.rosterScope} · visibility: ${faculty.visibility}`,
        }}
      />
    </section>
  );
}
