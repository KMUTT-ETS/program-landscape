import { Prisma } from '@prisma/client';
import { prisma } from './index';
import { realDataWhere } from './data-quality';
import { OCCUPATION_SKILL_DEMAND_FLOOR } from './jobthai-bridge';
import { jobThaiGenericSkills } from './jobthai';

// ─────────────────────────────────────────────────────────────────────────────
// "What's coming" for a gap-map row (spec §6): the LinkedIn-via-MHESI growth
// signal reached through the field's occupations' skills (no career→field
// mapping invented), and Trends Radar signals reached through the field's
// programmes or through an initiative that names one of its occupations.
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldGlobalSignal {
  /**
   * Each pick carries its OWN series. Read `scope` here, not the aggregate
   * below, whenever a figure is shown next to its skill: a GLOBAL pick is a
   * global figure even when a sibling pick in the same trio is Thai.
   */
  skills: Array<{
    skillId: string;
    nameEn: string;
    nameTh: string;
    growthPct: number;
    scope: 'THAILAND' | 'GLOBAL';
    /**
     * How many KMITL context rows (career / sub_group / group) `growthPct` was
     * averaged over, within the newest capture — see buildGrowthIndex. 1 means
     * the figure is a single raw observation, not a mean at all; it is still
     * surfaced (no minimum-context floor is applied here — see the comment at
     * the ranking site in pickGrowth), so a reader who wants to distinguish a
     * thin figure from a broad one must look at this count.
     */
    contexts: number;
  }>;
  /**
   * Aggregate label for the whole trio — THAILAND when ANY pick is Thai,
   * GLOBAL when they are all global fallbacks, null when nothing intersected.
   * Kept because gap-map.ts's row shape already exposes it; it is a coarse
   * "is there any Thai evidence here" flag and must NOT be rendered as though
   * it described every figure in `skills`.
   */
  scope: 'THAILAND' | 'GLOBAL' | null;
  /**
   * The KMITL capture every figure above was measured in (YYYY-MM-DD), or null
   * when nothing was picked. Optional so gap-map.ts's empty-row literal still
   * satisfies the type.
   */
  snapshotDate?: string | null;
}

export interface FieldTrendSignal {
  id: string;
  title: string;
  signalType: string;
  impactScore: number;
  detectedDate: string;
  matchedBy: 'programme' | 'initiative';
}

export interface GrowthRow {
  skillId: string;
  dataScope: 'THAILAND' | 'GLOBAL';
  growthPct: number;
  /** Which KMITL capture this row belongs to. Only the newest one is quotable. */
  snapshotAt: Date;
  /** Which slice of the KMITL taxonomy the figure was measured over: 'career',
   *  'sub_group' or 'group'. One skill appears once per context it is demanded in. */
  contextLevel: string;
}

export const GLOBAL_SIGNAL_TOP_N = 3;

/** One quotable figure: a skill's growth in one series, in one capture. */
export interface GrowthFigure {
  dataScope: 'THAILAND' | 'GLOBAL';
  /** Mean across the contexts the skill appears in — see buildGrowthIndex. */
  growthPct: number;
  /** How many contexts that mean is over. 1 means a single narrow context. */
  contexts: number;
}

export interface GrowthIndex {
  /** The newest snapshot found in the input; null when the input was empty. */
  newestSnapshot: Date | null;
  /** skillId → its figure in each series present in that newest snapshot. */
  bySkill: Map<string, GrowthFigure[]>;
}

/**
 * Pure: collapse the raw growth table into one quotable figure per
 * (skill, series). Built ONCE per request and reused for every field.
 *
 * Two rules, both of them defensibility rather than convenience:
 *
 * 1. **Newest snapshot only.** `kmitl_skill_growths` accumulates captures —
 *    its unique key is (contextLevel, contextId, skillNameRaw, dataScope) with
 *    no `snapshotAt`, and the raw skill-name string drifts between runs, so an
 *    older capture's rows are never superseded and simply sit alongside the
 *    current ones. On dev (2026-09-16) the table held 16,795 provenance-tagged
 *    rows across two captures, 2026-07-20 and 2026-09-14. Reading across both
 *    let July's figure be quoted as today's: "Digital marketing" returned
 *    July's 600% while the current capture's figure for the same skill was
 *    279.41%. A skill absent from the newest capture is stale and is not
 *    quoted at all rather than quoted from an old one.
 * 2. **Mean across contexts, not max.** A skill appears once per KMITL context
 *    it is demanded in (median 3 contexts, p90 12, max 181 on dev). Taking the
 *    highest was cherry-picking the single most flattering career bucket; the
 *    mean is the skill's growth across the contexts that actually demand it,
 *    and it is explainable in one sentence to Council.
 */
export function buildGrowthIndex(rows: readonly GrowthRow[]): GrowthIndex {
  let newest: Date | null = null;
  for (const r of rows) if (newest === null || r.snapshotAt > newest) newest = r.snapshotAt;
  const bySkill = new Map<string, GrowthFigure[]>();
  if (newest === null) return { newestSnapshot: null, bySkill };
  const newestMs = newest.getTime();
  const sums = new Map<string, Map<'THAILAND' | 'GLOBAL', { sum: number; n: number }>>();
  for (const r of rows) {
    if (r.snapshotAt.getTime() !== newestMs) continue;
    const perScope = sums.get(r.skillId) ?? new Map<'THAILAND' | 'GLOBAL', { sum: number; n: number }>();
    const acc = perScope.get(r.dataScope) ?? { sum: 0, n: 0 };
    acc.sum += r.growthPct;
    acc.n += 1;
    perScope.set(r.dataScope, acc);
    sums.set(r.skillId, perScope);
  }
  for (const [skillId, perScope] of sums) {
    bySkill.set(
      skillId,
      [...perScope].map(([dataScope, acc]) => ({ dataScope, growthPct: acc.sum / acc.n, contexts: acc.n })),
    );
  }
  return { newestSnapshot: newest, bySkill };
}

/**
 * Pure: THAILAND per skill, GLOBAL fallback, generic skills out, top N rising.
 * Walks the field's own skills against a prebuilt index rather than rescanning
 * the whole growth table once per field.
 */
export function pickGrowth(
  index: GrowthIndex,
  fieldSkillIds: Set<string>,
  genericSkillIds: Set<string>,
): {
  picked: Array<{ skillId: string; growthPct: number; scope: 'THAILAND' | 'GLOBAL'; contexts: number }>;
  scope: 'THAILAND' | 'GLOBAL' | null;
} {
  const candidates: Array<{ skillId: string; growthPct: number; scope: 'THAILAND' | 'GLOBAL'; contexts: number }> = [];
  for (const skillId of fieldSkillIds) {
    if (genericSkillIds.has(skillId)) continue;
    const figures = index.bySkill.get(skillId);
    const chosen = figures?.find((f) => f.dataScope === 'THAILAND') ?? figures?.[0];
    if (!chosen || chosen.growthPct <= 0) continue;
    candidates.push({ skillId, growthPct: chosen.growthPct, scope: chosen.dataScope, contexts: chosen.contexts });
  }
  // Ranked by growth magnitude alone, thin and broad figures side by side. A
  // 1-context figure competes here against one averaged over 181 contexts —
  // measured on dev, 2026-09-16: 598 of 1,788 skills have exactly one context.
  // Excluding thin figures below some minimum context count is an open
  // methodology decision (belongs in docs/methodologies/, with Council
  // sign-off), not made here — this function surfaces every figure with its
  // true `contexts` count instead, so a caller can apply or explain the
  // absence of a floor rather than being handed an unmarked number.
  const picked = candidates
    .sort((a, b) => b.growthPct - a.growthPct || a.skillId.localeCompare(b.skillId))
    .slice(0, GLOBAL_SIGNAL_TOP_N);
  if (picked.length === 0) return { picked: [], scope: null };
  return { picked, scope: picked.some((p) => p.scope === 'THAILAND') ? 'THAILAND' : 'GLOBAL' };
}

export async function globalSignalForFields(
  fieldIds: string[],
  occupationIdsByField: Map<string, string[]>,
): Promise<Map<string, FieldGlobalSignal>> {
  const result = new Map<string, FieldGlobalSignal>();
  const allOcc = [...new Set([...occupationIdsByField.values()].flat())];
  if (fieldIds.length === 0 || allOcc.length === 0) return result;
  // `jobthai_occupation_skills` carries no `ingestion_run_id` column at all, so
  // this read cannot be realDataWhere()-gated — there is nothing to gate on.
  // `kmitl_skill_growths` is different: it DOES carry `ingestion_run_id`
  // (see KmitlSkillGrowth in schema.prisma, populated by every write in
  // apps/ingestion/src/connectors/sources/kmitl-skill-mapping/connector.ts),
  // so it is gated below — matching the long-standing read of the same table
  // in computeOpportunities() (gap-analysis.ts).
  const [occSkills, growth, generic] = await Promise.all([
    prisma.jobThaiOccupationSkill.findMany({
      where: { jobThaiOccupationId: { in: allOcc }, share: { gte: OCCUPATION_SKILL_DEMAND_FLOOR } },
      select: { jobThaiOccupationId: true, skillId: true },
    }),
    prisma.kmitlSkillGrowth.findMany({
      where: { skillId: { not: null }, ...realDataWhere() },
      select: { skillId: true, dataScope: true, growthPct: true, snapshotAt: true, contextLevel: true },
    }),
    jobThaiGenericSkills(),
  ]);
  const skillsByOcc = new Map<string, string[]>();
  for (const r of occSkills) skillsByOcc.set(r.jobThaiOccupationId, [...(skillsByOcc.get(r.jobThaiOccupationId) ?? []), r.skillId]);
  const growthRows: GrowthRow[] = growth.map((g) => ({
    skillId: g.skillId!,
    dataScope: g.dataScope,
    growthPct: g.growthPct,
    snapshotAt: g.snapshotAt,
    contextLevel: g.contextLevel,
  }));
  // Built once for the whole request — every field then looks up only its own
  // skills, instead of each field rescanning all ~17k rows.
  const index = buildGrowthIndex(growthRows);
  const snapshotDate = index.newestSnapshot ? index.newestSnapshot.toISOString().slice(0, 10) : null;
  const pickedIds = new Set<string>();
  const perField = new Map<string, ReturnType<typeof pickGrowth>>();
  for (const fieldId of fieldIds) {
    const fieldSkills = new Set((occupationIdsByField.get(fieldId) ?? []).flatMap((o) => skillsByOcc.get(o) ?? []));
    const r = pickGrowth(index, fieldSkills, generic.generic);
    perField.set(fieldId, r);
    for (const p of r.picked) pickedIds.add(p.skillId);
  }
  const names = await prisma.skill.findMany({ where: { id: { in: [...pickedIds] } }, select: { id: true, nameEn: true, nameTh: true } });
  const nameById = new Map(names.map((n) => [n.id, n]));
  for (const [fieldId, r] of perField) {
    result.set(fieldId, {
      scope: r.scope,
      snapshotDate: r.picked.length > 0 ? snapshotDate : null,
      skills: r.picked.map((p) => ({
        skillId: p.skillId,
        nameEn: nameById.get(p.skillId)?.nameEn ?? p.skillId,
        nameTh: nameById.get(p.skillId)?.nameTh ?? '',
        growthPct: p.growthPct,
        scope: p.scope,
        contexts: p.contexts,
      })),
    });
  }
  return result;
}

const TOKEN_SPLIT = /[\s/,()·&-]+/;
const norm = (s: string) => s.trim().toLowerCase();
/**
 * Words of at least four characters — the same floor MIN_FIELD_LENGTH uses.
 * It barely bites on the Thai side: Thai has no inter-word spaces, so a Thai
 * role name survives splitting as one long unsegmented compound well above the
 * floor ("นักวิเคราะห์ข้อมูลการตลาดดิจิทัล" is a single token). What it
 * actually trims is short English filler — "and", "of", "the", "for". It is
 * therefore NOT the defence against generic vocabulary; genericRoleTokens()
 * below is, because the words that overmatch ("data", "business") are all
 * comfortably above any length floor.
 */
const tokens = (s: string) => norm(s).split(TOKEN_SPLIT).filter((t) => t.length >= 4);

/**
 * A role-side word is generic once it reaches more than this share of the
 * fields in the taxonomy — measured, not hand-listed, the same way
 * GENERIC_SKILL_OCCUPATION_SHARE (jobthai-bridge.ts) derives generic skills
 * from how many occupations demand them.
 *
 * The threshold is half that constant's 0.2 because the denominator is coarser:
 * there are 71 broad fields, not hundreds of narrow occupations, so reaching a
 * tenth of all FIELDS already means the word spans unrelated domains.
 *
 * Measured on dev, 2026-09-16, over the 37 distinct role tokens the nine live
 * trend signals produce. Only 7 reach any field at all, and they fall into two
 * clearly separated clusters:
 *
 *     business 11/71 (15%)   analyst 10/71 (14%)
 *     marketing 9/71 (13%)   data    9/71 (13%)      ← generic
 *     ----------------------------------------- 0.10 threshold
 *     digital   6/71 (8%)                            ← discriminating
 *     supply    1/71 (1%)    chain   1/71 (1%)
 *
 * 0.10 sits in the gap between 12.7% and 8.5%. It removes the four words that
 * were reaching unrelated fields through composite occupation labels — the
 * token "data" or "analyst" inside "งาน data scientist/data engineer/data
 * analyst" is what paired a Digital Marketing initiative with Biology,
 * Mathematics and Agricultural Science — while leaving "digital" to match the
 * six genuinely digital-marketing-adjacent fields, and leaving "supply" and
 * "chain" to make their single narrow match each.
 */
export const GENERIC_ROLE_TOKEN_FIELD_SHARE = 0.1;

/**
 * Pure: which role-side words carry no discriminating power over this
 * taxonomy. A word is generic when the share of fields whose occupation list
 * contains it anywhere exceeds `share`.
 */
export function genericRoleTokens(
  roles: Iterable<string>,
  occupationNamesByField: Iterable<readonly string[]>,
  share: number = GENERIC_ROLE_TOKEN_FIELD_SHARE,
): Set<string> {
  const candidates = new Set<string>();
  for (const role of roles) for (const t of tokens(role)) candidates.add(t);
  const fields = [...occupationNamesByField].map((names) => names.map(norm));
  const generic = new Set<string>();
  if (fields.length === 0 || candidates.size === 0) return generic;
  for (const token of candidates) {
    let hit = 0;
    for (const names of fields) if (names.some((n) => n.includes(token))) hit += 1;
    if (hit / fields.length > share) generic.add(token);
  }
  return generic;
}

const NO_GENERIC_TOKENS: ReadonlySet<string> = new Set<string>();

/**
 * Pure: does any initiative's unmet role name one of the occupations?
 *
 * Only the ROLE side is split into words ("logistics coordinator" →
 * ["logistics", "coordinator"]) and tested against each occupation's WHOLE
 * normalised label — the occupation side is deliberately never tokenised.
 * A live measurement on 2026-09-16 showed why: JobThai occupation labels are
 * often a "/"-joined composite of several sub-buckets (e.g.
 * "หัวหน้า/ผู้จัดการ/ผู้บริหาร" — head/manager/executive), and splitting
 * that into standalone words let one signal ("Corporate AI Risk and
 * Governance Manager", unmetRoleTh starting "ผู้บริหารจัดการ...") match via
 * the single word "ผู้บริหาร" — a generic 6-grapheme (9-UTF-16-unit) term
 * for "executive" carried by roughly 70% of fields' occupation lists, not a
 * short-token artefact (raising the length floor would not have removed it:
 * the word is already well above any floor in this file). Requiring the
 * WHOLE occupation label to appear in the role text, instead of any one of
 * its slash-separated pieces, keeps the genuine narrow matches (a specific
 * role word found inside a broader occupation label, e.g. "logistics" inside
 * "Logistics / Supply Chain") while dropping the generic-bucket false
 * positive.
 *
 * That was necessary but not sufficient: common ENGLISH business words still
 * reached through the same composite labels. On dev, 2026-09-16, the signal
 * whose unmet role is "Digital Marketing Data Analyst" matched 20 of 71
 * fields — Biology, Mathematics and Agricultural Science among them — because
 * "data" and "analyst" are substrings of the unrelated composite label "งาน
 * data scientist/data engineer/data analyst". `genericRoleTokens` passed in as
 * `generic` removes those words, derived from the taxonomy rather than
 * hand-listed. The default is empty so a caller that has not measured a
 * taxonomy gets the unfiltered behaviour rather than a silent stoplist.
 */
export function matchInitiativeToOccupations(
  initiatives: Array<{ unmetRoleTh?: string | null; unmetRoleEn?: string | null }> | null | undefined,
  occupationNames: string[],
  generic: ReadonlySet<string> = NO_GENERIC_TOKENS,
): boolean {
  if (!initiatives || initiatives.length === 0) return false;
  const occFulls = occupationNames.map(norm);
  for (const i of initiatives) {
    for (const role of [i.unmetRoleTh, i.unmetRoleEn]) {
      if (!role) continue;
      const full = norm(role);
      const words = tokens(role).filter((w) => !generic.has(w));
      for (const occFull of occFulls) {
        if (words.some((w) => occFull.includes(w))) return true;
        if (full.includes(occFull)) return true;
      }
    }
  }
  return false;
}

export const TREND_SIGNALS_PER_FIELD = 5;

export async function trendSignalsForFields(
  fields: Array<{ fieldId: string; programIds: string[]; occupationNames: string[] }>,
): Promise<Map<string, FieldTrendSignal[]>> {
  const result = new Map<string, FieldTrendSignal[]>();
  if (fields.length === 0) return result;
  const allPrograms = [...new Set(fields.flatMap((f) => f.programIds))];
  const signals = await prisma.trendSignal.findMany({
    where: {
      OR: [
        ...(allPrograms.length ? [{ affectedProgramIds: { hasSome: allPrograms } }] : []),
        { newInitiativesJson: { not: Prisma.DbNull } },
      ],
    },
    select: { id: true, title: true, signalType: true, impactScore: true, detectedDate: true, affectedProgramIds: true, newInitiativesJson: true },
    orderBy: [{ impactScore: 'desc' }, { detectedDate: 'desc' }],
  });
  const initiativesOf = (json: unknown): Array<{ unmetRoleTh?: string | null; unmetRoleEn?: string | null }> =>
    Array.isArray(json) ? (json as Array<{ unmetRoleTh?: string | null; unmetRoleEn?: string | null }>) : [];
  // Derived once from the roles these signals actually name, measured against
  // the occupation lists of the fields actually in play — so the stoplist
  // tracks the taxonomy instead of being a hand-kept list that rots.
  const roles: string[] = [];
  for (const s of signals) {
    for (const i of initiativesOf(s.newInitiativesJson)) {
      if (i.unmetRoleTh) roles.push(i.unmetRoleTh);
      if (i.unmetRoleEn) roles.push(i.unmetRoleEn);
    }
  }
  const generic = genericRoleTokens(roles, fields.map((f) => f.occupationNames));
  for (const f of fields) {
    const mine = new Set(f.programIds);
    const list: FieldTrendSignal[] = [];
    for (const s of signals) {
      const byProgramme = s.affectedProgramIds.some((id) => mine.has(id));
      const byInitiative =
        !byProgramme && matchInitiativeToOccupations(initiativesOf(s.newInitiativesJson), f.occupationNames, generic);
      if (!byProgramme && !byInitiative) continue;
      list.push({ id: s.id, title: s.title, signalType: s.signalType, impactScore: s.impactScore, detectedDate: s.detectedDate.toISOString().slice(0, 10), matchedBy: byProgramme ? 'programme' : 'initiative' });
      if (list.length >= TREND_SIGNALS_PER_FIELD) break;
    }
    result.set(f.fieldId, list);
  }
  return result;
}
