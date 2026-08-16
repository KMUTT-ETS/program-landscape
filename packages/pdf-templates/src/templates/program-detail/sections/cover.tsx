import * as React from 'react';

import { formatPct, formatScore } from '../format';
import type { ProgramDetailData } from '../schema';

// Program-detail's cover — a magazine identity block on a KKU Cardinal
// band, distinct from the plain centered `<Cover>` used by council-pack
// etc. (`src/components/cover.tsx`). This file owns its own layout
// (`.cover-band`, `.cover-kicker`, `.cover-code`, `.cover-faculty`,
// `.cover-standfirst`, `.cover-foot` in magazine-css.ts) but reuses the
// outer `.cover-page` shell and `.title-th`/`.title-en` typography from
// base-css.ts rather than restating them.
const REPORT_KICKER =
  'Program Landscape — KKU Curriculum Intelligence Platform · Program detail report (internal)';

const STANDFIRST_TH =
  'รายงานฉบับนี้รวบรวมคะแนนสุขภาพหลักสูตร แนวโน้มวงจรชีวิต อุปสงค์และอุปทานตลาดแรงงาน ' +
  'ผลลัพธ์บัณฑิต และสถานะการเงินของหลักสูตรไว้ในฉบับเดียว สำหรับใช้ประกอบการทบทวนเชิงกลยุทธ์ของคณะกรรมการ';

interface OverallHealth {
  score: number | null;
  completenessPct: number | null;
}

// `ProgramDetailData` carries the per-dimension health breakdown
// (`healthDimensions`) but no pre-computed *overall* score or
// completeness figure. The only place an overall number exists today is
// `executiveSnapshot`'s display-only `KvRowSchema` row — and schema.ts's
// own top-of-file comment forbids parsing that back into a number
// ("never charted, never parsed back out"). That same comment names the
// sanctioned fix for exactly this situation: "add a separate, dedicated
// numeric field next to the KV row" (the pattern already used for
// `aiReadiness.subScoreValues`, `cohortDistribution.summaryValues`,
// `faculty.seniorRankSharePct`). Adding that field means touching
// schema.ts and program-detail-data.ts, which this task is explicitly
// scoped to leave alone.
//
// Pending that follow-up, this mirrors the exact formula the backend
// already uses for the composite — `combineDimensions()` in
// `packages/db/src/health-score.ts`: the mean of the non-null dimension
// scores (dimensions with no data are excluded, never treated as 0),
// and completeness averaged across all dimensions (0 counts here — an
// unmeasured dimension is 0% complete, a true measured value, not a
// missing one). It runs against numbers already on this payload
// (`healthDimensions`), so nothing is invented — but because those
// numbers are already rounded per-dimension by the builder, the result
// can drift by about a point from the backend's own `overall.score`
// (computed from unrounded inputs before rounding). See the Task 4
// implementation report for the recommended schema addition that would
// remove this drift entirely.
function deriveOverallHealth(dimensions: ProgramDetailData['healthDimensions']): OverallHealth {
  if (dimensions.length === 0) return { score: null, completenessPct: null };

  const scored = dimensions.filter((d) => d.score !== null);
  const score =
    scored.length === 0
      ? null
      : Math.round(scored.reduce((sum, d) => sum + (d.score ?? 0), 0) / scored.length);

  const completenessSum = dimensions.reduce((sum, d) => sum + (d.dataCompleteness ?? 0), 0);
  const completenessPct = Math.round(completenessSum / dimensions.length);

  return { score, completenessPct };
}

function statValueClass(isNull: boolean): string {
  return isNull ? 'stat-value muted' : 'stat-value';
}

export function renderCoverPage(data: ProgramDetailData): React.ReactElement {
  const overall = deriveOverallHealth(data.healthDimensions);
  const verdict = data.lifecycle?.verdict ?? null;
  const trajectoryScore = data.lifecycle?.trajectoryScore ?? null;

  return (
    <section className="cover-page">
      <div className="cover-band">
        <p className="cover-kicker">{REPORT_KICKER}</p>
        <h1 className="title-th">{data.nameTh}</h1>
        <p className="title-en" lang="en">
          {data.nameEn}
        </p>
        <p className="cover-code">{data.programCode}</p>
        <p className="cover-faculty">
          {data.facultyTh} ({data.facultyEn})
        </p>
      </div>

      <div className="stat-block">
        <div className="stat" data-stat="health">
          <span className={statValueClass(overall.score === null)}>
            {formatScore(overall.score)}
          </span>
          <span className="stat-label">Health score / 100</span>
        </div>

        <div className="stat" data-stat="lifecycle">
          <span className={statValueClass(verdict === null)}>{verdict ?? '—'}</span>
          <span className="stat-label">
            Lifecycle verdict
            {trajectoryScore !== null ? ` · trajectory ${formatScore(trajectoryScore)}` : ''}
          </span>
        </div>

        <div className="stat" data-stat="completeness">
          <span className={statValueClass(overall.completenessPct === null)}>
            {formatPct(overall.completenessPct)}
          </span>
          <span className="stat-label">Data completeness</span>
        </div>
      </div>

      <p className="cover-standfirst" lang="th">
        {STANDFIRST_TH}
      </p>

      <div className="cover-foot">
        <p className="date">
          Generated {data.generatedAtLabel} · Data as of {data.dateLabel}
        </p>
        <p className="muted">
          Methodology {data.methodologyVersion}
          {data.lifecycle ? ` · ${data.lifecycle.methodologyVersion}` : ''}
        </p>
      </div>
    </section>
  );
}
