// ─────────────────────────────────────────────────────────────────────────────
// Pure transforms + Zod schemas for the LinkedIn Labour-Market Insights
// API (subscribed by MHESI; technical endpoint operated by KMITL at
// https://skill.kmitl.ac.th). The slug `kmitl-skill-mapping` and table
// prefix `kmitl_*` reflect the API endpoint name only — the underlying
// data is LinkedIn skill-demand intelligence licensed to MHESI under a
// national agreement.
//
// Schema shapes are based on live API responses captured 2026-05-01 (API
// version 1.9.1-obt). Discrepancies vs the PDF guideline (1.9.1-OBT,
// 2024-02-01) are documented inline.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveSkillId, type SkillLookup } from '@kku/db';
import { z } from 'zod';

export const KMITL_METHODOLOGY_VERSION = 'kmitl-skill-mapping.v1';

// ─── Master-list schemas (lookup endpoints) ──────────────────────────────────

const NamedRowSchema = z.object({
  id: z.number().int(),
  name: z.string(),
});

export const KmitlGroupListSchema = z.array(NamedRowSchema);
export const KmitlSkillsListSchema = z.array(NamedRowSchema);
export const KmitlIndustriesListSchema = z.array(NamedRowSchema);
export const KmitlUniversitiesListSchema = z.array(NamedRowSchema);

export const KmitlCareersListSchema = z.array(
  NamedRowSchema.extend({
    sub_groups: z.array(z.string()).optional().default([]),
    groups: z.array(z.string()).optional().default([]),
  }),
);

export type KmitlNamedRow = z.infer<typeof NamedRowSchema>;
export type KmitlCareerListRow = z.infer<typeof KmitlCareersListSchema>[number];

// ─── Group / sub-group / career detail schemas ───────────────────────────────
//
// PDF prose names group-level fields with `_overview` suffix (skills_overview,
// job_posts_overview, etc.). Career-level fields drop the suffix in the PDF's
// TS code interface (skills, skills_job_posts, …). Live API matches the PDF
// code interface exactly. We model both shapes.

const SkillRowSchema = z.object({
  // Some rows omit `group` (group-level job_posts_overview observed without it
  // in the live response). Optional + default '' covers either case.
  group: z.string().optional().default(''),
  skill: z.string(),
  amount: z.number().optional().default(0),
  percentage: z.number().optional().default(0),
});

const CareerSkillRowSchema = z.object({
  skill: z.string(),
  amount: z.number().optional().default(0),
  percentage: z.number().optional().default(0),
});

const CareerOverviewRowSchema = z.object({
  career: z.string(),
  amount: z.number().optional().default(0),
  percentage: z.number().optional().default(0),
});

const SkillsGrowthRowSchema = z.object({
  skill: z.string(),
  percentage: z.number(),
});

const IndustryRowSchema = z.object({
  industry: z.string(),
  percentage: z.number().optional().default(0),
});

const UniversityRowSchema = z.object({
  university: z.string(),
  percentage: z.number().optional().default(0),
});

// Live observation: counts fields are null for sparser groups (Smart Farmer
// etc). Allow null/missing — analysts read these as "below the threshold for
// publication" rather than zero.
const CountsSchema = z.object({
  sample: z.number().nullable().optional(),
  sample_th: z.number().nullable().optional(),
  job_posts_sample: z.number().nullable().optional(),
  job_posts_sample_th: z.number().nullable().optional(),
});

// Sub-group inside a group-detail payload
const SubGroupBriefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  // Skill summary nested inside sub-group — fields per PDF Skill interface;
  // `data_scope` field documented but not present in live data, so optional.
  skills: z
    .array(
      z.object({
        name: z.string(),
        amount: z.number().optional().default(0),
        percentage: z.number().optional().default(0),
        data_scope: z.enum(['global', 'thailand']).optional(),
      }),
    )
    .optional()
    .default([]),
});

export const KmitlGroupDetailSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  sub_groups: z.array(SubGroupBriefSchema).optional().default([]),
  // GLOBAL-scope arrays
  common_careers_overview: z.array(CareerOverviewRowSchema).optional().default([]),
  skills_overview: z.array(SkillRowSchema).optional().default([]),
  job_posts_overview: z.array(SkillRowSchema).optional().default([]),
  sub_groups_job_posts_overview: z.array(SkillRowSchema).optional().default([]),
  common_skills_overview: z.array(CareerSkillRowSchema).optional().default([]),
  skills_growth_overview: z.array(SkillsGrowthRowSchema).optional().default([]),
  industries_overview: z.array(IndustryRowSchema).optional().default([]),
  industries_job_posts_overview: z.array(IndustryRowSchema).optional().default([]),
  universities_overview: z.array(UniversityRowSchema).optional().default([]),
  // THAILAND-scope mirrors
  thailand_common_careers_overview: z.array(CareerOverviewRowSchema).optional().default([]),
  thailand_skills_overview: z.array(SkillRowSchema).optional().default([]),
  thailand_job_posts_overview: z.array(SkillRowSchema).optional().default([]),
  thailand_sub_groups_job_posts_overview: z.array(SkillRowSchema).optional().default([]),
  thailand_common_skills_overview: z.array(CareerSkillRowSchema).optional().default([]),
  thailand_skills_growth_overview: z.array(SkillsGrowthRowSchema).optional().default([]),
  thailand_industries_overview: z.array(IndustryRowSchema).optional().default([]),
  thailand_industries_job_posts_overview: z.array(IndustryRowSchema).optional().default([]),
  thailand_universities_overview: z.array(UniversityRowSchema).optional().default([]),
  counts: CountsSchema.optional(),
});

export type KmitlGroupDetail = z.infer<typeof KmitlGroupDetailSchema>;

export const KmitlCareerDetailSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  sub_groups: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string(),
      }),
    )
    .optional()
    .default([]),
  // GLOBAL-scope (no `_overview` suffix at career level)
  skills: z.array(CareerSkillRowSchema).optional().default([]),
  skills_job_posts: z.array(CareerSkillRowSchema).optional().default([]),
  skills_growth: z.array(SkillsGrowthRowSchema).optional().default([]),
  industries: z.array(IndustryRowSchema).optional().default([]),
  industries_job_posts: z.array(IndustryRowSchema).optional().default([]),
  universities: z.array(UniversityRowSchema).optional().default([]),
  // THAILAND-scope mirrors
  thailand_skills: z.array(CareerSkillRowSchema).optional().default([]),
  thailand_skills_job_posts: z.array(CareerSkillRowSchema).optional().default([]),
  thailand_skills_growth: z.array(SkillsGrowthRowSchema).optional().default([]),
  thailand_industries: z.array(IndustryRowSchema).optional().default([]),
  thailand_industries_job_posts: z.array(IndustryRowSchema).optional().default([]),
  thailand_universities: z.array(UniversityRowSchema).optional().default([]),
  // counts is documented but absent at career level in live API; allow either.
  counts: CountsSchema.optional(),
});

export type KmitlCareerDetail = z.infer<typeof KmitlCareerDetailSchema>;

// ─── Skill-name resolution ───────────────────────────────────────────────────
//
// KMITL returns free-text skill names (e.g., "Python", "Search Engine
// Optimization (SEO)"). We resolve to our Skill.id via case-insensitive
// trimmed exact match on Skill.nameEn, then Skill.nameTh. Unmatched names
// land with skillId = NULL — analyst triage via IngestionRun.metadata.

// The resolver itself lives in @kku/db so the career skill-demand spreadsheet
// import resolves skill names exactly as this connector does.
export { buildSkillLookup, resolveSkillId } from '@kku/db';
export type { SkillLookup } from '@kku/db';

// ─── Mapping helpers (raw payload → domain rows) ─────────────────────────────

export type KmitlDataScope = 'GLOBAL' | 'THAILAND';
export type KmitlDemandSource = 'PROFILES' | 'JOB_POSTINGS';

export interface CareerSkillDemandRowDraft {
  kmitlCareerId: number;
  skillNameRaw: string;
  skillId: string | null;
  dataScope: KmitlDataScope;
  dataSource: KmitlDemandSource;
  amount: number;
  percentage: number;
}

export interface SkillGrowthRowDraft {
  contextLevel: 'group' | 'sub_group' | 'career';
  contextId: number;
  contextName: string;
  skillNameRaw: string;
  skillId: string | null;
  dataScope: KmitlDataScope;
  growthPct: number;
}

/**
 * Turn a career-detail payload into demand rows.
 *
 * Each `(skill × dataSource × dataScope)` produces one row keyed on
 * `(kmitl_career_id, skill_name_raw, data_scope, data_source)`. Compound
 * unique constraint on the table enforces the latest-snapshot semantics.
 */
export function careerDetailToDemandDrafts(
  detail: KmitlCareerDetail,
  lookup: SkillLookup,
): CareerSkillDemandRowDraft[] {
  const out: CareerSkillDemandRowDraft[] = [];

  const push = (
    rows: ReadonlyArray<{ skill: string; amount: number; percentage: number }>,
    dataScope: KmitlDataScope,
    dataSource: KmitlDemandSource,
  ) => {
    for (const row of rows) {
      const skillNameRaw = row.skill.trim();
      if (!skillNameRaw) continue;
      out.push({
        kmitlCareerId: detail.id,
        skillNameRaw,
        skillId: resolveSkillId(lookup, skillNameRaw),
        dataScope,
        dataSource,
        amount: row.amount,
        percentage: row.percentage,
      });
    }
  };

  push(detail.skills, 'GLOBAL', 'PROFILES');
  push(detail.skills_job_posts, 'GLOBAL', 'JOB_POSTINGS');
  push(detail.thailand_skills, 'THAILAND', 'PROFILES');
  push(detail.thailand_skills_job_posts, 'THAILAND', 'JOB_POSTINGS');

  return out;
}

/**
 * Career-detail → growth rows (one per skill × scope).
 */
export function careerDetailToGrowthDrafts(
  detail: KmitlCareerDetail,
  lookup: SkillLookup,
): SkillGrowthRowDraft[] {
  const out: SkillGrowthRowDraft[] = [];
  const push = (
    rows: ReadonlyArray<{ skill: string; percentage: number }>,
    dataScope: KmitlDataScope,
  ) => {
    for (const row of rows) {
      const skillNameRaw = row.skill.trim();
      if (!skillNameRaw) continue;
      out.push({
        contextLevel: 'career',
        contextId: detail.id,
        contextName: detail.name,
        skillNameRaw,
        skillId: resolveSkillId(lookup, skillNameRaw),
        dataScope,
        growthPct: row.percentage,
      });
    }
  };
  push(detail.skills_growth, 'GLOBAL');
  push(detail.thailand_skills_growth, 'THAILAND');
  return out;
}

/**
 * Group-detail → growth rows. Uses `skills_growth_overview`.
 */
export function groupDetailToGrowthDrafts(
  detail: KmitlGroupDetail,
  lookup: SkillLookup,
): SkillGrowthRowDraft[] {
  const out: SkillGrowthRowDraft[] = [];
  const push = (
    rows: ReadonlyArray<{ skill: string; percentage: number }>,
    dataScope: KmitlDataScope,
  ) => {
    for (const row of rows) {
      const skillNameRaw = row.skill.trim();
      if (!skillNameRaw) continue;
      out.push({
        contextLevel: 'group',
        contextId: detail.id,
        contextName: detail.name,
        skillNameRaw,
        skillId: resolveSkillId(lookup, skillNameRaw),
        dataScope,
        growthPct: row.percentage,
      });
    }
  };
  push(detail.skills_growth_overview, 'GLOBAL');
  push(detail.thailand_skills_growth_overview, 'THAILAND');
  return out;
}

/**
 * Build a metadata blob to ride alongside one career's demand rows.
 * Holds industries, universities, and counts so analysts have one-stop
 * lineage without joining auxiliary tables.
 */
export function buildCareerMetadata(detail: KmitlCareerDetail): Record<string, unknown> {
  return {
    industries: detail.industries,
    industries_job_posts: detail.industries_job_posts,
    universities: detail.universities,
    thailand_industries: detail.thailand_industries,
    thailand_industries_job_posts: detail.thailand_industries_job_posts,
    thailand_universities: detail.thailand_universities,
  };
}
