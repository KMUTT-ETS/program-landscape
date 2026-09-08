// What a Council-facing research figure has to say about Google Scholar.
//
// CLIENT-SAFE SUBPATH. Published as `@kku/shared/scholar/disclosure` for the
// same reason `./scholar/parse` is: the wording has to be identical on the
// web deep-dive (a client component, which cannot import the root barrel),
// in the Gotenberg `program-detail` PDF, on the print view, and in the AUN-QA
// evidence pack. Four copies of a caveat is four caveats that drift, and the
// one that drifts is the one nobody is reading when it matters. Pure strings
// and arithmetic — no `node:*`, no SDK imports. Keep it that way.
//
// WHY A FIGURE NEEDS THIS AT ALL.
// `research_outputs` has two writers. The library pipeline (`kku-research`,
// mirroring Scopus + PubMed) imports on a schedule for everybody. The Google
// Scholar runner imports ON DEMAND, for one person, when that person — or an
// administrator acting for them — presses a button. A roll-up over a roster
// can therefore move without anything about the underlying research changing.
// See `docs/methodologies/health-score.md` §"Mixed-source research data".

/** The writer being disclosed, as a reader should see it named. */
export const SCHOLAR_SOURCE_LABEL = 'Google Scholar';

/**
 * Structural mirror of `ResearchSourceComposition` in `@kku/db`, which
 * imports this type rather than declaring its own — one shape, so a figure
 * and its disclosure can never describe different populations.
 */
export interface ScholarComposition {
  /** Staff in the set with at least one Scholar-sourced row. */
  staffOnScholar: number;
  /** Staff in the set with at least one row from any source. The denominator. */
  staffWithResearch: number;
  /** Papers on the set attributed to the Scholar writer. */
  papersFromScholar: number;
  /** Papers on the set from every writer, Scholar included. */
  papersTotal: number;
  /**
   * LIBRARY rows whose citation count a Scholar import has raised.
   *
   * This is the number that makes "excludes Scholar rows" an incomplete
   * statement rather than a reassuring one. `applyMergePlan` raises citations
   * on matched EXISTING rows and leaves their `source` and `ingestion_run_id`
   * alone, so those rows keep passing `realDataWhere()`. An analysis that
   * excludes Scholar-sourced rows and weights papers by citations — which
   * `program-research-expertise.scoreOf()` does — still feels the import.
   */
  libraryPapersTouchedByScholar: number;
  /** What the staff denominator counts. Rendered verbatim, never paraphrased. */
  denominator: string;
}

/**
 * What kind of figure is being disclosed.
 *
 * Chosen at each CALL SITE rather than derived from a flag, because only the
 * call site knows whether its figure is citation-weighted. Getting this wrong
 * produces a caveat that is confidently false, which is worse than none.
 */
export type ScholarFigureKind =
  /** The figure counts Scholar-sourced rows directly. */
  | 'counts-scholar-rows'
  /**
   * The figure excludes Scholar-sourced rows (it filters on ingestion-run
   * provenance, which the on-demand import does not stamp) AND weights papers
   * by citation count — so a Scholar import still reaches it, through the
   * library rows whose citations the merge raises.
   */
  | 'excludes-rows-citation-weighted';

const nf = (n: number): string => n.toLocaleString('en-US');

/** "0 of 18 staff · 0 of 1,235 papers" — the ratio pair, numbers only. */
export function scholarRatioText(c: ScholarComposition): string {
  return `${nf(c.staffOnScholar)} of ${nf(c.staffWithResearch)} staff · ${nf(
    c.papersFromScholar,
  )} of ${nf(c.papersTotal)} papers`;
}

/**
 * The caveat for a figure that counts Scholar rows.
 *
 * States the direction of the distortion and refuses to imply it has been
 * corrected for, because it has not — see the methodology doc for why no
 * normalisation would be defensible.
 */
export function scholarInclusionCaveat(): string {
  return (
    `${SCHOLAR_SOURCE_LABEL} counts run higher than the curated library mirror — it indexes ` +
    'preprints, theses and non-indexed venues that Scopus and PubMed do not. Staff who ' +
    'import their own profile therefore appear more productive than colleagues who have ' +
    'not. This is not corrected for.'
  );
}

/**
 * The caveat for a figure that excludes Scholar ROWS but is citation-weighted.
 *
 * Excluding the rows does not exclude the effect, and a drawer that says only
 * "excludes Google Scholar" is row-accurate and reader-wrong.
 */
export function scholarCitationEffectCaveat(c: ScholarComposition): string {
  const head =
    `Excluding ${SCHOLAR_SOURCE_LABEL} rows does not exclude their effect: importing a profile also ` +
    'raises citation counts on existing library rows, and this analysis weights papers by ' +
    'citations. An import can therefore change which papers and themes surface here.';
  return c.libraryPapersTouchedByScholar === 0
    ? `${head} No library paper on this roster has been raised by an import yet.`
    : `${head} ${nf(c.libraryPapersTouchedByScholar)} library ${
        c.libraryPapersTouchedByScholar === 1 ? 'paper' : 'papers'
      } on this roster ${
        c.libraryPapersTouchedByScholar === 1 ? 'has' : 'have'
      } been raised this way.`;
}

/** The caveat matching `kind`. */
export function scholarCaveat(c: ScholarComposition, kind: ScholarFigureKind): string {
  return kind === 'counts-scholar-rows'
    ? scholarInclusionCaveat()
    : scholarCitationEffectCaveat(c);
}

/**
 * A single self-contained sentence for a surface with no provenance drawer to
 * open — the print view, the Gotenberg `program-detail` PDF, and the AUN-QA
 * evidence pack. Those are the artefacts that leave the building, so they
 * cannot rely on a reader clicking anything.
 *
 * Returns `null` when there is nothing to disclose: no staff on this roster
 * has imported a profile and no library citation has been raised, so the
 * figure is exactly what the library pipeline produced. A caveat printed in
 * that state is noise, and noise is how a real caveat gets skipped. The
 * on-screen provenance drawer still shows the zeros, so "nothing to disclose"
 * and "nobody checked" stay distinguishable where there is room for both.
 */
export function scholarDisclosureLine(
  c: ScholarComposition,
  kind: ScholarFigureKind,
): string | null {
  if (c.staffOnScholar === 0 && c.libraryPapersTouchedByScholar === 0) return null;
  if (kind === 'counts-scholar-rows') {
    return (
      `Includes ${SCHOLAR_SOURCE_LABEL} records imported on demand by staff themselves: ` +
      `${scholarRatioText(c)}. ${scholarInclusionCaveat()}`
    );
  }
  return scholarCitationEffectCaveat(c);
}
