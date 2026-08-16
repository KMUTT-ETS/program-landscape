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

// The cover's health-score and data-completeness stats are read straight
// off `data.healthOverallScore` / `data.healthOverallCompletenessPct` —
// dedicated numeric companions the builder computes once, directly from
// `overview.health.overall.{score,dataCompletenessPct}`
// (apps/api/src/programs/program-detail-data.ts). This component must
// NOT re-derive the composite from `healthDimensions` (e.g. averaging
// the per-dimension scores itself) — that would be a second, template-
// side implementation of the health-score methodology that can silently
// drift from the backend's own number, and nobody reading the PDF would
// be able to tell which figure was right. A template displays; it does
// not compute.
function statValueClass(isNull: boolean): string {
  return isNull ? 'stat-value muted' : 'stat-value';
}

export function renderCoverPage(data: ProgramDetailData): React.ReactElement {
  const healthScore = data.healthOverallScore;
  const completenessPct = data.healthOverallCompletenessPct;
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
          <span className={statValueClass(healthScore === null)}>{formatScore(healthScore)}</span>
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
          <span className={statValueClass(completenessPct === null)}>
            {formatPct(completenessPct)}
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
