import * as React from 'react';

import { Funnel } from '../../../charts';
import type { ProgramDetailData } from '../schema';

// §3 — Demand funnel. Funnel computes each stage's own conversion badge
// (value · pct%) directly off consecutive `stages` values — it takes no
// separate conversions prop. `demandFunnel.conversions` (fromKey/toKey/
// rate) is the backend's own authoritative per-stage rates over the
// UNFILTERED stage list; it is appendix material (Task 6, exact figures),
// not something this chart needs duplicated into it.
const LEDE_TH =
  'อุปสงค์นี้แสดงเส้นทางของนักศึกษาในรุ่นล่าสุดที่สำเร็จการศึกษาแล้ว ตั้งแต่การรับเข้า ' +
  'จนถึงสำเร็จการศึกษา พร้อมอัตราการผ่านแต่ละขั้น';

export function renderDemandFunnelSection(data: ProgramDetailData): React.ReactElement | null {
  const { demandFunnel } = data;
  if (!demandFunnel) return null;

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Admissions &amp; demand</span>
          <h2 className="section-title">Demand funnel</h2>
        </div>
      </div>
      <Funnel
        title="Admission-to-graduation funnel, most recent completed cohort"
        ledeTh={LEDE_TH}
        // FunnelStage.value is a plain, non-nullable `number` — a stage
        // whose value was never measured is excluded rather than coerced
        // to 0 (same "unmeasured is not zero" rule as the AI-readiness
        // bars). The builder only ever emits positive, non-null stage
        // values today (it already filters `value > 0` upstream), so this
        // is a defensive guard against the schema's nullability, not a
        // path exercised by real data.
        stages={demandFunnel.stages
          .filter((s): s is { stage: string; value: number } => s.value !== null)
          .map((s) => ({ label: s.stage, value: s.value }))}
        rowHeightMm={14}
        labelWidthMm={45}
        emptyNote="No cohort funnel data — run kku-registry + alumni links to populate admission-to-graduation stages."
        provenance={{
          source: 'kku-registry · tcas · kku-alumni',
          runDate: data.dateLabel,
          method: demandFunnel.methodologyVersion,
        }}
      />
    </section>
  );
}
