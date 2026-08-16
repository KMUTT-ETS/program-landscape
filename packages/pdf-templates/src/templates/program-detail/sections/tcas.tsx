import * as React from 'react';

import { DotRange, type DotRangeRow } from '../../../charts';
import { formatScore } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — TCAS score detail. DotRangeRow.value is a plain, non-nullable
// `number` — this program's own admission cutoff (minScore) per
// year/round, plotted against a peer band. `tcas.peers` carries no year of
// its own (it is a snapshot of comparable programmes elsewhere, not a
// year-specific series), so the peer band — [min, max] of peer minScores —
// is computed ONCE across the whole peer set and applied identically to
// every KKU history row, rather than attempting a (non-existent) per-year
// peer match. A KKU value that falls outside that band is exactly the
// signal DotRange exists to preserve: it must render unclamped and marked,
// never pulled back inside the range to look tidy.
const LEDE_TH =
  'แผนภูมินี้เปรียบเทียบคะแนนต่ำสุดที่ใช้รับเข้าของหลักสูตรในแต่ละปี กับช่วงคะแนนของหลักสูตรใกล้เคียงในสถาบันอื่น ' +
  'จุดที่อยู่นอกช่วงเป็นสัญญาณด้านคุณภาพข้อมูลที่ควรตรวจสอบ ไม่ใช่การปัดเข้าช่วง';

function buildRows(tcas: NonNullable<ProgramDetailData['tcas']>): DotRangeRow[] {
  const peerScores = tcas.peers
    .map((p) => p.minScore)
    .filter((v): v is number => v !== null);
  if (peerScores.length === 0) return [];

  const peerMin = Math.min(...peerScores);
  const peerMax = Math.max(...peerScores);

  return tcas.history
    .filter(
      (h): h is typeof h & { yearBE: number; minScore: number } =>
        h.yearBE !== null && h.minScore !== null,
    )
    .map((h) => ({
      label: `BE ${h.yearBE} R${h.round}`,
      value: h.minScore,
      min: peerMin,
      max: peerMax,
    }));
}

export function renderTcasSection(data: ProgramDetailData): React.ReactElement | null {
  const { tcas } = data;
  if (!tcas) return null;

  const rows = buildRows(tcas);

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Peer comparison</span>
          <h2 className="section-title">TCAS score detail</h2>
        </div>
      </div>
      <DotRange
        title="Admission cutoff (min score) vs peer programme range"
        ledeTh={LEDE_TH}
        rows={rows}
        labelWidthMm={40}
        valueGutterMm={50}
        formatValue={formatScore}
        emptyNote="No TCAS peer range available — run the peer-programs-scraper connector to populate comparable-programme scores."
        // `TcasSchema` carries no `methodologyVersion` field — the peer band
        // is a plain min/max read of `tcas.peers[].minScore`, not a scored
        // methodology. An honest descriptive phrase here, not a fabricated
        // version number (same posture batch 1 used for cohortDistribution,
        // which also has no methodology version upstream).
        provenance={{
          source: 'tcas-connector · peer-programs-scraper',
          runDate: data.dateLabel,
          method: 'peer band = min–max of comparable-programme min scores (no scoring methodology)',
        }}
      />
    </section>
  );
}
