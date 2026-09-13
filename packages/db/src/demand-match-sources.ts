// ─────────────────────────────────────────────────────────────────────────────
// Which labour-market source put a skill on a programme's demand checklist.
//
// `program_demand_matches` holds ONE AI decision per (programme, skill): does
// the curriculum teach it, and is it relevant to the discipline. From
// health-score.v5.2 the checklist is the union of LinkedIn-via-MHESI demand and
// JobThai demand, so a reader that means one source must say so — otherwise
// `demand_match_filled` (a LinkedIn driver) silently absorbs JobThai rows.
// ─────────────────────────────────────────────────────────────────────────────

/** LinkedIn via MHESI. The slug keeps its original ingestion-framework name. */
export const DEMAND_SOURCE_LINKEDIN = 'kmitl-skill-mapping';
export const DEMAND_SOURCE_JOBTHAI = 'jobthai';
export type DemandSourceSlug = typeof DEMAND_SOURCE_LINKEDIN | typeof DEMAND_SOURCE_JOBTHAI;

/** Prisma `where` fragment restricting match rows to one demand source. */
export function demandMatchSourceWhere(source: DemandSourceSlug): { demandSources: { has: string } } {
  return { demandSources: { has: source } };
}

/**
 * The run a match row is attributed to. LinkedIn wins when both sources demanded
 * the skill, because every row written before v5.2 was LinkedIn's and a
 * provenance that flips on re-run would read as a data change.
 */
export function demandMatchProvenanceSource(sources: ReadonlyArray<string>): DemandSourceSlug | null {
  if (sources.includes(DEMAND_SOURCE_LINKEDIN)) return DEMAND_SOURCE_LINKEDIN;
  if (sources.includes(DEMAND_SOURCE_JOBTHAI)) return DEMAND_SOURCE_JOBTHAI;
  return null;
}
