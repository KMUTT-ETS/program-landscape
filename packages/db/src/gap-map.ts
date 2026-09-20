import { Prisma } from '@prisma/client';
import { JOBTHAI_ANY_FIELD } from '@kku/shared/src/jobthai';
import { PRIVATE_DEMAND_SOURCE, PUBLIC_DEMAND_SOURCE } from '@kku/shared';
import { prisma } from './index';
import { getAcademicYearContext } from './academic-year';
import { realDataSql, realDataWhere } from './data-quality';
import { getProgramScoreIndex } from './health-score';
import { eligiblePostingLevels } from './jobthai-bridge';
import {
  GAP_MAP_VERSION,
  GAP_VERDICTS,
  NOMINAL_DURATION_FALLBACK,
  NOMINAL_DURATION_YEARS,
  annualisedIntake,
  parseDemandBasis,
  pipelineArrow,
  publicWindowStart,
  reconcile,
  verdictFor,
  type DemandBasisOptions,
  type GapThresholds,
  type GapVerdict,
  type PipelineArrow,
} from './gap-map-rules';
import {
  globalSignalForFields,
  trendSignalsForFields,
  type FieldGlobalSignal,
  type FieldTrendSignal,
} from './gap-map-signals';

// ─────────────────────────────────────────────────────────────────────────────
// The demand-first gap map — `gap-map.v2` (spec §4 for the original v1 design;
// docs/superpowers/specs/2026-09-20-job108-government-demand-design.md for the
// job-108 basis this module now also computes).
//
// One row per canonical field of study. Demand share = eligible postings
// naming any synonym ÷ field-mentions (Σ over fields of that count), computed
// against a caller-selected demand BASIS — `private` (JobThai only, the only
// basis v1 ever computed), `public` (job-108 government postings only,
// windowed), or `all`/blended (the v2 default: private + public). Supply
// share = graduates/yr of the field's scored programmes ÷ field-graduates
// (Σ over fields of that count) — unchanged by the basis. Verdict = share vs
// share (gap-map-rules). See docs/methodologies/gap-map.md for why each basis
// needs its own denominator and why a `gap-map.v1` share is not comparable to
// a `gap-map.v2` share of the same field.
//
// "Eligible" is the bachelor universe: postings whose minimum education
// level admits a bachelor's graduate (eligiblePostingLevels('BACHELOR')).
// Postgraduate programmes are LISTED inside rows with their graduates, but
// never scored — only 41 of 47,631 postings state a postgraduate minimum,
// so any verdict on them would be built from undergraduate adverts (the
// honest-signal gate the JobThai bridge already applies).
// ─────────────────────────────────────────────────────────────────────────────

export type GapMapScope = 'university' | 'faculty' | 'department';

/** A programme the JobThai bridge links to an occupation, resolved to its
 *  names HERE rather than left as an id for the page to look up.
 *
 *  The page used to receive ids and resolve them against the field's own
 *  programme list, falling back to the raw id when that missed — and it
 *  missed most of the time, because `program_jobthai_links` links an
 *  occupation to any programme whose stated field of study matches, not
 *  only to the programmes of the field being read. Readers saw cuids. */
export interface GapMapOccupationProgramme {
  programId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  /** True when this programme is one of the ones assigned to the field
   *  this occupation is being listed under. False means the occupation
   *  also recruits from elsewhere in KKU — real signal, so the page says
   *  it in words rather than hiding the entry. */
  inField: boolean;
}

export interface GapMapOccupation {
  occupationId: string;
  code: string;
  category: string;
  subcategory: string;
  postings: number;
  /** A sample, never the whole list: up to `LINKED_PROGRAMME_SAMPLE` from
   *  inside the field and as many again from outside it, strongest link
   *  first. One occupation carries up to 41 links on dev, and a row holds
   *  twelve occupations — the full lists would dominate the payload. The
   *  two counts below are what the page renders "and N more" from. */
  linkedProgrammes: GapMapOccupationProgramme[];
  linkedInField: number;
  linkedOutsideField: number;
}

/** An occupation before its links are resolved. "Inside the field" is only
 *  answerable once we know which field the occupation is being listed
 *  under, so the link sample is attached per row, not per occupation. */
type OccupationBase = Omit<GapMapOccupation, 'linkedProgrammes' | 'linkedInField' | 'linkedOutsideField'>;

export interface GapMapProgramme {
  programId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: string;
  facultyId: string | null;
  facultyNameEn: string | null;
  gradsPerYear: number | null;
  supplySource: 'alumni' | 'enrolment-proxy' | null;
  /** How many entry cohorts the alumni mean was taken over. Null unless
   *  `supplySource === 'alumni'` — a figure that rests on two cohorts and
   *  one that rests on six must not read alike. */
  supplyCohorts: number | null;
  /** The academic year the enrolment fallback was read from (CE). Null
   *  unless `supplySource === 'enrolment-proxy'`. The reach-back can be
   *  long — 2006 at the far end on dev — so the year is carried with the
   *  figure rather than left to look like last year's. */
  supplyYear: number | null;
  /** As recorded on the programme; null means the nominal figure for the
   *  level was used (`NOMINAL_DURATION_YEARS`). */
  durationYears: number | null;
  pipeline: number | null;
  healthScore: number | null;
  /** false for postgraduate programmes and for programmes outside the scope. */
  scored: boolean;
  /** Assignment review state — the row's provenance says "unreviewed" when any is PROPOSED. */
  reviewStatus: 'PROPOSED' | 'APPROVED';
}

export interface GapMapRow {
  slug: string;
  nameTh: string;
  nameEn: string;
  reviewStatus: 'PROPOSED' | 'APPROVED';
  postings: number;
  demandShare: number;
  /** This field's share of eligible JobThai-only postings, normalised by
   *  `privateFieldMentions` — computed on every row regardless of the
   *  active `demand.basis`, so a viewer switching bases sees the
   *  alternative without a second read. */
  privateDemandShare: number;
  /** This field's share of eligible job-108 postings inside the public
   *  window, normalised by `publicFieldMentions` — same "always computed"
   *  rule as `privateDemandShare`. */
  publicDemandShare: number;
  /** Distinct eligible JobThai postings naming this field (unwindowed —
   *  JobThai carries no real posted date). */
  privatePostings: number;
  /** Distinct eligible job-108 postings naming this field, inside the
   *  active public window. */
  publicPostings: number;
  supplyShare: number;
  ratio: number | null;
  verdict: GapVerdict;
  gradsPerYear: number | null;
  pipeline: number | null;
  pipelineArrow: PipelineArrow | null;
  programmeCount: number;
  /** Of `programmeCount` scored programmes, how many carry a supply
   *  figure (alumni or enrolment-proxy). A partial gap (e.g. 2 of 3)
   *  still gets a normal verdict; only a total absence (0) suppresses
   *  one — see `verdict: 'supply-unknown'`. */
  programmesWithSupply: number;
  /** Listed but never scored because they are postgraduate. A white space
   *  with one of these is not a field KKU is absent from — the collapsed
   *  row has to say so, or "Programmes: —" reads as "nothing here". */
  postgraduateProgrammes: number;
  signalCount: number;
  /** Present only when scope ≠ university: the same field scored over all of KKU. */
  kkuTotal: { supplyShare: number; ratio: number | null; verdict: GapVerdict } | null;
  provinces: Array<{ province: string; share: number }>;
  occupations: GapMapOccupation[];
  programmes: GapMapProgramme[];
  facultyIds: string[];
  globalSignal: FieldGlobalSignal;
  trendSignals: FieldTrendSignal[];
}

export interface GapMapResult {
  methodologyVersion: typeof GAP_MAP_VERSION;
  computedAt: string;
  scope: { level: GapMapScope; id: string | null; label: string | null };
  thresholds: GapThresholds;
  /** The demand basis this result was computed under, plus the resolved
   *  window start (ISO date) so a shared link is self-explaining without
   *  the reader having to re-derive it from `computedAt`. */
  demand: DemandBasisOptions & { publicWindowFrom: string };
  rows: GapMapRow[];
  verdictCounts: Record<GapVerdict, number>;
  facultyStrip: Array<{ facultyId: string; nameTh: string; nameEn: string; counts: Record<GapVerdict, number> }>;
  reconciliation: {
    eligiblePostings: number;
    /** Distinct eligible postings naming at least one field. */
    fieldPostings: number;
    /** Σ_f postings_f — the demand denominator FOR THE ACTIVE BASIS; ≥ fieldPostings. */
    fieldMentions: number;
    /** Σ_f postings_f over JobThai only, whatever the active basis — see
     *  `GapMapRow.privateDemandShare`. */
    privateFieldMentions: number;
    /** Σ_f postings_f over job-108 only, inside the public window, whatever
     *  the active basis — see `GapMapRow.publicDemandShare`. */
    publicFieldMentions: number;
    /** Eligible postings whose fields overlap ≥ 2 non-rejected taxonomy rows. */
    multiFieldPostings: number;
    anyFieldPostings: number;
    otherKinds: number;
    otherMentions: number;
    postgraduatePostings: number;
    demandShareSum: number;
    supplyShareSum: number;
    multiFieldProgrammes: number;
    /** Σ_f grads_f over scored programmes — the supply denominator. */
    fieldGraduatesTotal: number;
    /** Distinct scored (bachelor, in-scope) programmes across all rows. */
    scoredProgrammes: number;
    /** How many of those carry a graduates-per-year figure at all. */
    scoredWithSupply: number;
    /** How many of `scoredWithSupply` came from the enrolment-metric
     *  fallback rather than alumni entry cohorts. The rest are alumni. */
    supplyFromProxy: number;
    /** Distinct job-108 announcements inside the public window (any
     *  education level, whether or not they named a field). An
     *  announcement can carry several positions. */
    publicAnnouncements: number;
    /** job-108 postings (one row per position) inside the public window. */
    publicPositions: number;
    /** Σ of `position_count` across those postings — reported, and NEVER
     *  weighted into a share: JobThai has no headcount column, so weighting
     *  public seats against private adverts of unknown size would
     *  over-weight the public side by an unknowable factor. */
    publicSeats: number;
  };
  taxonomy: { approved: number; proposed: number };
  freshness: { postingsAsOf: string | null; taxonomyAsOf: string | null };
}

const BACHELOR_LEVELS = eligiblePostingLevels('BACHELOR');
const POSTGRAD_LEVELS = eligiblePostingLevels('MASTER');

/** How many entry cohorts the alumni mean may be taken over, at most. The
 *  window is anchored on each programme's OWN newest graduatable cohort
 *  (`currentAcademicYearBE - duration`) and reaches this many years back, so
 *  a six-year programme gets as many cohorts to average as a four-year one.
 *  A single global anchor starved them: on dev it sat at BE 2567, leaving
 *  every 5- and 6-year bachelor programme exactly two cohorts against a
 *  four-year programme's four. */
const SUPPLY_WINDOW_COHORTS = 6;

/** How many linked programmes an occupation carries per group (inside the
 *  field, outside it). The page names these and says how many more there
 *  are; it never truncates silently. */
const LINKED_PROGRAMME_SAMPLE = 3;

/** `COALESCE(duration_years, <nominal for the level>)` — the SQL twin of
 *  `durationYearsFor`, built from the same constants so the cohort window
 *  and the pipeline arrow can never read a programme as different lengths. */
const durationYearsSql = Prisma.sql`COALESCE(p.duration_years, CASE p.level::text ${Prisma.join(
  Object.entries(NOMINAL_DURATION_YEARS).map(([level, years]) => Prisma.sql`WHEN ${level} THEN ${years}::int`),
  ' ',
)} ELSE ${NOMINAL_DURATION_FALLBACK}::int END)::int`;

export async function scopeProgramIds(scope: GapMapScope, scopeId: string | null): Promise<string[] | null> {
  if (scope === 'university' || !scopeId) return null;
  const rows = await prisma.program.findMany({
    where: scope === 'faculty' ? { facultyId: scopeId } : { departmentId: scopeId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

function emptyCounts(): Record<GapVerdict, number> {
  return Object.fromEntries(GAP_VERDICTS.map((v) => [v, 0])) as Record<GapVerdict, number>;
}

export async function computeGapMap(args: {
  scope: GapMapScope;
  scopeId: string | null;
  thresholds: GapThresholds;
  now?: Date;
  /** Which source(s) form the demand denominator. Defaults to the blended
   *  basis (`parseDemandBasis({})` — see `@kku/shared/demand/sources` for
   *  why `all` is the default). */
  demand?: DemandBasisOptions;
}): Promise<GapMapResult> {
  const now = args.now ?? new Date();
  const demand = args.demand ?? parseDemandBasis({});
  const windowStart = publicWindowStart(now, demand.publicWindowMonths);
  const { currentAcademicYearBE } = await getAcademicYearContext(now);
  const inScope = await scopeProgramIds(args.scope, args.scopeId);
  const inScopeSet = inScope ? new Set(inScope) : null;

  // One gate, used by every demand query, so the three bases cannot
  // disagree about which rows they count. The window applies to public
  // rows only: JobThai postings are undated — postedDateEstimated is true
  // on all 47,631, they carry their batch receipt date — so windowing them
  // would silently drop the entire private side.
  const sourceGate = (alias: string): Prisma.Sql => {
    const a = Prisma.raw(alias);
    const privateGate = Prisma.sql`${a}.source = ${PRIVATE_DEMAND_SOURCE}`;
    const publicGate = Prisma.sql`(${a}.source = ${PUBLIC_DEMAND_SOURCE} AND ${a}.posted_date >= ${windowStart})`;
    if (demand.basis === 'private') return privateGate;
    if (demand.basis === 'public') return publicGate;
    return Prisma.sql`(${privateGate} OR ${publicGate})`;
  };

  // ── Demand ────────────────────────────────────────────────────────────────
  const fields = await prisma.jobFieldTaxonomy.findMany({
    where: { reviewStatus: { in: ['APPROVED', 'PROPOSED'] } },
    select: { id: true, slug: true, nameTh: true, nameEn: true, reviewStatus: true, updatedAt: true },
    orderBy: { slug: 'asc' },
  });
  // Single join pass: the demand-per-field count used to be its own query
  // (`demandRows`), re-running the same job_field_taxonomy ⋈ job_postings
  // join the province query below already does. Every eligible posting has
  // exactly one province (COALESCE'd to '(unknown)'), so summing the
  // per-(field, province) postings count over provinces for a fixed field
  // gives the same distinct-posting total as grouping by field alone —
  // `postingsByField` / `fieldMentions` are derived from `provinceRows`
  // instead of a fourth pass. Cross-checked against a one-pass
  // per-posting field count in the DB test.
  const [universe, provinceRows, sourceRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        eligible: number;
        field_naming: number;
        multi_field: number;
        any_field: number;
        postgraduate: number;
        other_kinds: number;
        other_mentions: number;
        as_of: Date | null;
      }>
    >(Prisma.sql`
      WITH eligible AS (
        SELECT jp.id, jp.required_fields_raw, jp.freshness_date
        FROM job_postings jp
        WHERE ${sourceGate('jp')}
          AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS}::text[])
          AND ${realDataSql('jp')}
      ),
      field_counts AS (
        SELECT e.id, COUNT(DISTINCT f.id)::int AS n_fields
        FROM eligible e
        JOIN job_field_taxonomy f ON f.review_status IN ('APPROVED','PROPOSED') AND e.required_fields_raw && f.synonyms
        GROUP BY e.id
      ),
      other AS (
        SELECT s FROM eligible e, unnest(e.required_fields_raw) AS s
        WHERE s <> ${JOBTHAI_ANY_FIELD}
          AND NOT EXISTS (SELECT 1 FROM job_field_taxonomy f WHERE f.review_status IN ('APPROVED','PROPOSED') AND s = ANY(f.synonyms))
      )
      SELECT
        (SELECT COUNT(*)::int FROM eligible) AS eligible,
        (SELECT COUNT(*)::int FROM field_counts) AS field_naming,
        (SELECT COUNT(*)::int FROM field_counts WHERE n_fields > 1) AS multi_field,
        (SELECT COUNT(*)::int FROM eligible WHERE ${JOBTHAI_ANY_FIELD} = ANY(required_fields_raw)) AS any_field,
        (SELECT COUNT(*)::int FROM job_postings jp WHERE ${sourceGate('jp')} AND jp.min_education_level::text = ANY(${POSTGRAD_LEVELS}::text[]) AND ${realDataSql('jp')}) AS postgraduate,
        (SELECT COUNT(DISTINCT s)::int FROM other) AS other_kinds,
        (SELECT COUNT(*)::int FROM other) AS other_mentions,
        (SELECT MAX(freshness_date) FROM eligible) AS as_of
    `),
    prisma.$queryRaw<Array<{ field_id: string; province: string; postings: number }>>(Prisma.sql`
      SELECT f.id AS field_id, COALESCE(jp.province, '(unknown)') AS province, COUNT(DISTINCT jp.id)::int AS postings
      FROM job_field_taxonomy f
      JOIN job_postings jp ON jp.required_fields_raw && f.synonyms
      WHERE f.review_status IN ('APPROVED', 'PROPOSED')
        AND ${sourceGate('jp')}
        AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS}::text[])
        AND ${realDataSql('jp')}
      GROUP BY f.id, COALESCE(jp.province, '(unknown)')
    `),
    // Per-field postings, split by source, spanning BOTH sources — always,
    // regardless of `demand.basis`. Every row carries its private and its
    // public share alongside whichever one is active, so a viewer flipping
    // the URL parameter sees the alternative without a second round trip.
    // The public side is windowed here exactly as `sourceGate('public')`
    // windows it; the private side is not, for the same reason `sourceGate`
    // never windows it (JobThai postings carry no real date).
    prisma.$queryRaw<Array<{ field_id: string; source: string; postings: number }>>(Prisma.sql`
      SELECT f.id AS field_id, jp.source AS source, COUNT(DISTINCT jp.id)::int AS postings
      FROM job_field_taxonomy f
      JOIN job_postings jp ON jp.required_fields_raw && f.synonyms
      WHERE f.review_status IN ('APPROVED', 'PROPOSED')
        AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS}::text[])
        AND ${realDataSql('jp')}
        AND (
          jp.source = ${PRIVATE_DEMAND_SOURCE}
          OR (jp.source = ${PUBLIC_DEMAND_SOURCE} AND jp.posted_date >= ${windowStart})
        )
      GROUP BY f.id, jp.source
    `),
  ]);
  const u = universe[0] ?? {
    eligible: 0,
    field_naming: 0,
    multi_field: 0,
    any_field: 0,
    postgraduate: 0,
    other_kinds: 0,
    other_mentions: 0,
    as_of: null,
  };
  const postingsByField = new Map<string, number>();
  for (const r of provinceRows) postingsByField.set(r.field_id, (postingsByField.get(r.field_id) ?? 0) + r.postings);

  // Each side normalised by ITS OWN sum of per-field numerators — never the
  // other side's, and never `fieldMentions` (the active basis's sum). A
  // posting naming k fields counts k times on whichever side it sits, so
  // `privateFieldMentions` and `publicFieldMentions` are two separate sums,
  // neither derivable from the other or from the active-basis total.
  const privateByField = new Map<string, number>();
  const publicByField = new Map<string, number>();
  for (const r of sourceRows) {
    const target = r.source === PRIVATE_DEMAND_SOURCE ? privateByField : r.source === PUBLIC_DEMAND_SOURCE ? publicByField : null;
    if (target) target.set(r.field_id, (target.get(r.field_id) ?? 0) + r.postings);
  }
  const privateFieldMentions = [...privateByField.values()].reduce((n, v) => n + v, 0);
  const publicFieldMentions = [...publicByField.values()].reduce((n, v) => n + v, 0);

  // ── Normalisation rule (docs/methodologies/gap-map.md) ────────────────────
  // A posting that accepts several fields is demand for each of them; a
  // programme assigned to two fields supplies both. Both sides are therefore
  // normalised by the sum over fields (field-mentions / field-graduates), so
  // shares sum to 100 % on each side and the ratio is unbiased. The
  // reconciliation line reports how many postings and programmes are counted
  // more than once (`multiFieldPostings`, `multiFieldProgrammes`). `postings`
  // per row stays the raw distinct-posting count — the too-few-postings floor
  // and the displayed number are unaffected.
  const fieldMentions = [...postingsByField.values()].reduce((n, v) => n + v, 0);
  const provincesByField = new Map<string, Array<{ province: string; share: number }>>();
  for (const r of provinceRows) {
    const total = postingsByField.get(r.field_id) ?? 0;
    const list = provincesByField.get(r.field_id) ?? [];
    list.push({ province: r.province, share: total > 0 ? r.postings / total : 0 });
    provincesByField.set(r.field_id, list);
  }
  for (const list of provincesByField.values()) list.sort((a, b) => b.share - a.share).splice(5);

  // ── Occupations inside a row ──────────────────────────────────────────────
  // This join runs the same sourceGate as every other demand query — under
  // `all` or `public` a government posting is eligible in principle — but
  // job_category / job_subcategory are NULL on every job-108 row (the
  // government source carries no occupation classification), so the INNER
  // JOIN on jobthai_occupations excludes public rows by construction. That
  // is intended, not a gap: occupations feed the JobThai-only bridge
  // (program_jobthai_links), and government postings feed the field layer
  // only.
  const occRows = await prisma.$queryRaw<
    Array<{ field_id: string; occupation_id: string; code: string; category: string; subcategory: string; postings: number }>
  >(Prisma.sql`
    SELECT f.id AS field_id, o.id AS occupation_id, o.code, o.category, o.subcategory, COUNT(DISTINCT jp.id)::int AS postings
    FROM job_field_taxonomy f
    JOIN job_postings jp ON jp.required_fields_raw && f.synonyms
    JOIN jobthai_occupations o ON o.category = jp.job_category AND o.subcategory = jp.job_subcategory
    WHERE f.review_status IN ('APPROVED', 'PROPOSED')
      AND ${sourceGate('jp')}
      AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS}::text[])
      AND ${realDataSql('jp')}
    GROUP BY f.id, o.id, o.code, o.category, o.subcategory
    ORDER BY postings DESC
  `);
  // The programme names travel with the links, in the same pass that loads
  // them: whichever field an occupation is listed under, a linked programme
  // has a name here, so the page never has to guess one from an id.
  const links = await prisma.programJobThaiLink.findMany({
    where: realDataWhere(),
    select: {
      programId: true,
      jobThaiOccupationId: true,
      score: true,
      program: { select: { code: true, nameTh: true, nameEn: true } },
    },
  });
  const linkedByOcc = new Map<string, Array<Omit<GapMapOccupationProgramme, 'inField'> & { score: number }>>();
  for (const l of links) {
    const list = linkedByOcc.get(l.jobThaiOccupationId) ?? [];
    list.push({
      programId: l.programId,
      code: l.program.code,
      nameTh: l.program.nameTh,
      nameEn: l.program.nameEn,
      score: l.score,
    });
    linkedByOcc.set(l.jobThaiOccupationId, list);
  }
  // Strongest link first, so a sample of three is the three that matter.
  for (const list of linkedByOcc.values()) {
    list.sort((a, b) => b.score - a.score || a.nameEn.localeCompare(b.nameEn));
  }
  const occByField = new Map<string, OccupationBase[]>();
  for (const r of occRows) {
    const list = occByField.get(r.field_id) ?? [];
    if (list.length < 12) {
      list.push({
        occupationId: r.occupation_id,
        code: r.code,
        category: r.category,
        subcategory: r.subcategory,
        postings: r.postings,
      });
    }
    occByField.set(r.field_id, list);
  }

  // ── Supply ────────────────────────────────────────────────────────────────
  const assignments = await prisma.programJobField.findMany({
    where: { reviewStatus: { in: ['APPROVED', 'PROPOSED'] }, field: { reviewStatus: { in: ['APPROVED', 'PROPOSED'] } } },
    select: {
      fieldId: true,
      reviewStatus: true,
      program: {
        select: {
          id: true,
          code: true,
          nameTh: true,
          nameEn: true,
          level: true,
          durationYears: true,
          facultyId: true,
          faculty: { select: { nameEn: true } },
        },
      },
    },
  });
  const programById = new Map(assignments.map((a) => [a.program.id, a.program]));
  const assignedProgramIds = [...programById.keys()];
  // Graduates per year = the mean of the entry cohorts that COULD have
  // graduated, over however many of them there are (spec §4; corrected
  // 2026-09-19). Four rules make that sentence true:
  //
  //  1. The window is anchored PER PROGRAMME, on graduation. Its newest
  //     end is the newest cohort that programme could have finished,
  //     `currentAcademicYearBE - duration`, and it reaches
  //     SUPPLY_WINDOW_COHORTS years back from there. A single global
  //     `MAX(entry_year_be)` anchor (BE 2567 on dev, set by the shortest
  //     programmes) left every 5- and 6-year bachelor programme exactly
  //     two cohorts to average while four-year ones got up to four.
  //  2. A cohort is counted only once it could have graduated. A student
  //     entering 2565 on a 4-year programme is in year
  //     `current - entry + 1`, so they finish at the end of AY 2568 and
  //     2569 is the first year the cohort is complete. That is the same
  //     `entry <= current - duration` bound the window's top end uses.
  //  3. Length of study is the programme's own, and where it is not
  //     recorded the nominal figure for its LEVEL — never four years for
  //     a two-year Master's (`durationYearsSql`).
  //  4. The divisor is the number of cohorts actually averaged, not a
  //     hard-coded 5. Counting four cohorts and dividing by five under-
  //     reports by a fifth, which is most of the old shortfall.
  //
  // The enrolment proxy takes the newest year with a NON-ZERO figure
  // rather than simply the newest. On dev the newest row is an unfinished
  // AY 2026 for 226 programmes and reads 0 for every one of them — and
  // 2025 (28 programmes) and 2024 (5) are all-zero too, so excluding only
  // the current academic year would still hand 33 programmes a zero that
  // was never measured. A programme left with nothing comes out NULL and
  // the row's `supply-unknown` state says so honestly. The reach-back has
  // no floor, so the year it landed on travels with the figure: on dev it
  // ranges from AY 2025 down to AY 2006, and a nine-year-old number that
  // does not say its age is indistinguishable from last year's.
  const supplyRows =
    assignedProgramIds.length === 0
      ? []
      : await prisma.$queryRaw<
          Array<{
            program_id: string;
            supply: number | null;
            source: 'alumni' | 'enrolment-proxy' | null;
            cohorts: number | null;
            supply_year: number | null;
            duration_years: number;
          }>
        >(
          Prisma.sql`
    WITH prog AS (
      SELECT p.id AS program_id, ${durationYearsSql} AS duration_years
      FROM programs p
      WHERE p.id = ANY(${assignedProgramIds}::text[])
    ),
    alumni_cohorts AS (
      SELECT acs.program_id, acs.entry_year_be, SUM(acs.count)::float AS graduates
      FROM alumni_cohort_statuses acs
      JOIN prog ON prog.program_id = acs.program_id
      WHERE acs.status_bucket = 'GRADUATED'
        AND acs.entry_year_be <= ${currentAcademicYearBE} - prog.duration_years
        AND acs.entry_year_be >= ${currentAcademicYearBE} - prog.duration_years - ${SUPPLY_WINDOW_COHORTS - 1}
        AND ${realDataSql('acs')}
      GROUP BY acs.program_id, acs.entry_year_be
    ),
    alumni_per_program AS (
      SELECT program_id, SUM(graduates) / COUNT(*)::float AS graduates_per_year, COUNT(*)::int AS cohorts
      FROM alumni_cohorts
      GROUP BY program_id
    ),
    latest_grad AS (
      SELECT DISTINCT ON (program_id) program_id, graduated_on_time, academic_year
      FROM enrollment_metrics em
      WHERE em.graduated_on_time > 0 AND ${realDataSql('em')}
      ORDER BY program_id, academic_year DESC
    )
    SELECT
      prog.program_id,
      COALESCE(a.graduates_per_year, lg.graduated_on_time)::float AS supply,
      CASE WHEN a.graduates_per_year IS NOT NULL THEN 'alumni' WHEN lg.graduated_on_time IS NOT NULL THEN 'enrolment-proxy' ELSE NULL END AS source,
      a.cohorts,
      CASE WHEN a.graduates_per_year IS NULL THEN lg.academic_year ELSE NULL END AS supply_year,
      prog.duration_years
    FROM prog
    LEFT JOIN alumni_per_program a ON a.program_id = prog.program_id
    LEFT JOIN latest_grad lg ON lg.program_id = prog.program_id
  `,
        );
  const supplyById = new Map(
    supplyRows.map((r) => [
      r.program_id,
      {
        grads: r.supply == null ? null : Number(r.supply),
        source: r.source,
        cohorts: r.cohorts == null ? null : Number(r.cohorts),
        year: r.supply_year == null ? null : Number(r.supply_year),
      },
    ]),
  );
  const pipelineRows =
    assignedProgramIds.length === 0
      ? []
      : await prisma.studentCohortDistribution.groupBy({
          by: ['programId'],
          where: { programId: { in: assignedProgramIds }, ...realDataWhere() },
          _sum: { studentCount: true },
        });
  const pipelineById = new Map(pipelineRows.map((r) => [r.programId, r._sum.studentCount ?? 0]));
  const health = await getProgramScoreIndex();

  // Scored = bachelor and in scope. Supply denominators are field-graduates:
  // Σ over ASSIGNMENTS (not programmes) of the programme's graduates, so a
  // programme in two fields counts in both — the mirror of field-mentions.
  const scoredIds = new Set(
    assignedProgramIds.filter((id) => {
      const p = programById.get(id)!;
      return p.level === 'BACHELOR' && (inScopeSet ? inScopeSet.has(id) : true);
    }),
  );
  const kkuScoredIds = new Set(assignedProgramIds.filter((id) => programById.get(id)!.level === 'BACHELOR'));
  // `?? 0` here is correct and load-bearing for a SUM denominator: a
  // programme with no supply figure contributes nothing to the total,
  // which is exactly what summing "what is known" means. Do NOT read
  // `gradsOf(id) === 0` as "this programme measured zero graduates" —
  // use `hasSupply` for that distinction. verdictFor's `supply-unknown`
  // state fires when a field has zero SCORED programmes with a supply
  // figure at all, not when their (possibly-absent) figures sum to 0.
  const gradsOf = (id: string): number => supplyById.get(id)?.grads ?? 0;
  const hasSupply = (id: string): boolean => supplyById.get(id)?.grads != null;
  const fieldGraduatesTotal = assignments
    .filter((a) => scoredIds.has(a.program.id))
    .reduce((n, a) => n + gradsOf(a.program.id), 0);
  const kkuGradsTotal = assignments
    .filter((a) => kkuScoredIds.has(a.program.id))
    .reduce((n, a) => n + gradsOf(a.program.id), 0);

  // ── Rows ──────────────────────────────────────────────────────────────────
  const fieldIds = fields.map((f) => f.id);
  const [globalSignals, trendSignals] = await Promise.all([
    globalSignalForFields(
      fieldIds,
      new Map(fields.map((f) => [f.id, (occByField.get(f.id) ?? []).map((o) => o.occupationId)])),
    ),
    trendSignalsForFields(
      fields.map((f) => ({
        fieldId: f.id,
        programIds: assignments.filter((a) => a.fieldId === f.id).map((a) => a.program.id),
        occupationNames: (occByField.get(f.id) ?? []).map((o) => o.subcategory),
      })),
    ),
  ]);

  const rows: GapMapRow[] = fields.map((f) => {
    const postings = postingsByField.get(f.id) ?? 0;
    const demandShare = fieldMentions > 0 ? postings / fieldMentions : 0;
    const privatePostings = privateByField.get(f.id) ?? 0;
    const publicPostings = publicByField.get(f.id) ?? 0;
    // Each computed on every row, whatever the active basis, and each
    // normalised by its OWN sum — see the `privateFieldMentions` /
    // `publicFieldMentions` comment above.
    const privateDemandShare = privateFieldMentions > 0 ? privatePostings / privateFieldMentions : 0;
    const publicDemandShare = publicFieldMentions > 0 ? publicPostings / publicFieldMentions : 0;
    const mine = assignments.filter((a) => a.fieldId === f.id);
    const mineIds = new Set(mine.map((a) => a.program.id));
    const occupations: GapMapOccupation[] = (occByField.get(f.id) ?? []).map((o) => {
      const linked = linkedByOcc.get(o.occupationId) ?? [];
      const inField = linked.filter((p) => mineIds.has(p.programId));
      const outside = linked.filter((p) => !mineIds.has(p.programId));
      const sample = (list: typeof linked, isInField: boolean): GapMapOccupationProgramme[] =>
        list.slice(0, LINKED_PROGRAMME_SAMPLE).map((p) => ({
          programId: p.programId,
          code: p.code,
          nameTh: p.nameTh,
          nameEn: p.nameEn,
          inField: isInField,
        }));
      return {
        ...o,
        linkedProgrammes: [...sample(inField, true), ...sample(outside, false)],
        linkedInField: inField.length,
        linkedOutsideField: outside.length,
      };
    });
    const programmes: GapMapProgramme[] = mine
      .map((a) => {
        const s = supplyById.get(a.program.id);
        return {
          programId: a.program.id,
          code: a.program.code,
          nameTh: a.program.nameTh,
          nameEn: a.program.nameEn,
          level: a.program.level,
          facultyId: a.program.facultyId,
          facultyNameEn: a.program.faculty?.nameEn ?? null,
          gradsPerYear: s?.grads ?? null,
          supplySource: s?.source ?? null,
          supplyCohorts: s?.source === 'alumni' ? (s.cohorts ?? null) : null,
          supplyYear: s?.source === 'enrolment-proxy' ? (s.year ?? null) : null,
          durationYears: a.program.durationYears,
          pipeline: pipelineById.get(a.program.id) ?? null,
          healthScore: health.get(a.program.id)?.overall ?? null,
          scored: scoredIds.has(a.program.id),
          reviewStatus: a.reviewStatus === 'APPROVED' ? ('APPROVED' as const) : ('PROPOSED' as const),
        };
      })
      .sort((x, y) => (y.gradsPerYear ?? -1) - (x.gradsPerYear ?? -1));
    const scored = programmes.filter((p) => p.scored);
    const scoredWithSupply = scored.filter((p) => p.gradsPerYear != null).length;
    const grads = scored.reduce((n, p) => n + (p.gradsPerYear ?? 0), 0);
    const pipeline = scored.reduce((n, p) => n + (p.pipeline ?? 0), 0);
    const hasGrads = scored.some((p) => p.gradsPerYear != null);
    const hasPipeline = scored.some((p) => p.pipeline != null);
    // Annualised per programme, then summed — never the field's summed
    // pipeline over one nominal length. See `annualisedIntake`.
    const annualIntake = annualisedIntake(scored);
    const supplyShare = fieldGraduatesTotal > 0 ? grads / fieldGraduatesTotal : 0;
    const { ratio, verdict } = verdictFor({
      postings,
      programmes: scored.length,
      scoredWithSupply,
      demandShare,
      supplyShare,
      thresholds: args.thresholds,
    });

    let kkuTotal: GapMapRow['kkuTotal'] = null;
    if (inScopeSet) {
      const kkuScored = mine.filter((a) => kkuScoredIds.has(a.program.id));
      const kkuScoredWithSupply = kkuScored.filter((a) => hasSupply(a.program.id)).length;
      const kkuGrads = kkuScored.reduce((n, a) => n + gradsOf(a.program.id), 0);
      const kkuShare = kkuGradsTotal > 0 ? kkuGrads / kkuGradsTotal : 0;
      const v = verdictFor({
        postings,
        programmes: kkuScored.length,
        scoredWithSupply: kkuScoredWithSupply,
        demandShare,
        supplyShare: kkuShare,
        thresholds: args.thresholds,
      });
      kkuTotal = { supplyShare: kkuShare, ratio: v.ratio, verdict: v.verdict };
    }

    const signals = trendSignals.get(f.id) ?? [];
    return {
      slug: f.slug,
      nameTh: f.nameTh,
      nameEn: f.nameEn,
      reviewStatus: f.reviewStatus === 'APPROVED' ? 'APPROVED' : 'PROPOSED',
      postings,
      demandShare,
      privateDemandShare,
      publicDemandShare,
      privatePostings,
      publicPostings,
      supplyShare,
      ratio,
      verdict,
      gradsPerYear: hasGrads ? grads : null,
      pipeline: hasPipeline ? pipeline : null,
      pipelineArrow: pipelineArrow(hasGrads ? grads : null, annualIntake),
      programmeCount: scored.length,
      programmesWithSupply: scoredWithSupply,
      postgraduateProgrammes: programmes.filter((p) => !p.scored && p.level !== 'BACHELOR').length,
      signalCount: signals.length,
      kkuTotal,
      provinces: provincesByField.get(f.id) ?? [],
      occupations,
      programmes,
      // Restricted to SCORED programmes: an unscored (postgraduate, or
      // out-of-scope) programme merely listed under this field would
      // otherwise put its faculty in the strip for a field it
      // contributes nothing to.
      facultyIds: [...new Set(scored.map((p) => p.facultyId).filter((x): x is string => x != null))],
      globalSignal: globalSignals.get(f.id) ?? { skills: [], scope: null },
      trendSignals: signals,
    };
  });

  // ── Aggregates ────────────────────────────────────────────────────────────
  const verdictCounts = emptyCounts();
  for (const r of rows) verdictCounts[r.verdict] += 1;
  const facultyIds = [...new Set(rows.flatMap((r) => r.facultyIds))];
  const faculties = await prisma.faculty.findMany({
    where: { id: { in: facultyIds } },
    select: { id: true, nameTh: true, nameEn: true },
    orderBy: { nameEn: 'asc' },
  });
  const facultyStrip = faculties.map((fac) => {
    const counts = emptyCounts();
    for (const r of rows) if (r.facultyIds.includes(fac.id)) counts[r.verdict] += 1;
    return { facultyId: fac.id, nameTh: fac.nameTh, nameEn: fac.nameEn, counts };
  });
  const rec = reconcile(
    rows.map((r) => ({
      postings: r.postings,
      programmeIds: r.programmes.filter((p) => p.scored).map((p) => p.programId),
      gradsPerYear: r.gradsPerYear ?? 0,
    })),
    { fieldMentions, fieldGraduates: fieldGraduatesTotal },
  );
  // publicSeats is reported and NEVER weighted into a share: JobThai has no
  // headcount column, so weighting public seats against private adverts of
  // unknown size would over-weight the public side by an unknowable factor.
  const [publicTotals] = await prisma.$queryRaw<Array<{ announcements: number; positions: number; seats: number }>>(
    Prisma.sql`
      SELECT
        COUNT(DISTINCT jp.job108_announcement_id)::int AS announcements,
        COUNT(*)::int AS positions,
        COALESCE(SUM(jp.position_count), 0)::int AS seats
      FROM job_postings jp
      WHERE jp.source = ${PUBLIC_DEMAND_SOURCE}
        AND jp.posted_date >= ${windowStart}
        AND ${realDataSql('jp')}
    `,
  );
  const scopeLabel =
    args.scope === 'university' || !args.scopeId
      ? null
      : args.scope === 'faculty'
        ? ((await prisma.faculty.findUnique({ where: { id: args.scopeId }, select: { nameEn: true } }))?.nameEn ?? null)
        : ((await prisma.department.findUnique({ where: { id: args.scopeId }, select: { nameEn: true } }))?.nameEn ?? null);

  return {
    methodologyVersion: GAP_MAP_VERSION,
    computedAt: now.toISOString(),
    scope: { level: args.scope, id: args.scopeId, label: scopeLabel },
    thresholds: args.thresholds,
    // Date only, not a timestamp: the window is a day boundary, and carrying
    // the time of day would make this string differ between two requests a
    // second apart while implying a precision the rule does not have.
    demand: { ...demand, publicWindowFrom: windowStart.toISOString().slice(0, 10) },
    rows: rows.sort((a, b) => b.demandShare - a.demandShare),
    verdictCounts,
    facultyStrip,
    reconciliation: {
      eligiblePostings: u.eligible,
      fieldPostings: u.field_naming,
      fieldMentions,
      privateFieldMentions,
      publicFieldMentions,
      multiFieldPostings: u.multi_field,
      anyFieldPostings: u.any_field,
      otherKinds: u.other_kinds,
      otherMentions: u.other_mentions,
      postgraduatePostings: u.postgraduate,
      ...rec,
      // Distinct programmes, not assignments: `fieldGraduatesTotal` counts a
      // two-field programme twice (the mirror of field-mentions), but "how
      // many programmes is this total built from" has to count it once.
      scoredProgrammes: scoredIds.size,
      scoredWithSupply: [...scoredIds].filter((id) => hasSupply(id)).length,
      supplyFromProxy: [...scoredIds].filter((id) => supplyById.get(id)?.source === 'enrolment-proxy').length,
      publicAnnouncements: publicTotals?.announcements ?? 0,
      publicPositions: publicTotals?.positions ?? 0,
      publicSeats: publicTotals?.seats ?? 0,
    },
    taxonomy: {
      approved: fields.filter((f) => f.reviewStatus === 'APPROVED').length,
      proposed: fields.filter((f) => f.reviewStatus === 'PROPOSED').length,
    },
    freshness: {
      postingsAsOf: u.as_of ? new Date(u.as_of).toISOString() : null,
      taxonomyAsOf: fields.length ? new Date(Math.max(...fields.map((f) => f.updatedAt.getTime()))).toISOString() : null,
    },
  };
}
