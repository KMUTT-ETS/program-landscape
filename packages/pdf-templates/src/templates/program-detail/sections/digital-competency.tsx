import * as React from 'react';

import { Radar, type RadarAxis } from '../../../charts';
import { formatPct, formatScore } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — Digital Intelligence (DQ) competency. Mirrors the deep-dive page's
// sub-block under Outcomes, radar and all, so the PDF is not a reduced
// account of what the reader saw on screen.
//
// FOUR STATES, AND WHY NONE OF THEM COLLAPSE (see the same rule on
// programDigitalCompetency() in packages/db/src/program-deep-dive.ts):
//
//   not-applicable  A non-bachelor programme. DQ is an undergraduate
//                   instrument, so this renders NOTHING — no heading, no
//                   empty box. An empty box would invite the reader to
//                   ask why a master's programme scored nothing.
//   no-data         A bachelor programme the DQ export never covered.
//   below-floor     1–4 tested students. The score and pass rate are
//                   withheld, but the COUNT is stated, because telling a
//                   programme with four tested students that it has never
//                   been tested is a different and false claim.
//   ok              ≥5 tested students.
//
// The floor and the pass mark are carried in the payload rather than
// written here, so they move with the query layer instead of drifting
// between the page and this report.
const LEDE_TH =
  'แผนภาพนี้เปรียบเทียบคะแนนสมรรถนะดิจิทัลของนักศึกษาหลักสูตรนี้กับค่าเฉลี่ยของมหาวิทยาลัย รายด้าน';

/** DQ module means are on a 0–100 scale, the same scale the page's radar
 *  uses; the axis maximum is therefore fixed, not derived from the data. */
const DQ_AXIS_MAX = 100;

/** The Radar primitive's own minimum — fewer axes than this cannot form a
 *  polygon, so it renders its empty state instead. Mirrored here so this
 *  section can drop the chart rather than emit a misleading empty note. */
const MIN_RADAR_AXES = 3;

export function renderDigitalCompetencySection(
  data: ProgramDetailData,
): React.ReactElement | null {
  const dq = data.digitalCompetency;
  if (!dq) return null;
  // Renders nothing at all — see the header. This is deliberate and is
  // NOT the same as `no-data`.
  if (dq.status === 'not-applicable') return null;

  const opener = (
    <div className="section-opener">
      <div>
        <span className="section-kicker">Graduate outcomes</span>
        <h2 className="section-title">Digital competency</h2>
      </div>
    </div>
  );

  if (dq.status === 'no-data') {
    return (
      <section>
        {opener}
        <p className="muted">
          No Digital Intelligence competency results cover this programme. The DQ export
          reaches undergraduate cohorts only, and this programme has no scored students in
          it.
        </p>
      </section>
    );
  }

  if (dq.status === 'below-floor') {
    return (
      <section>
        {opener}
        <p>
          {dq.scoredStudents} student{dq.scoredStudents === 1 ? '' : 's'} from this
          programme took the Digital Intelligence assessment — below the reporting floor of{' '}
          {dq.minCellStudents}, so the score and pass rate are withheld. The programme has
          been tested; the sample is too small to report.
        </p>
      </section>
    );
  }

  const axes: RadarAxis[] = dq.modules.map((m) => ({
    label: `${m.moduleNo}. ${m.label}`,
    // null, never 0 — an untested module is not a module scored zero, and
    // the Radar primitive keeps that distinction visible.
    value: m.mean,
    max: DQ_AXIS_MAX,
  }));

  return (
    <section>
      {opener}

      <div className="stat-block">
        <div className="stat" data-stat="dq-mean">
          <span className={dq.rawMean === null ? 'stat-value muted' : 'stat-value'}>
            {formatScore(dq.rawMean)}
          </span>
          <span className="stat-label">Mean score / 100</span>
        </div>
        <div className="stat" data-stat="dq-pass-rate">
          <span className={dq.passRatePct === null ? 'stat-value muted' : 'stat-value'}>
            {formatPct(dq.passRatePct)}
          </span>
          <span className="stat-label">
            {dq.passMark === null ? 'Pass rate' : `At or above KKU pass mark (${dq.passMark})`}
          </span>
        </div>
        <div className="stat" data-stat="dq-scored-students">
          <span className="stat-value">{dq.scoredStudents}</span>
          <span className="stat-label">Students tested</span>
        </div>
      </div>

      {/* Radar only above its own 3-axis minimum. Below that the primitive
          renders its empty state, whose note would read "no per-module
          results" while the table underneath shows results — a plain
          contradiction. The table carries every figure regardless, so
          dropping the chart loses nothing. */}
      {axes.length >= MIN_RADAR_AXES && (
        <Radar
          title="Digital competency by module — programme mean"
          ledeTh={LEDE_TH}
          axes={axes}
          provenance={{
            source: 'kku-dq',
            runDate: data.dateLabel,
            method: dq.methodologyVersion,
          }}
        />
      )}

      {/* The radar carries the shape; this table carries the figures,
          including the university comparison the radar cannot show
          without a second overlapping series. */}
      <table className="peer-list">
        <thead>
          <tr>
            <th>Module</th>
            <th>Programme</th>
            <th>University</th>
          </tr>
        </thead>
        <tbody>
          {dq.modules.map((m) => (
            <tr key={m.moduleNo}>
              <td>
                {m.moduleNo}. {m.label}
              </td>
              <td>{formatScore(m.mean)}</td>
              <td>{formatScore(m.universityMean)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {dq.weakest.length > 0 && (
        <p>
          Weakest modules:{' '}
          {dq.weakest.map((w, i) => (
            <React.Fragment key={w.label}>
              {i > 0 ? ', ' : ''}
              {w.label} ({formatScore(w.mean)})
            </React.Fragment>
          ))}
          .
        </p>
      )}

      <p className="muted">
        Scores are withheld for any cell with fewer than {dq.minCellStudents} tested
        students. Methodology {dq.methodologyVersion}.
      </p>
    </section>
  );
}
