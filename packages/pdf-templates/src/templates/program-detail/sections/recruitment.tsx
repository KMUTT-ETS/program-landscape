import * as React from 'react';

import { BarsStacked, type StackedCategory } from '../../../charts';
import type { ProgramDetailData } from '../schema';

// §? — Recruitment (TCAS rounds). `recruitment.latestRounds` is the most
// recent admission cycle's per-round breakdown — the literal "TCAS rounds
// 1-4" this section covers. Each round's allocated seats (`seats`) and its
// actually-reported/registered headcount (`reported`) are genuinely
// additive: Reported + Unfilled = Seats. Unfilled is floored at 0 rather
// than allowed to go negative — a round whose reported count MEETS OR
// EXCEEDS its own seat allocation (a real over-fill, not a data bug; see
// KKU-SEQ-0065's round 3 in the real fixture) simply has zero unfilled
// seats, which is exactly what happened. Flooring never shrinks the
// Reported segment itself, so the over-fill stays fully visible in the
// bar's own height — nothing is hidden, only the (nonexistent) shortfall
// is not fabricated as a negative bar.
//
// `recruitment.byYear`'s `overAllocation` factor is a DIFFERENT, year-level
// signal (allocated seats vs the enrollment PLAN, not the applicant-funnel
// fill rate charted above) and is not additive with the per-round stack —
// it is summarised in the footnote below instead. Per Task 2: overAllocation
// is now a real nullable number distinguishing "measured but unremarkable"
// (e.g. exactly 1.0 — no over-allocation that year) from "never measured"
// (null — no enrollment plan was recorded that year). The footnote names
// the null years explicitly rather than collapsing them into the
// unremarkable case or dropping them silently.
const LEDE_TH =
  'แผนภูมินี้แสดงจำนวนผู้รายงานตัวเทียบกับที่นั่งที่จัดสรรในแต่ละรอบของ TCAS รอบล่าสุด ' +
  'เพื่อดูว่าที่นั่งที่จัดสรรไว้ถูกใช้ครบหรือไม่ในแต่ละรอบ';

function buildCategories(
  latestRounds: NonNullable<ProgramDetailData['recruitment']>['latestRounds'],
): StackedCategory[] {
  return latestRounds
    .filter(
      (r): r is typeof r & { seats: number; reported: number } =>
        r.seats !== null && r.reported !== null,
    )
    .map((r) => ({
      category: r.round,
      segments: [
        { label: 'Reported', value: r.reported },
        // Never negative — see the file header comment on over-fill rounds.
        { label: 'Unfilled', value: Math.max(r.seats - r.reported, 0) },
      ],
    }));
}

export function renderRecruitmentSection(data: ProgramDetailData): React.ReactElement | null {
  const { recruitment } = data;
  if (!recruitment) return null;

  const categories = buildCategories(recruitment.latestRounds);

  const neverMeasuredYears = recruitment.byYear.filter(
    (y) => y.overAllocation === null && y.yearBE !== null,
  );

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Admissions &amp; demand</span>
          <h2 className="section-title">Recruitment</h2>
        </div>
      </div>
      <BarsStacked
        title={
          recruitment.latestRoundsYear !== null
            ? `Seats filled by TCAS round, BE ${recruitment.latestRoundsYear}`
            : 'Seats filled by TCAS round, latest cycle'
        }
        ledeTh={LEDE_TH}
        categories={categories}
        plotHeightMm={55}
        columnWidthMm={20}
        emptyNote="No per-round recruitment data — run the kku-tcas-funnel connector to populate the latest admission cycle."
        provenance={{
          source: 'kku-tcas-funnel',
          runDate: data.dateLabel,
          method: recruitment.methodologyVersion,
        }}
      />
      {recruitment.inProgressNote && <p className="muted">{recruitment.inProgressNote}</p>}
      {neverMeasuredYears.length > 0 && (
        <p className="muted">
          Over-allocation not measured (no enrollment plan recorded) for{' '}
          {neverMeasuredYears.map((y) => `BE ${y.yearBE}`).join(', ')}.
        </p>
      )}
    </section>
  );
}
