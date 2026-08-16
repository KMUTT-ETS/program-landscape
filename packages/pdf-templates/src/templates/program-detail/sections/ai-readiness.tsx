import * as React from 'react';

import { BarsH, type BarRow } from '../../../charts';
import type { ProgramDetailData } from '../schema';

// §2 — AI readiness. `BarRow.value` is a plain, non-nullable `number` —
// BarsH has no way to draw a null sub-score (unlike Radar, which has a
// dedicated hollow-marker vocabulary for exactly that). A null
// `subScoreValues[].score` is real information (the sub-metric has not
// been measured yet, e.g. "Pedagogical readiness" before any adoption
// survey exists) and must not be silently dropped OR coerced to 0 — a
// coerced 0 would assert "we measured this and it scored zero," which is
// a materially different, worse claim. So a null score is excluded from
// the bars themselves and named explicitly in a footnote instead, reusing
// the same human-readable reason already carried on `aiReadiness.
// subScores[].notes` (e.g. "data not yet collected") rather than
// inventing new copy.
const LEDE_TH =
  'แผนภูมินี้แจกแจงคะแนนความพร้อมด้าน AI ของหลักสูตรออกเป็นองค์ประกอบย่อย ' +
  'เพื่อชี้ให้เห็นว่าจุดแข็งและจุดอ่อนอยู่ที่ใด';

export function renderAiReadinessSection(data: ProgramDetailData): React.ReactElement | null {
  const { aiReadiness } = data;
  if (!aiReadiness) return null;

  const scoredRows: BarRow[] = [];
  const missing: { label: string; reason: string }[] = [];
  for (const v of aiReadiness.subScoreValues) {
    if (v.score === null) {
      const reason =
        aiReadiness.subScores.find((s) => s.metric === v.label)?.notes || 'data not yet collected';
      missing.push({ label: v.label, reason });
    } else {
      scoredRows.push({ label: v.label, value: v.score });
    }
  }

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Future-readiness</span>
          <h2 className="section-title">AI readiness</h2>
        </div>
      </div>
      <BarsH
        title="AI-readiness sub-scores (0–100)"
        ledeTh={LEDE_TH}
        rows={scoredRows}
        labelWidthMm={62}
        rowHeightMm={14}
        emptyNote="No AI-readiness sub-scores are available yet for this program."
        provenance={{
          source: 'program-digest · kku-research',
          runDate: data.dateLabel,
          method: aiReadiness.methodologyVersion,
        }}
      />
      {missing.length > 0 && (
        <p className="muted">
          {missing.map((m) => `${m.label}: ${m.reason}`).join(' · ')}
        </p>
      )}
    </section>
  );
}
