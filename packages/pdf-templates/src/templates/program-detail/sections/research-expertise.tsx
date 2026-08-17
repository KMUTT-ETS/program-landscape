import * as React from 'react';

import { formatCount, formatPct } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — Research expertise. Reference-table shape — no chart. Sourced from
// `ProgramResearchExpertise` (see packages/db/src/program-deep-dive.ts's
// `programResearchExpertise()`), an AI-authored brief the ops runner
// (`pnpm expertise:generate`) produces per program from the last-10-years
// publications of the curated program-faculty roster.
//
// UNLIKE `peers.tsx` / `strategic-narrative.tsx` — the two other nullable-
// wrapper sections in this template — this section does NOT return `null`
// when its field is absent. Those two omit themselves because "never
// computed" is either a permanent data-model gap (peer skill overlap has
// no source at all) or simply hasn't run yet with no scheduled ceiling.
// Research expertise is different: the bulk run (`pnpm expertise:generate
// --all`) is expected to eventually cover every program, and a handful of
// programs will legitimately and PERMANENTLY have no row — `no-roster`
// (no curated faculty at all) or `thin` (roster exists but under the
// 10-paper analysis floor, see `readinessFor()`) never get analysed by
// design. A Council reader comparing two programs side-by-side needs to be
// able to tell "not assessed" apart from "the report generator silently
// skipped a section" — an explained empty note does that; an omitted
// section does not. See `decisions.tsx` for the same reasoning applied to
// a bare array instead of a nullable object.
const LEDE_TH =
  'ตารางนี้สรุปประเด็นความเชี่ยวชาญด้านการวิจัยของหลักสูตร จากผลงานตีพิมพ์ของบุคลากรในบัญชีรายชื่อ ' +
  'ในช่วง 10 ปีที่ผ่านมา พร้อมข้อเสนอแนะเชิงกลยุทธ์ 3 ด้าน ได้แก่ หลักสูตร การวางตำแหน่ง และทิศทางการวิจัย';

const TREND_LABEL: Record<'rising' | 'steady' | 'fading', string> = {
  rising: 'Rising',
  steady: 'Steady',
  fading: 'Fading',
};

function trendBadgeClass(trend: 'rising' | 'steady' | 'fading'): string {
  if (trend === 'rising') return 'badge success';
  if (trend === 'fading') return 'badge warning';
  return 'badge';
}

type LaneKey = 'curriculum' | 'positioning' | 'research';

const LANES: { key: LaneKey; label: string }[] = [
  { key: 'curriculum', label: 'Curriculum' },
  { key: 'positioning', label: 'Positioning' },
  { key: 'research', label: 'Research strategy' },
];

export function renderResearchExpertiseSection(data: ProgramDetailData): React.ReactElement | null {
  const { researchExpertise } = data;

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Research strength</span>
          <h2 className="section-title">Research expertise</h2>
        </div>
      </div>
      <p className="chart-lede" lang="th">
        {LEDE_TH}
      </p>

      {!researchExpertise ? (
        <p className="muted">
          No research-expertise brief has been generated for this program yet — either the roster
          has too few recent publications to analyse, or the bulk run has not reached it. Run{' '}
          <code>pnpm expertise:generate</code> to produce one.
        </p>
      ) : (
        <>
          <p className="caption">
            Theme counts refer to the {formatCount(researchExpertise.analysedPaperCount)} most
            significant papers analysed (of {formatCount(researchExpertise.totalDistinctPapers)}{' '}
            total).
          </p>

          {researchExpertise.themes.length === 0 ? (
            <p className="muted">No research themes identified in the analysed papers.</p>
          ) : (
            <table className="research-theme-list">
              <thead>
                <tr>
                  <th>Theme</th>
                  <th className="numeric">Papers</th>
                  <th>Years</th>
                  <th>Trend</th>
                  <th>Example titles</th>
                </tr>
              </thead>
              <tbody>
                {researchExpertise.themes.map((t, i) => (
                  <tr key={i}>
                    <td>
                      {t.name}
                      {t.evidenceNote && (
                        <>
                          <br />
                          <span className="muted">{t.evidenceNote}</span>
                        </>
                      )}
                    </td>
                    <td className="numeric">{formatCount(t.paperCount)}</td>
                    <td>{t.yearSpan || '—'}</td>
                    <td>
                      <span className={trendBadgeClass(t.trend)}>{TREND_LABEL[t.trend]}</span>
                    </td>
                    <td>
                      {t.exampleTitles.length === 0 ? (
                        '—'
                      ) : (
                        <ul>
                          {t.exampleTitles.map((title, j) => (
                            <li key={j}>&ldquo;{title}&rdquo;</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {LANES.map((lane) => {
            const items = researchExpertise.recommendations[lane.key];
            return (
              <div key={lane.key}>
                <h3>{lane.label}</h3>
                {items.length === 0 ? (
                  <p className="muted">No {lane.label.toLowerCase()} recommendations.</p>
                ) : (
                  <ul>
                    {items.map((r, i) => (
                      <li key={i}>
                        {r.action}
                        {r.horizonMonths !== null ? ` (${formatCount(r.horizonMonths)} mo)` : ''} —{' '}
                        {r.rationale}
                        {r.themeRefs.length > 0 && (
                          <>
                            {' '}
                            <span className="muted">· themes: {r.themeRefs.join(', ')}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          {researchExpertise.caveats.length > 0 && (
            <>
              <h3>Caveats</h3>
              <ul className="muted">
                {researchExpertise.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}

          <p className="caption">
            <strong>Source</strong> kku-research (KKU Publications mirror) · curated program-faculty
            roster · {data.dateLabel} · <strong>Method</strong> {researchExpertise.methodVersion} ·
            confidence {formatPct(researchExpertise.confidencePct)} · generated{' '}
            {researchExpertise.generatedAt}
          </p>
        </>
      )}
    </section>
  );
}
