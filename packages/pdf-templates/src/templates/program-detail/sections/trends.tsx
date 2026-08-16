import * as React from 'react';

import { formatPct } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — Trend exposure. Reference-table shape — a table in the body, no
// chart leading it.
//
// `data.trends` has no wrapping nullable object at the schema level — it is
// a bare array defaulting to `[]` (see schema.ts). That collapses "the
// trend-monitor pipeline never ran for this program" and "the pipeline ran
// and genuinely found nothing new this cycle" into the same empty state,
// and unlike health-score's `healthDimensions` (where empty really does
// mean "never scored"), zero trend signals is a normal, expected outcome of
// an ongoing monitor — programs go whole cycles with no new external
// signal. So this section always renders (never returns null for an empty
// array), with an explained empty note that names both possibilities
// honestly rather than asserting either one.
const LEDE_TH =
  'ตารางนี้แสดงสัญญาณแนวโน้มภายนอกที่เกี่ยวข้องกับหลักสูตร พร้อมระดับผลกระทบและข้อเสนอแนะเชิงกลยุทธ์';

function recommendationBadge(recommendation: string): string {
  const r = recommendation.toLowerCase();
  if (r === 'take action') return 'badge danger';
  if (r === 'monitor') return 'badge warning';
  return 'badge';
}

// Return type stays `React.ReactElement | null` to match every other
// section's signature (Task 7 assembles them as a uniform list) even though
// this implementation never actually returns null — see the header comment
// above for why an empty `trends` array renders an explained empty block
// instead.
export function renderTrendsSection(data: ProgramDetailData): React.ReactElement | null {
  const { trends } = data;

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">External signals</span>
          <h2 className="section-title">Trend exposure</h2>
        </div>
      </div>
      <p className="chart-lede" lang="th">
        {LEDE_TH}
      </p>

      {trends.length === 0 ? (
        <p className="muted">
          No trend signals on file for this program — either none have been detected yet, or the
          trend-monitor connectors haven&rsquo;t surfaced anything new this cycle.
        </p>
      ) : (
        <table className="trend-list">
          <thead>
            <tr>
              <th>Signal</th>
              <th>Type</th>
              <th>Targeted</th>
              <th className="numeric">Impact</th>
              <th>Recommendation</th>
              <th>Detected</th>
            </tr>
          </thead>
          <tbody>
            {trends.map((t, i) => (
              <tr key={i}>
                <td>
                  <strong>{t.title}</strong>
                  {t.summary && (
                    <>
                      <br />
                      <span className="muted">{t.summary}</span>
                    </>
                  )}
                  {t.rationale && (
                    <>
                      <br />
                      <span className="muted">Why it matters: {t.rationale}</span>
                    </>
                  )}
                </td>
                <td>{t.type}</td>
                <td>{t.targeted}</td>
                <td className="numeric">{formatPct(t.impactScorePct)}</td>
                <td>
                  <span className={recommendationBadge(t.recommendation)}>{t.recommendation}</span>
                  {t.impactBucket && (
                    <>
                      <br />
                      <span className="muted">{t.impactBucket} impact</span>
                    </>
                  )}
                </td>
                <td>{t.detected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="caption">
        <strong>Source</strong> trend-monitor connectors · {data.dateLabel}
      </p>
    </section>
  );
}
