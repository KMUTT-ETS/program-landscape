import * as React from 'react';

import { BarsH, type BarRow } from '../../../charts';
import { formatPct } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — Skills coverage. `skills.demanded` is the top labour-market-demanded
// skills relevant to this program's careers (already peakDemand-ranked
// upstream, top 20) — the chart itself. `skills.gaps` is a SEPARATE
// upstream top-15 list (demanded skills the curriculum does not yet
// teach), not a client-side filter of `demanded` — it is surfaced in a
// footnote rather than a second series/legend BarsH has no vocabulary for,
// the same "name it, don't drop it" idiom ai-readiness's missing
// sub-scores use.
//
// `BarRow.value` is a plain, non-nullable `number` — a demanded skill with
// no measured peakDemand is excluded from the bars rather than coerced to
// a zero-value bar.
//
// This is LinkedIn data subscribed by MHESI; KMITL only hosts the API.
// `skills.demandSource` already carries the correct attribution
// ('linkedin-via-mhesi') — never hardcode 'KMITL' into this Council-facing
// surface.
const LEDE_TH =
  'แผนภูมินี้แสดงทักษะที่ตลาดแรงงานต้องการสูงสุด ที่เกี่ยวข้องกับสายอาชีพของหลักสูตรนี้ ' +
  'เรียงตามระดับความต้องการสูงสุด';

export function renderSkillsSection(data: ProgramDetailData): React.ReactElement | null {
  const { skills } = data;
  if (!skills) return null;

  const rows: BarRow[] = skills.demanded
    .filter((s): s is typeof s & { peakDemand: number } => s.peakDemand !== null)
    .map((s) => ({ label: s.skill, value: s.peakDemand }));

  const topGaps = skills.gaps.slice(0, 5);

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Labour market alignment</span>
          <h2 className="section-title">Skills coverage</h2>
        </div>
      </div>
      <BarsH
        title="Top demanded skills, labour market"
        ledeTh={LEDE_TH}
        rows={rows}
        labelWidthMm={62}
        rowHeightMm={12}
        formatValue={formatPct}
        emptyNote={
          `No labour-market-demanded skills matched this program (demand tier: ${skills.demandTier}, ` +
          `source: ${skills.demandSource}, ${skills.careerFilterCount ?? 0} careers in scope).`
        }
        provenance={{
          source: skills.demandSource,
          runDate: data.dateLabel,
          method: `demand tier: ${skills.demandTier} · ${skills.careerFilterCount ?? 0} careers in scope`,
        }}
      />
      {topGaps.length > 0 && (
        <p className="muted">
          Demanded but not yet taught: {topGaps.map((g) => g.skill).join(', ')}
          {skills.gaps.length > topGaps.length ? ', …' : ''}
        </p>
      )}
    </section>
  );
}
