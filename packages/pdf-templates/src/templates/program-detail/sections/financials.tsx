import * as React from 'react';

import { Waterfall, type WaterfallBar } from '../../../charts';
import { formatCompactNumber } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — Financials. `financials.waterfall` walks tuition revenue down to net
// contribution after direct-cost allocation (see program-deep-dive.ts's
// `computeFinancialWaterfall`, the DB helper this payload traces back to).
// Task 2 gave each bar a real `isTotal` boolean (true only for the closing
// "Net contribution" bar) — Waterfall's own running-total walk already draws
// a total bar from zero rather than from the running total, so this
// component only has to pass the flag through, never reimplement the walk.
//
// `value` is nullable per bar; a bar the cost-allocation methodology never
// computed is EXCLUDED from the chart (same non-substitution rule as every
// other section), never coerced to a zero-delta bar — a zero delta would
// misreport "measured, no change" for "not measured".
//
// `columnWidthMm`/`labelHeightMm` are widened past the primitive's
// short-label defaults: the real step labels ("Net contribution (from
// tuition)") run past 40mm natural width and rotate — see charts/README.md's
// "Sizing for real KKU data".
const LEDE_TH =
  'แผนภูมินี้แสดงเส้นทางจากรายได้ค่าเล่าเรียนไปสู่ผลสุทธิของหลักสูตร หลังหักต้นทุนทางตรงตามวิธีจัดสรรต้นทุน';

export function renderFinancialsSection(data: ProgramDetailData): React.ReactElement | null {
  const { financials } = data;
  if (!financials) return null;

  const bars: WaterfallBar[] = financials.waterfall
    .filter((b): b is typeof b & { value: number } => b.value !== null)
    .map((b) => ({ label: b.step, delta: b.value, isTotal: b.isTotal }));

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Financial sustainability</span>
          <h2 className="section-title">Financials</h2>
        </div>
      </div>
      <Waterfall
        title={`Revenue to net contribution (THB)${
          financials.headlineFiscalYear !== null ? ` — FY ${financials.headlineFiscalYear}` : ''
        }`}
        ledeTh={LEDE_TH}
        bars={bars}
        plotHeightMm={55}
        columnWidthMm={36}
        labelHeightMm={30}
        formatValue={formatCompactNumber}
        emptyNote={`No cost-allocation waterfall computed (method ${financials.methodologyVersion}).`}
        provenance={{
          source: 'kku-finance (cost-allocation)',
          runDate: data.dateLabel,
          method: financials.methodologyVersion,
        }}
      />
      {financials.partialCurrentYearNote && <p className="muted">{financials.partialCurrentYearNote}</p>}
    </section>
  );
}
