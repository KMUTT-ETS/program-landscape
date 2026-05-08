import { Controller, Get, Param, Query } from '@nestjs/common';
import { Prisma, prisma } from '@kku/db';
import { ScopeLevelSchema, type ScopeLevel, type SessionUser } from '@kku/shared';
import { z } from 'zod';
import {
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
  clampScopeForUser,
} from '../common';

// Skills API. Endpoints:
//   GET /skills              — flat list (search + scope filter)
//   GET /skills/tree         — hierarchical tree at a given scope
//   GET /skills/:id          — detail with program coverage + demand
//
// Scope-aware semantics:
//   university            → all programs
//   faculty   <facultyId>  → programs.facultyId = :id
//   department <deptId>   → programs.departmentId = :id
//   program   <programId> → exactly that program
//
// A skill "appears at scope S" if any program under S has that skill
// via ProgramSkill (denormalised rollup — see prompt 01 and the
// prompt-04 ai-jobs EXTRACT_COURSE_SKILLS job's post-approval handler).

const ListQuerySchema = z.object({
  search: z.string().trim().optional(),
  scope: ScopeLevelSchema.default('university'),
  scopeId: z.string().optional(),
  category: z.string().optional(),
  taxonomySource: z.enum(['LIGHTCAST', 'ESCO', 'TPQI', 'KKU']).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});
type ListQuery = z.infer<typeof ListQuerySchema>;

@Controller('/skills')
export class SkillsController {
  @Get()
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'skills', name: 'KKU Skill Taxonomy' }] })
  async list(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ListQuerySchema)) q: ListQuery,
  ) {
    // Skills that appear at the current scope, optionally filtered by
    // name/category/source. The scope filter is a `skill IN (covered at
    // scope)` EXISTS subquery; when scope = UNIVERSITY we skip it.
    const eff = await clampScopeForUser(q.scope, q.scopeId ?? null, user);
    const programsAtScope = scopeProgramFilter(eff.scope, eff.scopeId ?? undefined);

    const where: Prisma.SkillWhereInput = {};
    if (q.search) {
      // pg_trgm + case-insensitive. Matches Thai + English.
      where.OR = [
        { nameEn: { contains: q.search, mode: 'insensitive' } },
        { nameTh: { contains: q.search } },
        { code: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    if (q.category) where.category = q.category;
    if (q.taxonomySource) where.taxonomySource = q.taxonomySource;

    if (programsAtScope) {
      where.programSkills = {
        some: { program: programsAtScope },
      };
    }

    const rows = await prisma.skill.findMany({
      where,
      orderBy: [{ category: 'asc' }, { nameEn: 'asc' }],
      take: q.limit,
      include: { _count: { select: { programSkills: true, courseSkills: true, jobPostingSkills: true } } },
    });

    return rows.map(toListItem);
  }

  // Returns the tree rooted at the given scope's covered skills. We
  // include every ancestor of any covered skill so the UI can render
  // a coherent path down to each leaf.
  @Get('tree')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'skills', name: 'KKU Skill Taxonomy' }] })
  async tree(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ListQuerySchema)) q: ListQuery,
  ) {
    const eff = await clampScopeForUser(q.scope, q.scopeId ?? null, user);
    const programsAtScope = scopeProgramFilter(eff.scope, eff.scopeId ?? undefined);

    // Scope-covered leaves.
    const leaves = await prisma.skill.findMany({
      where: programsAtScope
        ? { programSkills: { some: { program: programsAtScope } } }
        : undefined,
      select: { id: true, parentSkillId: true },
    });

    // Walk up each leaf to collect ancestors.
    const covered = new Set(leaves.map((l) => l.id));
    const needed = new Set<string>();
    for (const l of leaves) needed.add(l.id);
    // Ancestor walk — fetch parents in waves.
    let frontier = leaves.map((l) => l.parentSkillId).filter((x): x is string => !!x);
    while (frontier.length > 0) {
      const parents = await prisma.skill.findMany({
        where: { id: { in: frontier } },
        select: { id: true, parentSkillId: true },
      });
      const next: string[] = [];
      for (const p of parents) {
        if (needed.has(p.id)) continue;
        needed.add(p.id);
        if (p.parentSkillId) next.push(p.parentSkillId);
      }
      frontier = next;
    }

    // If no scope filter was applied, return every skill.
    const all = await prisma.skill.findMany({
      where: programsAtScope ? { id: { in: [...needed] } } : undefined,
      orderBy: [{ category: 'asc' }, { nameEn: 'asc' }],
      include: { _count: { select: { programSkills: true } } },
    });

    // Tag each node with `coveredAtScope` so the UI can style ancestors
    // differently from leaves that are actually covered.
    return all.map((s) => ({
      ...toListItem(s),
      coveredAtScope: covered.has(s.id),
    }));
  }

  @Get(':id')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'skills', name: 'KKU Skill Taxonomy' }] })
  async detail(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ListQuerySchema)) q: ListQuery,
  ) {
    const eff = await clampScopeForUser(q.scope, q.scopeId ?? null, user);
    const programsAtScope = scopeProgramFilter(eff.scope, eff.scopeId ?? undefined);

    const [skill, programs, jobPostings] = await Promise.all([
      prisma.skill.findUnique({
        where: { id },
        include: {
          parent: { select: { id: true, nameEn: true, nameTh: true } },
          children: { select: { id: true, nameEn: true, nameTh: true } },
        },
      }),
      prisma.programSkill.findMany({
        where: {
          skillId: id,
          ...(programsAtScope ? { program: programsAtScope } : {}),
        },
        include: {
          program: {
            select: {
              id: true,
              code: true,
              nameEn: true,
              nameTh: true,
              level: true,
              facultyId: true,
              departmentId: true,
            },
          },
        },
        orderBy: { weight: 'desc' },
        take: 100,
      }),
      prisma.jobPostingSkill.findMany({
        where: { skillId: id },
        include: {
          jobPosting: {
            select: { id: true, title: true, freshnessDate: true },
          },
        },
        orderBy: { jobPosting: { freshnessDate: 'desc' } },
        take: 50,
      }),
    ]);

    if (!skill) return null;

    return {
      skill: toListItem(skill),
      parent: skill.parent,
      children: skill.children,
      programCoverage: programs.map((p) => ({
        programId: p.program.id,
        programCode: p.program.code,
        programNameTh: p.program.nameTh,
        programNameEn: p.program.nameEn,
        level: p.program.level,
        weight: p.weight,
      })),
      demandSample: jobPostings.map((j) => ({
        postingId: j.jobPosting.id,
        title: j.jobPosting.title,
        freshnessDate: j.jobPosting.freshnessDate,
      })),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function scopeProgramFilter(scope: ScopeLevel, scopeId?: string): Prisma.ProgramWhereInput | null {
  switch (scope) {
    case 'university':
      return null;
    case 'faculty':
      if (!scopeId) return null;
      return { facultyId: scopeId };
    case 'department':
      if (!scopeId) return null;
      return { departmentId: scopeId };
    case 'program':
      if (!scopeId) return null;
      return { id: scopeId };
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

interface SkillLike {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
  category: string | null;
  taxonomySource: string;
  parentSkillId: string | null;
  _count?: {
    programSkills?: number;
    courseSkills?: number;
    jobPostingSkills?: number;
  };
}

function toListItem(s: SkillLike) {
  return {
    id: s.id,
    code: s.code,
    nameEn: s.nameEn,
    nameTh: s.nameTh,
    category: s.category,
    taxonomySource: s.taxonomySource,
    parentSkillId: s.parentSkillId,
    programCount: s._count?.programSkills ?? 0,
    courseCount: s._count?.courseSkills ?? 0,
    jobCount: s._count?.jobPostingSkills ?? 0,
  };
}
