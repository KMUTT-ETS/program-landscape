import * as React from 'react';

import { formatScore } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — Lifecycle verdict. Prose shape per the section-shape decision — no
// chart leads this section. `.pull-quote` carries the verdict itself (the
// single most decision-relevant word in the whole report — GROWTH / STABLE
// / AT_RISK / SUNSET etc.), with the trajectory score and driver breakdown
// as supporting text underneath. See magazine-css.ts's `.pull-quote` rule.
//
// `verdict` is rendered verbatim — a template displays, it does not
// compute or reformat (see cover.tsx's identical stance on the same field).
const LEDE_TH =
  'ข้อสรุปนี้แสดงสถานะวงจรชีวิตของหลักสูตร พร้อมคะแนนแนวโน้มและปัจจัยหลักที่ส่งผลต่อคะแนนดังกล่าว';

function driverLabel(d: { direction: 'lifting' | 'drag'; label: string; contribution: number | null }): string {
  const sign = d.contribution !== null && d.contribution > 0 ? '+' : '';
  return `${d.direction === 'lifting' ? 'Lifting' : 'Drag'} — ${d.label} (${sign}${formatScore(d.contribution)})`;
}

export function renderLifecycleSection(data: ProgramDetailData): React.ReactElement | null {
  const { lifecycle } = data;
  if (!lifecycle) return null;

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Lifecycle</span>
          <h2 className="section-title">Lifecycle verdict</h2>
        </div>
      </div>
      <p className="chart-lede" lang="th">
        {LEDE_TH}
      </p>

      <div className="pull-quote">
        <p>{lifecycle.verdict}</p>
        <span className="attribution">
          Trajectory score {formatScore(lifecycle.trajectoryScore)} / 100 · methodology{' '}
          {lifecycle.methodologyVersion} · generated {lifecycle.generatedAt}
        </span>
      </div>

      {lifecycle.narrative && <p>{lifecycle.narrative}</p>}

      {lifecycle.drivers.length > 0 ? (
        <ul>
          {lifecycle.drivers.map((d, i) => (
            <li key={i}>{driverLabel(d)}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No scored drivers recorded for this verdict.</p>
      )}
    </section>
  );
}
