import * as React from 'react';

import type { ProgramDetailData } from '../schema';

// §? — Curriculum revision (program-curriculum-revision.v1). Course-level
// advice derived from what this programme's own roster actually
// publishes: which existing courses to extend, what to propose as new,
// and which courses have outgrown their category.
//
// EVERY RECOMMENDATION SHOWS ITS PAPERS BY NAME. The titles are not
// summarised to a count here, deliberately: this analysis exists to turn
// a roster's research into curriculum advice, and a recommendation with
// no paper behind it is an opinion rather than a finding. A programme
// chair disputing a line in committee needs to see which papers produced
// it — "based on 3 papers" cannot be argued with.
//
// Reference-table shape, so `chartLed: false` — every figure is already
// in the body and nothing is deferred to the appendix.
const LEDE_TH =
  'ข้อเสนอปรับปรุงหลักสูตรนี้สร้างจากผลงานตีพิมพ์ของอาจารย์ในหลักสูตร ' +
  'ทุกข้อเสนออ้างอิงบทความที่ระบุชื่อไว้ชัดเจน';

/** Caps the evidence list per row. The full titles are the point, but a
 *  dozen of them per recommendation turns the table into a bibliography;
 *  the count of the remainder is stated rather than silently dropped. */
const MAX_EVIDENCE_SHOWN = 3;

function EvidenceList({ titles }: { titles: string[] }): React.ReactElement {
  if (titles.length === 0) {
    // Should not occur for enhancements (upstream requires ≥1), but a
    // proposal may legitimately have none — say so rather than render an
    // empty cell that reads as an oversight.
    return <span className="muted">No paper cited</span>;
  }
  const shown = titles.slice(0, MAX_EVIDENCE_SHOWN);
  const rest = titles.length - shown.length;
  return (
    <>
      <ul>
        {shown.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      {rest > 0 && <span className="muted">+{rest} more paper{rest === 1 ? '' : 's'}</span>}
    </>
  );
}

/** Why no advice was produced. Each reason points somewhere different —
 *  'thin' and 'no-research' are about the roster's publications, while
 *  'no-courses' is about our own course extraction. None of them means
 *  the curriculum was examined and found to need no change. */
const NOT_RUN_REASON: Record<string, (paperCount: number) => string> = {
  thin: (n) =>
    `Not enough of the roster's research to analyse — ${n} distinct paper${n === 1 ? '' : 's'} found. This is a limit of the evidence base, not a finding that the curriculum needs no change.`,
  'no-research': () =>
    'No publications are recorded for this programme’s roster, so there is no research base from which to derive curriculum advice.',
  'no-courses': () =>
    'No extracted course list is held for this programme, so no course could be assessed. This is a gap in our curriculum extraction, not a finding about the programme.',
};

export function renderCurriculumRevisionSection(
  data: ProgramDetailData,
): React.ReactElement | null {
  const cr = data.curriculumRevision;
  if (!cr) return null;

  // Analysis never ran. Say which of the four reasons applies rather than
  // rendering an empty section that reads as "nothing to recommend".
  if (cr.readiness !== 'ok') {
    const explain = NOT_RUN_REASON[cr.readiness];
    return (
      <section>
        <div className="section-opener">
          <div>
            <span className="section-kicker">Curriculum</span>
            <h2 className="section-title">Curriculum revision</h2>
          </div>
        </div>
        <p className="muted">
          {explain
            ? explain(cr.distinctPaperCount)
            : 'The curriculum-revision analysis has not been generated for this programme.'}
        </p>
      </section>
    );
  }

  const nothingToShow =
    cr.enhanceCourses.length === 0 &&
    cr.newCourseProposals.length === 0 &&
    cr.promotionCandidates.length === 0;

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Curriculum</span>
          <h2 className="section-title">Curriculum revision</h2>
        </div>
      </div>
      <p className="chart-lede" lang="th">
        {LEDE_TH}
      </p>

      <p>
        {cr.coverage.themesReflected} of {cr.coverage.themesTotal} research themes from this
        programme&rsquo;s roster are reflected in its current curriculum, across{' '}
        {cr.courseCount} course{cr.courseCount === 1 ? '' : 's'}.
      </p>
      {cr.coverage.narrative && <p>{cr.coverage.narrative}</p>}

      {cr.coverage.themesAbsent.length > 0 && (
        <p>
          <strong>Themes with no course home:</strong> {cr.coverage.themesAbsent.join(', ')}.
        </p>
      )}

      {cr.enhanceCourses.length > 0 && (
        <>
          <h3>Extend an existing course</h3>
          <table className="peer-list">
            <thead>
              <tr>
                <th>Course</th>
                <th>Addition</th>
                <th>Effort</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {cr.enhanceCourses.map((c, i) => (
                <tr key={`${c.courseCode}-${i}`}>
                  <td>
                    {c.courseCode}
                    {c.courseNameTh && (
                      <>
                        <br />
                        <span lang="th">{c.courseNameTh}</span>
                      </>
                    )}
                  </td>
                  <td>
                    {c.addition}
                    {c.additionDetail && (
                      <>
                        <br />
                        <span className="muted">{c.additionDetail}</span>
                      </>
                    )}
                    {c.currentlyCoversQuote && (
                      <>
                        <br />
                        <span className="muted" lang="th">
                          Currently: &ldquo;{c.currentlyCoversQuote}&rdquo;
                        </span>
                      </>
                    )}
                  </td>
                  <td>{c.effort || '—'}</td>
                  <td>
                    <EvidenceList titles={c.evidencePaperTitles} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {cr.newCourseProposals.length > 0 && (
        <>
          <h3>Proposed new courses</h3>
          <table className="peer-list">
            <thead>
              <tr>
                <th>Title</th>
                <th>Credits</th>
                <th>Placement</th>
                <th>Could be taught by</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {cr.newCourseProposals.map((p, i) => (
                <tr key={i}>
                  <td>
                    <span lang="th">{p.titleTh}</span>
                    {p.titleEn && (
                      <>
                        <br />
                        <span className="muted">{p.titleEn}</span>
                      </>
                    )}
                    {p.rationale && (
                      <>
                        <br />
                        <span className="muted">{p.rationale}</span>
                      </>
                    )}
                  </td>
                  <td>{p.credits ?? '—'}</td>
                  <td>
                    {p.placementYear === null
                      ? '—'
                      : `Year ${p.placementYear}${
                          p.placementSemester === null ? '' : `, sem ${p.placementSemester}`
                        }`}
                  </td>
                  <td>
                    {p.couldBeTaughtBy.length > 0 ? (
                      p.couldBeTaughtBy.join('; ')
                    ) : (
                      <span className="muted">Not named</span>
                    )}
                  </td>
                  <td>
                    <EvidenceList titles={p.evidencePaperTitles} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {cr.promotionCandidates.length > 0 && (
        <>
          <h3>Courses that have outgrown their category</h3>
          <table className="peer-list">
            <thead>
              <tr>
                <th>Course</th>
                <th>Current</th>
                <th>Proposed</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {cr.promotionCandidates.map((c, i) => (
                <tr key={`${c.courseCode}-${i}`}>
                  <td>
                    {c.courseCode}
                    {c.courseNameTh && (
                      <>
                        <br />
                        <span lang="th">{c.courseNameTh}</span>
                      </>
                    )}
                  </td>
                  <td>{c.currentCategory || '—'}</td>
                  <td>{c.proposedCategory || '—'}</td>
                  <td>{c.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* An empty promotion lane means two different things, and the
          reader can only act on one of them. */}
      {cr.promotionCandidates.length === 0 && cr.coursesWithCategory === 0 && (
        <p className="muted">
          No course-category data is recorded for this programme, so no course could be
          assessed for promotion. This is a data gap, not a finding that every course sits
          in the right category.
        </p>
      )}

      {nothingToShow && (
        <p className="muted">
          The analysis ran but proposed no changes: no course was identified for extension,
          no new course was proposed, and no course was put forward for promotion.
        </p>
      )}

      {cr.caveats.length > 0 && (
        <>
          <h3>Caveats</h3>
          <ul>
            {cr.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )}

      <p className="muted">
        {cr.confidence === null
          ? 'Confidence not reported.'
          : `Model confidence ${Math.round(cr.confidence * 100)}%.`}{' '}
        Methodology {cr.methodVersion}
        {cr.generatedAt ? ` · generated ${cr.generatedAt}` : ''}.
      </p>
    </section>
  );
}
