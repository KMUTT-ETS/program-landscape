import { describe, expect, it } from 'vitest';
import {
  SCHOLAR_SOURCE_LABEL,
  scholarCaveat,
  scholarCitationEffectCaveat,
  scholarDisclosureLine,
  scholarInclusionCaveat,
  scholarRatioText,
  type ScholarComposition,
} from '../src/scholar/disclosure';

const base: ScholarComposition = {
  staffOnScholar: 0,
  staffWithResearch: 18,
  papersFromScholar: 0,
  papersTotal: 1235,
  libraryPapersTouchedByScholar: 0,
  denominator: 'staff on this roster with at least one publication on file, from any source',
};
const c = (over: Partial<ScholarComposition> = {}): ScholarComposition => ({ ...base, ...over });

describe('scholarRatioText', () => {
  it('states both ratios, each with its own unit word', () => {
    expect(scholarRatioText(c({ staffOnScholar: 3, staffWithResearch: 41, papersFromScholar: 180, papersTotal: 900 })))
      .toBe('3 of 41 staff · 180 of 900 papers');
  });

  // Adjacent numbers and words run together when read; the unit word after
  // each ratio is what keeps "3 of 41" and "180 of 900" from reading as one
  // token in a printed line.
  it('separates the two ratios with a unit word on each side', () => {
    const t = scholarRatioText(c());
    expect(t).toContain(' staff · ');
    expect(t.endsWith(' papers')).toBe(true);
  });

  it('groups thousands so a five-figure count is readable', () => {
    expect(scholarRatioText(c({ papersTotal: 1235 }))).toContain('1,235 papers');
  });
});

describe('scholarInclusionCaveat', () => {
  it('names the direction of the distortion and refuses to imply a correction', () => {
    const t = scholarInclusionCaveat();
    expect(t).toContain('run higher');
    expect(t).toContain('appear more productive');
    expect(t).toContain('not corrected for');
  });
});

// The finding this module exists to encode: excluding Scholar ROWS does not
// exclude Scholar's EFFECT. `applyMergePlan` raises citation counts on
// existing LIBRARY rows, which keep their `ingestion_run_id` and so pass
// `realDataWhere()`; `program-research-expertise.scoreOf()` weights papers by
// citations. A drawer saying only "excludes Google Scholar" is row-accurate
// and reader-wrong.
describe('scholarCitationEffectCaveat', () => {
  it('says the exclusion is of rows, and that the effect still lands', () => {
    const t = scholarCitationEffectCaveat(c());
    expect(t).toContain('does not exclude their effect');
    expect(t).toContain('raises citation counts on existing library rows');
    expect(t).toContain('weights papers by citations');
  });

  it('says plainly when no library paper has been raised yet', () => {
    expect(scholarCitationEffectCaveat(c({ libraryPapersTouchedByScholar: 0 })))
      .toContain('No library paper on this roster has been raised by an import yet.');
  });

  it('quantifies the effect once there is one', () => {
    expect(scholarCitationEffectCaveat(c({ libraryPapersTouchedByScholar: 12 })))
      .toContain('12 library papers on this roster have been raised this way.');
  });

  it('agrees with itself in the singular', () => {
    const t = scholarCitationEffectCaveat(c({ libraryPapersTouchedByScholar: 1 }));
    expect(t).toContain('1 library paper on this roster has been raised this way.');
    expect(t).not.toContain('papers on this roster has');
  });
});

describe('scholarCaveat', () => {
  it('routes by kind', () => {
    expect(scholarCaveat(c(), 'counts-scholar-rows')).toBe(scholarInclusionCaveat());
    expect(scholarCaveat(c(), 'excludes-rows-citation-weighted')).toBe(
      scholarCitationEffectCaveat(c()),
    );
  });

  // The contradiction this parameter exists to prevent: a drawer that says
  // "this figure excludes Google Scholar" must not also say "staff who import
  // appear more productive", because on that surface they do not — the effect
  // arrives by a different route and the honest sentence is a different one.
  it('never tells an excluded figure that importers look more productive', () => {
    expect(scholarCaveat(c(), 'excludes-rows-citation-weighted')).not.toContain(
      'appear more productive',
    );
  });
});

describe('scholarDisclosureLine', () => {
  // Dev's actual state, and the ordinary state of most rosters: nobody has
  // imported and no citation has moved. A caveat printed then is noise, and
  // noise is how a real caveat gets skipped.
  it('is null when there is genuinely nothing to disclose', () => {
    expect(scholarDisclosureLine(c(), 'counts-scholar-rows')).toBeNull();
    expect(scholarDisclosureLine(c(), 'excludes-rows-citation-weighted')).toBeNull();
  });

  it('fires on a raised citation even with no Scholar-sourced row', () => {
    const only = c({ libraryPapersTouchedByScholar: 4 });
    expect(scholarDisclosureLine(only, 'counts-scholar-rows')).not.toBeNull();
    expect(scholarDisclosureLine(only, 'excludes-rows-citation-weighted')).not.toBeNull();
  });

  it('carries the numbers and the caveat in one self-contained sentence', () => {
    const t = scholarDisclosureLine(
      c({ staffOnScholar: 3, staffWithResearch: 41, papersFromScholar: 180, papersTotal: 900 }),
      'counts-scholar-rows',
    );
    // A printed artefact has no drawer to open, so everything a reader needs
    // has to be in this string.
    expect(t).toContain(SCHOLAR_SOURCE_LABEL);
    expect(t).toContain('3 of 41 staff · 180 of 900 papers');
    expect(t).toContain('imported on demand by staff themselves');
    expect(t).toContain('not corrected for');
  });
});
