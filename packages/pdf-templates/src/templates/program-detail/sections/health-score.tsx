import * as React from 'react';

import { Radar, type RadarAxis } from '../../../charts';
import { formatScore } from '../format';
import type { ProgramDetailData } from '../schema';

// §1 — Health score. `healthDimensions` is a plain array (default []), not
// a nullable container object — an empty array genuinely means "the
// methodology never scored a single dimension for this program," which is
// "no data at all" for this section (see program-deep-dive.ts's
// `AiReadinessSection`-equivalent web pattern: `if (!data) return null`).
// A dimension with `score: null` inside a non-empty array is a different,
// partial-data case — health-score.v1 explicitly EXCLUDES that dimension
// from the average rather than substituting 0, and Radar already renders
// that as a hollow "no data" marker on its own spoke. This component must
// not pre-filter null-score dimensions out of `axes` — that would hide the
// gap Radar exists to show.
const LEDE_TH =
  'เรดาร์นี้แสดงคะแนนสุขภาพหลักสูตรแยกตามมิติทั้ง 5 ด้าน จากคะแนนเต็ม 100 ' +
  'มิติที่ไม่มีข้อมูลจะไม่ถูกวาด ไม่ใช่วาดเป็นศูนย์';

const RADIUS_MM = 40;

/** Names what the faculty mean is a mean OF. A mean over three programmes
 *  and one over forty are different claims, and a reader given only the
 *  number cannot tell them apart. */
function facultyBasis(b: NonNullable<ProgramDetailData['healthBenchmark']>): string {
  if (b.facultySampleSize === null) {
    return 'No faculty mean — this programme has no faculty, or its faculty contributed no scored programmes.';
  }
  const name = b.facultyNameTh ? `${b.facultyNameTh} ` : 'Faculty ';
  return `${name}mean over ${b.facultySampleSize} scored programme${b.facultySampleSize === 1 ? '' : 's'}.`;
}

export function renderHealthScoreSection(data: ProgramDetailData): React.ReactElement | null {
  if (data.healthDimensions.length === 0) return null;

  // Only worth a table when at least one comparison actually resolved —
  // otherwise it would be five rows of dashes restating the radar.
  const benchmarked = data.healthDimensions.some(
    (d) => d.facultyMean !== null || d.universityMean !== null,
  )
    ? data.healthDimensions
    : [];

  const axes: RadarAxis[] = data.healthDimensions.map((d) => ({
    label: d.dimension,
    value: d.score,
    max: 100,
  }));

  // No `.program-body` wrapper here — that element owns the shared
  // `counter-reset: section` (magazine-css.ts) and is applied exactly
  // once, around the whole sequence of sections, by template.tsx (Task 7).
  // Wrapping it here too would reset the §-counter before every section.
  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Portfolio health</span>
          <h2 className="section-title">Health score</h2>
        </div>
      </div>
      <Radar
        title="Health score by dimension (0–100)"
        ledeTh={LEDE_TH}
        axes={axes}
        radiusMm={RADIUS_MM}
        provenance={{
          source: 'health-score composite (kku-registry, kku-hr, kku-finance, graduate-outcomes)',
          runDate: data.dateLabel,
          method: data.healthMethodologyVersion || data.methodologyVersion,
        }}
      />

      {/* The radar plots ONE series — this programme. Without the two
          comparison means a reader has no way to tell a 55 that leads its
          faculty from a 55 that trails it, which is the question the
          score is usually being read to answer. Rendered as a table
          because Radar takes a single value per axis; a dash is a
          comparison that could not be computed, never a mean of zero. */}
      {benchmarked.length > 0 && (
        <>
          <table className="peer-list">
            <thead>
              <tr>
                <th>Dimension</th>
                <th>This programme</th>
                <th>Faculty mean</th>
                <th>University mean</th>
              </tr>
            </thead>
            <tbody>
              {benchmarked.map((d) => (
                <tr key={d.dimension}>
                  <td>{d.dimension}</td>
                  <td>{formatScore(d.score)}</td>
                  <td>{formatScore(d.facultyMean)}</td>
                  <td>{formatScore(d.universityMean)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.healthBenchmark && (
            <p className="muted">
              {facultyBasis(data.healthBenchmark)} University mean over{' '}
              {data.healthBenchmark.universitySampleSize} scored programme
              {data.healthBenchmark.universitySampleSize === 1 ? '' : 's'}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
