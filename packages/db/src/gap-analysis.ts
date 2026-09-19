import { z } from 'zod';
import { prisma } from './index';
import { realDataWhere } from './data-quality';
import { DEMAND_SOURCE_LINKEDIN, demandMatchSourceWhere } from './demand-match-sources';
import { scopeProgramIds } from './gap-map';

// ═══════════════════════════════════════════════════════════════════════
// Per-programme LinkedIn demand-gap helper.
//
// What is LEFT of prompt 08's Gap Analyzer. The seven lenses it used to
// hold (skill gap, occupation gap, sector gap, regional gap,
// opportunities, risks, forecast accuracy) were retired in v1.9.8 and
// replaced by the demand-first gap map — `computeGapMap` in gap-map.ts,
// which is what /gap-analysis and the AI Analyst now read.
//
// `computeProgramDemandGaps` survives because it answers a different
// question from the map: not "which fields of study does the labour
// market ask for", but "of the skills demand says are relevant to THIS
// programme's discipline, how many does its curriculum already teach".
// Its rows come from ProgramDemandMatch (AI-resolved, LinkedIn-sourced),
// already discipline-filtered per programme. Kept for the AI Analyst's
// evidence rail and a future Deep-Dive card.
//
// Explicit result types (not Prisma's inferred shape) because
// packages/db compiles with declaration: true, and the inferred types
// would leak the full Prisma client path.
// ═══════════════════════════════════════════════════════════════════════

export const GAP_ANALYSIS_VERSION = 'gap-analysis.v1';

export const GapFilterSchema = z.object({
  scope: z.enum(['university', 'faculty', 'department', 'program']).default('university'),
  scopeId: z.string().optional(),
  region: z.string().default('TH'),
  limit: z.number().int().min(1).max(200).default(30),
  // Exclude soft / transferable / language skills from the gap analysis.
  // Job-posting taxonomies (KMITL, JobThai, JobsDB) systematically
  // under-list these — every employer wants "teamwork" but few list it
  // as a posting requirement. Including them creates artificial
  // "oversupply" rows that mislead Council. Default ON.
  excludeSoftSkills: z.boolean().default(true),
});
// Output type (post-parse, defaults applied). Used internally + as the
// shape returned from helpers. Public callers can pass GapFilterInput
// (any field optional — defaults fill in) and receive a normalised
// GapFilter back via the schema.parse(filter) at function entry.
export type GapFilter = z.infer<typeof GapFilterSchema>;
export type GapFilterInput = z.input<typeof GapFilterSchema>;

// ── Per-program demand-match gaps ────────────────────────────────────
//
// Powered by ProgramDemandMatch — AI-resolved per-program assessments
// of "is this in-demand skill (a) relevant to this discipline AND (b)
// covered by the curriculum?". v1: 5,377 rows × 207 programs, ~24% of
// pairs are TRUE GAPS (demand-relevant skill the curriculum doesn't
// teach). Sharper than a university-wide skill aggregate because each
// row is already discipline-filtered.

export interface ProgramDemandGapRow {
  programId: string;
  programCode: string;
  programNameEn: string;
  programNameTh: string;
  facultyCode: string;
  /** Total relevant skills (matched + unmatched). */
  relevantSkillCount: number;
  /** Skills the curriculum already covers. */
  coveredCount: number;
  /** Relevant skills the curriculum does NOT cover — the gap. */
  gapCount: number;
  /** 0..1 — coveredCount / relevantSkillCount. */
  coverageRatio: number;
  /** Top 5 highest-relatedness gaps (by demanded skill name + relatedness). */
  topGaps: Array<{
    skillId: string;
    skillNameEn: string;
    skillNameTh: string;
    relatedness: number;
  }>;
  methodologyVersion: string;
}

export interface ProgramDemandGapResult {
  filter: GapFilter;
  rows: ProgramDemandGapRow[];
  /** Programs with NO demand-match data yet (excluded from rows). */
  uncoveredProgramCount: number;
  asOf: string;
}

export async function computeProgramDemandGaps(
  filter: GapFilterInput,
): Promise<ProgramDemandGapResult> {
  const f = GapFilterSchema.parse(filter);
  // `scopeProgramIds` (gap-map.ts) is the one scope resolver now: it
  // returns null for university (= no filter) and has no programme
  // branch, so a programme ask is resolved here instead.
  const programIds = (await scopeProgramIds(f.scope === 'program' ? 'university' : f.scope, f.scopeId ?? null)) ?? [];
  const scopedIds = f.scope === 'program' && f.scopeId ? [f.scopeId] : programIds;

  // Pull ProgramDemandMatch + program metadata in one go.
  const matchesRaw = await prisma.programDemandMatch.findMany({
    where: {
      ...(scopedIds.length > 0 ? { programId: { in: scopedIds } } : {}),
      relevant: true,
      ...demandMatchSourceWhere(DEMAND_SOURCE_LINKEDIN),
      ...realDataWhere(),
    },
    include: {
      program: {
        select: {
          id: true,
          code: true,
          nameEn: true,
          nameTh: true,
          faculty: { select: { code: true } },
        },
      },
      skill: { select: { id: true, nameEn: true, nameTh: true, category: true } },
    },
  });
  // Filter out soft skills from the per-program gap analysis: job-posting
  // taxonomies under-list soft skills, so flagging them as "uncovered" against demand is
  // misleading (every program teaches teamwork; no posting demands it
  // by name). Default ON via filter.
  const matches = f.excludeSoftSkills
    ? matchesRaw.filter((m) => !isSoftSkill(m.skill.category, m.skill.nameEn))
    : matchesRaw;

  // Group by program.
  const byProgram = new Map<
    string,
    {
      program: { id: string; code: string; nameEn: string; nameTh: string; faculty: { code: string } };
      relevant: typeof matches;
    }
  >();
  for (const m of matches) {
    const e = byProgram.get(m.programId);
    if (e) e.relevant.push(m);
    else byProgram.set(m.programId, { program: m.program, relevant: [m] });
  }

  // Compute counts of programs with zero demand-match data — for the
  // "uncoveredProgramCount" stat (Council needs to know how many
  // programs were excluded because the AI hasn't run yet).
  const totalProgramsAtScope =
    scopedIds.length > 0
      ? scopedIds.length
      : await prisma.program.count({
          where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
        });
  const uncoveredProgramCount = totalProgramsAtScope - byProgram.size;

  const rows: ProgramDemandGapRow[] = [...byProgram.values()].map(({ program, relevant }) => {
    const covered = relevant.filter((m) => m.matched);
    const gaps = relevant.filter((m) => !m.matched);
    const topGaps = [...gaps]
      .sort((a, b) => b.relatedness - a.relatedness)
      .slice(0, 5)
      .map((m) => ({
        skillId: m.skill.id,
        skillNameEn: m.skill.nameEn,
        skillNameTh: m.skill.nameTh,
        relatedness: m.relatedness,
      }));
    return {
      programId: program.id,
      programCode: program.code,
      programNameEn: program.nameEn,
      programNameTh: program.nameTh,
      facultyCode: program.faculty.code,
      relevantSkillCount: relevant.length,
      coveredCount: covered.length,
      gapCount: gaps.length,
      coverageRatio: relevant.length > 0 ? covered.length / relevant.length : 0,
      topGaps,
      methodologyVersion: 'demand-match.v1',
    };
  });

  // Sort by gapCount desc — programs with the biggest curriculum holes first.
  rows.sort((a, b) => b.gapCount - a.gapCount);

  return {
    filter: f,
    rows: rows.slice(0, f.limit),
    uncoveredProgramCount,
    asOf: new Date().toISOString(),
  };
}

// ── Internal helpers ─────────────────────────────────────────────────

// Soft / transferable / language skill detector. Job-posting taxonomies
// systematically under-list these — every employer wants "teamwork" but
// few list it as a posting requirement. Including them in the gap
// analysis creates artificial "oversupply" rows that mislead Council.
//
// Detection: category substring match (covers `transferable`,
// `Transferable`, `transferable/engineering`, `language/transferable`,
// etc.) plus a name-based fallback for un-categorised soft skills.
const SOFT_CATEGORY_RE = /(transferable|^language|^vocational|soft.skill|transversal)/i;
const SOFT_NAME_RE = /\b(teamwork|leadership|critical thinking|problem solving|communication|interpersonal|self.directed|professional ethics|english language|english communication|research methodology|entrepreneurship|collaboration|presentation skills|negotiation skills|time management)\b/i;
function isSoftSkill(category: string | null, nameEn: string | null): boolean {
  if (category && SOFT_CATEGORY_RE.test(category)) return true;
  if (nameEn && SOFT_NAME_RE.test(nameEn)) return true;
  return false;
}
