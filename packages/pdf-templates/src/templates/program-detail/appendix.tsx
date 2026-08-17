import * as React from 'react';

import { formatCohortChangePct, formatCount, formatPct, formatScore } from './format';
import type { ProgramDetailData } from './schema';
import { SECTIONS } from './sections';

// The back-matter data appendix. Every chart-led section's body shows a
// lede + a chart + provenance — the exact numbers behind that chart are
// never printed as text in the body (that's the whole point of the
// magazine rebuild: a chart carries the interpretive load a dense table
// used to). This file is where those numbers move to, in FULL PRECISION —
// deliberately never `formatCompactNumber` (that helper exists only for
// chart-axis ticks, where space is scarce; an appendix has a whole table
// cell and nothing to gain from abbreviating "2,354,000" to "2.35M").
//
// Prose sections (lifecycle, strategic narrative) and reference-table
// sections (course list, trend exposure, council decisions, peer
// institutions, research expertise) contribute nothing — their body IS the
// full-figure table or the full narrative already; there is nothing left
// to move here.
//
// Numbering: `magazine-css.ts` gives every `.appendix-entry` its own
// `appendix-item` counter, seeded per-entry via an inline `counter-reset`
// so a sparse, out-of-order set of entries (not every section has a
// contribution) can each still cross-reference the correct originating
// section number — see that file's header comment for why a single
// document-wide counter can't do this on its own.
//
// `sectionIndex` below is computed by literally calling every section's
// own `render()` in document order via the shared `SECTIONS` manifest
// (`./sections/index.ts`) and counting non-null results — this is the
// same predicate that produces the body's own `.section-opener` elements,
// so the running total here can never disagree with the CSS `section`
// counter Chromium computes at print time.
const LEDE_TH =
  'ภาคผนวกนี้รวบรวมตัวเลขที่ใช้พล็อตแผนภูมิในทุกหมวดของรายงานฉบับนี้ ด้วยความละเอียดเต็มรูปแบบ ' +
  'อ้างอิงกลับไปยังหมวดต้นทางของแต่ละตาราง';

interface AppendixTable {
  title: string;
  caption: string;
  table: React.ReactElement;
}

function matchLabel(match: boolean | null): string {
  if (match === null) return 'Not yet reviewed';
  return match ? 'Yes' : 'No';
}

// One builder per chart-led section id (see `SECTIONS` in
// `./sections/index.ts`). Each pulls the EXACT raw array its section's
// chart plots — no re-filtering to "only what fit on the chart" beyond
// what the chart itself already excludes (a null value the chart couldn't
// plot still gets its own row here, rendered as an em dash, never
// dropped). Returns `null` when the underlying array is empty — the
// section still rendered (its `emptyNote` already explains the gap in the
// body), so it still occupies a numbered §-slot, but an appendix entry
// with no rows would be noise, not information.
const APPENDIX_TABLES: Record<string, (data: ProgramDetailData) => AppendixTable | null> = {
  'health-score': (data) => {
    const rows = data.healthDimensions;
    if (rows.length === 0) return null;
    return {
      title: 'Health score by dimension',
      caption: `Source: health-score composite (kku-registry, kku-hr, kku-finance, graduate-outcomes) · method ${
        data.healthMethodologyVersion || data.methodologyVersion
      } · ${data.dateLabel}`,
      table: (
        <table className="appendix-table">
          <thead>
            <tr>
              <th>Dimension</th>
              <th className="numeric">Score</th>
              <th className="numeric">Data completeness</th>
              <th>Top driver</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={i}>
                <td>{d.dimension}</td>
                <td className="numeric">{formatScore(d.score)}</td>
                <td className="numeric">{formatPct(d.dataCompleteness)}</td>
                <td>
                  {d.topDriverLabel ?? '—'}
                  {d.topDriverValue !== null ? ` (${formatScore(d.topDriverValue)})` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    };
  },

  'ai-readiness': (data) => {
    const aiReadiness = data.aiReadiness;
    if (!aiReadiness) return null;
    const rows = aiReadiness.subScoreValues;
    if (rows.length === 0) return null;
    return {
      title: 'AI-readiness sub-scores',
      caption: `Source: program-digest · kku-research · method ${aiReadiness.methodologyVersion} · ${data.dateLabel}`,
      table: (
        <table className="appendix-table">
          <thead>
            <tr>
              <th>Sub-score</th>
              <th className="numeric">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.label}</td>
                <td className="numeric">{formatScore(r.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    };
  },

  'demand-funnel': (data) => {
    const demandFunnel = data.demandFunnel;
    if (!demandFunnel) return null;
    const rows = demandFunnel.stages;
    if (rows.length === 0) return null;
    return {
      title: 'Demand funnel — stage values',
      caption: `Source: kku-registry · tcas · kku-alumni · method ${demandFunnel.methodologyVersion} · ${data.dateLabel}`,
      table: (
        <table className="appendix-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th className="numeric">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={i}>
                <td>{s.stage}</td>
                <td className="numeric">{formatCount(s.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    };
  },

  recruitment: (data) => {
    const recruitment = data.recruitment;
    if (!recruitment) return null;
    const rows = recruitment.latestRounds;
    if (rows.length === 0) return null;
    return {
      title:
        recruitment.latestRoundsYear !== null
          ? `Recruitment — per-round breakdown, BE ${recruitment.latestRoundsYear}`
          : 'Recruitment — per-round breakdown',
      caption: `Source: kku-tcas-funnel · method ${recruitment.methodologyVersion} · ${data.dateLabel}`,
      table: (
        <table className="appendix-table">
          <thead>
            <tr>
              <th>Round</th>
              <th className="numeric">Seats</th>
              <th className="numeric">Applicants</th>
              <th className="numeric">Passed</th>
              <th className="numeric">Confirm CH</th>
              <th className="numeric">Reported</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.round}</td>
                <td className="numeric">{formatCount(r.seats)}</td>
                <td className="numeric">{formatCount(r.applicants)}</td>
                <td className="numeric">{formatCount(r.passed)}</td>
                <td className="numeric">{formatCount(r.confirmCh)}</td>
                <td className="numeric">{formatCount(r.reported)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    };
  },

  tcas: (data) => {
    const tcas = data.tcas;
    if (!tcas) return null;
    const rows = tcas.history;
    if (rows.length === 0) return null;
    return {
      title: 'TCAS score history',
      caption: `Source: tcas-connector · peer-programs-scraper · ${data.dateLabel}`,
      table: (
        <table className="appendix-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Round</th>
              <th className="numeric">Quota</th>
              <th className="numeric">Applicants</th>
              <th className="numeric">Competition</th>
              <th className="numeric">Fill rate</th>
              <th className="numeric">Min score</th>
              <th className="numeric">Max score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h, i) => (
              <tr key={i}>
                <td>{h.yearBE !== null ? `BE ${h.yearBE}` : '—'}</td>
                <td>{h.round}</td>
                <td className="numeric">{formatCount(h.quota)}</td>
                <td className="numeric">{formatCount(h.applicants)}</td>
                <td className="numeric">{formatScore(h.competition)}</td>
                <td className="numeric">{formatPct(h.fillRate)}</td>
                <td className="numeric">{formatScore(h.minScore)}</td>
                <td className="numeric">{formatScore(h.maxScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    };
  },

  'cohort-distribution': (data) => {
    const cohortDistribution = data.cohortDistribution;
    if (!cohortDistribution) return null;
    const rows = cohortDistribution.rows;
    if (rows.length === 0) return null;
    return {
      title: 'Cohort distribution — by entry year',
      caption: `Source: kku-registry (student_cohort_distributions) · ${data.dateLabel}`,
      table: (
        <table className="appendix-table">
          <thead>
            <tr>
              <th>Cohort</th>
              <th>Year in programme</th>
              <th>Status</th>
              <th className="numeric">Students</th>
              <th className="numeric">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  {r.cohortBE !== null
                    ? `BE ${r.cohortBE}${r.cohortCE !== null ? ` (CE ${r.cohortCE})` : ''}`
                    : '—'}
                </td>
                <td>{r.yearInProgram !== null ? `Year ${r.yearInProgram}` : '—'}</td>
                <td>{r.status}</td>
                <td className="numeric">{formatCount(r.students)}</td>
                <td className="numeric">{formatPct(r.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    };
  },

  'demographic-outlook': (data) => {
    const demographic = data.demographic;
    if (!demographic) return null;
    const rows = demographic.projections;
    if (rows.length === 0) return null;
    return {
      title: 'Demographic outlook — cohort projection',
      caption: `Source: ${demographic.source} · ${data.dateLabel}`,
      table: (
        <table className="appendix-table">
          <thead>
            <tr>
              <th>Year</th>
              <th className="numeric">Cohort population</th>
              <th className="numeric">Change vs today</th>
              <th className="numeric">Share needed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={i}>
                <td>
                  {p.year ?? '—'}
                  {p.isCurrentYear ? ' (today)' : ''}
                </td>
                <td className="numeric">{formatCount(p.cohortPopulation)}</td>
                <td className="numeric">{p.decline !== null ? formatCohortChangePct(p.decline) : '—'}</td>
                <td className="numeric">{formatPct(p.shareNeeded)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    };
  },

  outcomes: (data) => {
    const outcomes = data.outcomes;
    if (!outcomes) return null;
    const rows = outcomes.salaryTrajectory;
    if (rows.length === 0) return null;
    return {
      title: 'Outcomes — salary trajectory by graduation year',
      caption: `Source: graduate-employment-survey · method ${outcomes.methodologyVersion} · ${data.dateLabel}`,
      table: (
        <table className="appendix-table">
          <thead>
            <tr>
              <th>Graduation year</th>
              <th className="numeric">Average salary (THB / month)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.year ?? '—'}</td>
                <td className="numeric">{formatCount(r.salary)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    };
  },

  skills: (data) => {
    const skills = data.skills;
    if (!skills) return null;
    const rows = skills.demanded;
    if (rows.length === 0) return null;
    return {
      title: 'Skills coverage — top demanded skills',
      caption: `Source: ${skills.demandSource} · demand tier ${skills.demandTier} · ${data.dateLabel}`,
      table: (
        <table className="appendix-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th className="numeric">Peak demand</th>
              <th className="numeric">Careers</th>
              <th>Curriculum match</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={i}>
                <td>{s.skill}</td>
                <td className="numeric">{formatPct(s.peakDemand)}</td>
                <td className="numeric">{formatCount(s.careerCount)}</td>
                <td>{matchLabel(s.match)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    };
  },

  faculty: (data) => {
    const faculty = data.faculty;
    if (!faculty) return null;
    const rows = faculty.rankDistribution;
    if (rows.length === 0) return null;
    return {
      title: 'Faculty capability — rank distribution',
      caption: `Source: kku-hr · roster scope ${faculty.rosterScope} · ${data.dateLabel}`,
      table: (
        <table className="appendix-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th className="numeric">Count</th>
              <th className="numeric">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.rank}</td>
                <td className="numeric">{formatCount(r.count)}</td>
                <td className="numeric">{formatPct(r.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    };
  },

  financials: (data) => {
    const financials = data.financials;
    if (!financials) return null;
    const rows = financials.waterfall;
    if (rows.length === 0) return null;
    return {
      title:
        financials.headlineFiscalYear !== null
          ? `Financials — revenue to net contribution, FY ${financials.headlineFiscalYear}`
          : 'Financials — revenue to net contribution',
      caption: `Source: kku-finance (cost-allocation) · method ${financials.methodologyVersion} · ${data.dateLabel}`,
      table: (
        <table className="appendix-table">
          <thead>
            <tr>
              <th>Step</th>
              <th className="numeric">Value (THB)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b, i) => (
              <tr key={i}>
                <td>
                  {b.step}
                  {b.isTotal ? ' (total)' : ''}
                </td>
                <td className="numeric">{formatCount(b.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    };
  },
};

export function renderAppendix(data: ProgramDetailData): React.ReactElement {
  let sectionIndex = 0;
  const entries: React.ReactElement[] = [];

  for (const section of SECTIONS) {
    if (section.render(data) === null) continue;
    sectionIndex += 1;
    if (!section.chartLed) continue;

    const built = APPENDIX_TABLES[section.id]?.(data);
    if (!built) continue;

    // `.appendix-entry` (magazine-css.ts) carries BOTH `counter-increment:
    // appendix-item` and, here, an inline `counter-reset` on the SAME
    // element. Per the CSS counters spec, `counter-reset` is always
    // applied before `counter-increment`/`counter-set` regardless of
    // declaration order, so the value the `::before` rule reads is
    // (reset value) + 1 — seeding to `sectionIndex - 1` is what makes the
    // displayed "B.N" equal this entry's real originating section number.
    entries.push(
      <div className="appendix-entry" style={{ counterReset: `appendix-item ${sectionIndex - 1}` }} key={section.id}>
        <h3>
          <span className="appendix-number" />
          {built.title}
        </h3>
        {built.table}
        <p className="caption">{built.caption}</p>
      </div>,
    );
  }

  return (
    <section className="appendix">
      <h2>Appendix B — Data tables</h2>
      <p className="chart-lede" lang="th">
        {LEDE_TH}
      </p>
      {entries.length === 0 ? (
        <p className="muted">
          No chart-led section produced any figures for this program yet — every table above is
          already the full precision figure set.
        </p>
      ) : (
        entries
      )}
    </section>
  );
}
