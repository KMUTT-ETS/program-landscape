import * as React from 'react';
import type { TemplateDefinition } from '@kku/shared';

import { buildDeepDiveFooterHtml, buildDeepDiveHeaderHtml } from '../../components/deep-dive-page-furniture';
import { baseCss } from '../../styles/base-css';
import { magazineCss } from '../../styles/magazine-css';
import { renderTemplateToHtml } from '../../render';
import { renderAppendix } from './appendix';
import { ProgramDetailDataSchema, type ProgramDetailData } from './schema';
import { renderCoverPage } from './sections/cover';
import { SECTIONS } from './sections';

const VERSION = '2.0.0';

// The v2.0.0 rebuild — a thin assembler. Every rendering decision (chart
// choice, lede copy, provenance, empty-state wording) lives in
// `sections/*.tsx`; this file only sequences them: cover, then every
// numbered section from the shared `SECTIONS` manifest (`./sections`,
// also consumed by `appendix.tsx` so the two can never number sections
// differently), then the back-matter data appendix. The pre-rebuild
// version of this file was 2,160 lines of hand-rolled tables and inline
// visualisations — if this one grows past ~250 lines again, sequencing
// logic has leaked back in and belongs in a section file instead.
function ProgramDetailDoc({ data }: { data: ProgramDetailData }) {
  return (
    <>
      {renderCoverPage(data)}
      <div className="program-body">
        {SECTIONS.map((section) => (
          <React.Fragment key={section.id}>{section.render(data)}</React.Fragment>
        ))}
      </div>
      {renderAppendix(data)}
    </>
  );
}

export const programDetailTemplate: TemplateDefinition<ProgramDetailData> = {
  name: 'program-detail',
  version: VERSION,
  schema: ProgramDetailDataSchema,
  render(data) {
    const furniture = {
      programCode: data.programCode,
      programNameEn: data.nameEn,
      confidentialityLabel: 'Internal — analyst working document',
    };
    return {
      html: renderTemplateToHtml(<ProgramDetailDoc data={data} />),
      css: `${baseCss}\n${magazineCss}`,
      headerHtml: buildDeepDiveHeaderHtml(furniture),
      footerHtml: buildDeepDiveFooterHtml(furniture),
    };
  },
};
