import { Prisma } from '@prisma/client';
import { JOBTHAI_ANY_FIELD } from '@kku/shared/src/jobthai';
import { prisma } from './index';
import { realDataSql, realDataWhere } from './data-quality';
import { getProgramScoreIndex } from './health-score';
import { eligiblePostingLevels } from './jobthai-bridge';
import {
  GAP_MAP_VERSION,
  GAP_VERDICTS,
  pipelineArrow,
  reconcile,
  verdictFor,
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
// The demand-first gap map — `gap-map.v1` (spec §4).
//
// One row per canonical field of study. Demand share = eligible postings
// naming any synonym ÷ field-mentions (Σ over fields of that count). Supply
// share = graduates/yr of the field's scored programmes ÷ field-graduates
// (Σ over fields of that count). Verdict = share vs share (gap-map-rules).
//
// "Eligible" is the bachelor universe: postings whose minimum education
// level admits a bachelor's graduate (eligiblePostingLevels('BACHELOR')).
// Postgraduate programmes are LISTED inside rows with their graduates, but
// never scored — only 41 of 47,631 postings state a postgraduate minimum,
// so any verdict on them would be built from undergraduate adverts (the
// honest-signal gate the JobThai bridge already applies).
// ─────────────────────────────────────────────────────────────────────────────

export type GapMapScope = 'university' | 'faculty' | 'department';

export interface GapMapOccupation {
  occupationId: string;
  code: string;
  category: string;
  subcategory: string;
  postings: number;
  linkedProgramIds: string[];
}

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
  supplyShare: number;
  ratio: number | null;
  verdict: GapVerdict;
  gradsPerYear: number | null;
  pipeline: number | null;
  pipelineArrow: PipelineArrow | null;
  programmeCount: number;
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
  rows: GapMapRow[];
  verdictCounts: Record<GapVerdict, number>;
  facultyStrip: Array<{ facultyId: string; nameTh: string; nameEn: string; counts: Record<GapVerdict, number> }>;
  reconciliation: {
    eligiblePostings: number;
    /** Distinct eligible postings naming at least one field. */
    fieldPostings: number;
    /** Σ_f postings_f — the demand denominator; ≥ fieldPostings. */
    fieldMentions: number;
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
    gradsTotal: number;
  };
  taxonomy: { approved: number; proposed: number };
  freshness: { postingsAsOf: string | null; taxonomyAsOf: string | null };
}

const BACHELOR_LEVELS = eligiblePostingLevels('BACHELOR');
const POSTGRAD_LEVELS = eligiblePostingLevels('MASTER');

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
}): Promise<GapMapResult> {
  const now = args.now ?? new Date();
  const inScope = await scopeProgramIds(args.scope, args.scopeId);
  const inScopeSet = inScope ? new Set(inScope) : null;

  // ── Demand ────────────────────────────────────────────────────────────────
  const fields = await prisma.jobFieldTaxonomy.findMany({
    where: { reviewStatus: { in: ['APPROVED', 'PROPOSED'] } },
    select: { id: true, slug: true, nameTh: true, nameEn: true, reviewStatus: true, updatedAt: true },
    orderBy: { slug: 'asc' },
  });
  const [demandRows, universe, provinceRows] = await Promise.all([
    prisma.$queryRaw<Array<{ field_id: string; postings: number }>>(Prisma.sql`
      SELECT f.id AS field_id, COUNT(DISTINCT jp.id)::int AS postings
      FROM job_field_taxonomy f
      JOIN job_postings jp ON jp.required_fields_raw && f.synonyms
      WHERE f.review_status IN ('APPROVED', 'PROPOSED')
        AND jp.source = 'jobthai'
        AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS}::text[])
        AND ${realDataSql('jp')}
      GROUP BY f.id
    `),
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
        WHERE jp.source = 'jobthai'
          AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS}::text[])
          AND ${realDataSql('jp')}
      ),
      field_naming AS (
        SELECT e.id FROM eligible e
        WHERE EXISTS (SELECT 1 FROM job_field_taxonomy f WHERE f.review_status IN ('APPROVED','PROPOSED') AND e.required_fields_raw && f.synonyms)
      ),
      multi_field AS (
        SELECT e.id FROM eligible e
        JOIN job_field_taxonomy f ON f.review_status IN ('APPROVED','PROPOSED') AND e.required_fields_raw && f.synonyms
        GROUP BY e.id HAVING COUNT(DISTINCT f.id) >= 2
      ),
      other AS (
        SELECT s FROM eligible e, unnest(e.required_fields_raw) AS s
        WHERE s <> ${JOBTHAI_ANY_FIELD}
          AND NOT EXISTS (SELECT 1 FROM job_field_taxonomy f WHERE f.review_status IN ('APPROVED','PROPOSED') AND s = ANY(f.synonyms))
      )
      SELECT
        (SELECT COUNT(*)::int FROM eligible) AS eligible,
        (SELECT COUNT(*)::int FROM field_naming) AS field_naming,
        (SELECT COUNT(*)::int FROM multi_field) AS multi_field,
        (SELECT COUNT(*)::int FROM eligible WHERE ${JOBTHAI_ANY_FIELD} = ANY(required_fields_raw)) AS any_field,
        (SELECT COUNT(*)::int FROM job_postings jp WHERE jp.source = 'jobthai' AND jp.min_education_level::text = ANY(${POSTGRAD_LEVELS}::text[]) AND ${realDataSql('jp')}) AS postgraduate,
        (SELECT COUNT(DISTINCT s)::int FROM other) AS other_kinds,
        (SELECT COUNT(*)::int FROM other) AS other_mentions,
        (SELECT MAX(freshness_date) FROM eligible) AS as_of
    `),
    prisma.$queryRaw<Array<{ field_id: string; province: string; postings: number }>>(Prisma.sql`
      SELECT f.id AS field_id, COALESCE(jp.province, '(unknown)') AS province, COUNT(DISTINCT jp.id)::int AS postings
      FROM job_field_taxonomy f
      JOIN job_postings jp ON jp.required_fields_raw && f.synonyms
      WHERE f.review_status IN ('APPROVED', 'PROPOSED')
        AND jp.source = 'jobthai'
        AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS}::text[])
        AND ${realDataSql('jp')}
      GROUP BY f.id, COALESCE(jp.province, '(unknown)')
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
  const postingsByField = new Map(demandRows.map((r) => [r.field_id, r.postings]));

  // ── Normalisation rule (docs/methodologies/gap-map.md) ────────────────────
  // A posting that accepts several fields is demand for each of them; a
  // programme assigned to two fields supplies both. Both sides are therefore
  // normalised by the sum over fields (field-mentions / field-graduates), so
  // shares sum to 100 % on each side and the ratio is unbiased. The
  // reconciliation line reports how many postings and programmes are counted
  // more than once (`multiFieldPostings`, `multiFieldProgrammes`). `postings`
  // per row stays the raw distinct-posting count — the too-few-postings floor
  // and the displayed number are unaffected.
  const fieldMentions = demandRows.reduce((n, r) => n + r.postings, 0);
  const provincesByField = new Map<string, Array<{ province: string; share: number }>>();
  for (const r of provinceRows) {
    const total = postingsByField.get(r.field_id) ?? 0;
    const list = provincesByField.get(r.field_id) ?? [];
    list.push({ province: r.province, share: total > 0 ? r.postings / total : 0 });
    provincesByField.set(r.field_id, list);
  }
  for (const list of provincesByField.values()) list.sort((a, b) => b.share - a.share).splice(5);

  // ── Occupations inside a row ──────────────────────────────────────────────
  const occRows = await prisma.$queryRaw<
    Array<{ field_id: string; occupation_id: string; code: string; category: string; subcategory: string; postings: number }>
  >(Prisma.sql`
    SELECT f.id AS field_id, o.id AS occupation_id, o.code, o.category, o.subcategory, COUNT(DISTINCT jp.id)::int AS postings
    FROM job_field_taxonomy f
    JOIN job_postings jp ON jp.required_fields_raw && f.synonyms
    JOIN jobthai_occupations o ON o.category = jp.job_category AND o.subcategory = jp.job_subcategory
    WHERE f.review_status IN ('APPROVED', 'PROPOSED')
      AND jp.source = 'jobthai'
      AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS}::text[])
      AND ${realDataSql('jp')}
    GROUP BY f.id, o.id, o.code, o.category, o.subcategory
    ORDER BY postings DESC
  `);
  const links = await prisma.programJobThaiLink.findMany({
    where: realDataWhere(),
    select: { programId: true, jobThaiOccupationId: true },
  });
  const linkedByOcc = new Map<string, string[]>();
  for (const l of links) {
    linkedByOcc.set(l.jobThaiOccupationId, [...(linkedByOcc.get(l.jobThaiOccupationId) ?? []), l.programId]);
  }
  const occByField = new Map<string, GapMapOccupation[]>();
  for (const r of occRows) {
    const list = occByField.get(r.field_id) ?? [];
    if (list.length < 12) {
      list.push({
        occupationId: r.occupation_id,
        code: r.code,
        category: r.category,
        subcategory: r.subcategory,
        postings: r.postings,
        linkedProgramIds: linkedByOcc.get(r.occupation_id) ?? [],
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
          facultyId: true,
          faculty: { select: { nameEn: true } },
        },
      },
    },
  });
  const programById = new Map(assignments.map((a) => [a.program.id, a.program]));
  const assignedProgramIds = [...programById.keys()];
  const supplyRows =
    assignedProgramIds.length === 0
      ? []
      : await prisma.$queryRaw<Array<{ program_id: string; supply: number | null; source: 'alumni' | 'enrolment-proxy' | null }>>(
          Prisma.sql`
    WITH latest_be AS (
      SELECT MAX(entry_year_be) AS max_be FROM alumni_cohort_statuses acs0
      WHERE ${realDataSql('acs0')}
    ),
    alumni_per_program AS (
      SELECT program_id, SUM(count)::float / 5.0 AS graduates_per_year
      FROM alumni_cohort_statuses acs, latest_be
      WHERE status_bucket = 'GRADUATED'
        AND entry_year_be >= latest_be.max_be - 5
        AND ${realDataSql('acs')}
      GROUP BY program_id
    ),
    latest_grad AS (
      SELECT DISTINCT ON (program_id) program_id, graduated_on_time
      FROM enrollment_metrics em
      WHERE ${realDataSql('em')}
      ORDER BY program_id, academic_year DESC
    )
    SELECT
      p.id AS program_id,
      COALESCE(a.graduates_per_year, lg.graduated_on_time)::float AS supply,
      CASE WHEN a.graduates_per_year IS NOT NULL THEN 'alumni' WHEN lg.graduated_on_time IS NOT NULL THEN 'enrolment-proxy' ELSE NULL END AS source
    FROM programs p
    LEFT JOIN alumni_per_program a ON a.program_id = p.id
    LEFT JOIN latest_grad lg ON lg.program_id = p.id
    WHERE p.id = ANY(${assignedProgramIds}::text[])
  `,
        );
  const supplyById = new Map(
    supplyRows.map((r) => [r.program_id, { grads: r.supply == null ? null : Number(r.supply), source: r.source }]),
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
  const gradsOf = (id: string): number => supplyById.get(id)?.grads ?? 0;
  const gradsTotal = assignments.filter((a) => scoredIds.has(a.program.id)).reduce((n, a) => n + gradsOf(a.program.id), 0);
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
    const mine = assignments.filter((a) => a.fieldId === f.id);
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
          pipeline: pipelineById.get(a.program.id) ?? null,
          healthScore: health.get(a.program.id)?.overall ?? null,
          scored: scoredIds.has(a.program.id),
          reviewStatus: a.reviewStatus === 'APPROVED' ? ('APPROVED' as const) : ('PROPOSED' as const),
        };
      })
      .sort((x, y) => (y.gradsPerYear ?? -1) - (x.gradsPerYear ?? -1));
    const scored = programmes.filter((p) => p.scored);
    const grads = scored.reduce((n, p) => n + (p.gradsPerYear ?? 0), 0);
    const pipeline = scored.reduce((n, p) => n + (p.pipeline ?? 0), 0);
    const hasGrads = scored.some((p) => p.gradsPerYear != null);
    const hasPipeline = scored.some((p) => p.pipeline != null);
    const supplyShare = gradsTotal > 0 ? grads / gradsTotal : 0;
    const { ratio, verdict } = verdictFor({
      postings,
      programmes: scored.length,
      demandShare,
      supplyShare,
      thresholds: args.thresholds,
    });

    let kkuTotal: GapMapRow['kkuTotal'] = null;
    if (inScopeSet) {
      const kkuScored = mine.filter((a) => kkuScoredIds.has(a.program.id));
      const kkuGrads = kkuScored.reduce((n, a) => n + gradsOf(a.program.id), 0);
      const kkuShare = kkuGradsTotal > 0 ? kkuGrads / kkuGradsTotal : 0;
      const v = verdictFor({
        postings,
        programmes: kkuScored.length,
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
      supplyShare,
      ratio,
      verdict,
      gradsPerYear: hasGrads ? grads : null,
      pipeline: hasPipeline ? pipeline : null,
      pipelineArrow: pipelineArrow(hasGrads ? grads : null, hasPipeline ? pipeline : null),
      programmeCount: scored.length,
      signalCount: signals.length,
      kkuTotal,
      provinces: provincesByField.get(f.id) ?? [],
      occupations: occByField.get(f.id) ?? [],
      programmes,
      facultyIds: [...new Set(programmes.map((p) => p.facultyId).filter((x): x is string => x != null))],
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
    { fieldMentions, fieldGraduates: gradsTotal },
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
    rows: rows.sort((a, b) => b.demandShare - a.demandShare),
    verdictCounts,
    facultyStrip,
    reconciliation: {
      eligiblePostings: u.eligible,
      fieldPostings: u.field_naming,
      fieldMentions,
      multiFieldPostings: u.multi_field,
      anyFieldPostings: u.any_field,
      otherKinds: u.other_kinds,
      otherMentions: u.other_mentions,
      postgraduatePostings: u.postgraduate,
      ...rec,
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
