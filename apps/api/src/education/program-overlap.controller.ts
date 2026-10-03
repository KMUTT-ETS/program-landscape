import { Controller, ForbiddenException, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  overlapMatrix,
  overlapPairDetail,
  prisma,
  type OverlapMatrixResponse,
  type OverlapPairDetail,
} from '@kku/db';
import type { ApiMeta, SessionUser } from '@kku/shared';
import {
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
  assertCanSeeFacultyDashboards,
  clampFacultyIdFilter,
  resolveEffectiveScope,
} from '../common';
import { PROGRAM_OVERLAP_PROVENANCE } from './program-overlap.provenance';

export const OverlapMatrixQuery = z.object({
  level: z.enum(['BACHELOR', 'MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA']).default('BACHELOR'),
  facultyId: z.string().min(1).optional(),
});
export type OverlapMatrixQuery = z.infer<typeof OverlapMatrixQuery>;

type WithMeta<T> = { data: T; meta: Partial<ApiMeta> };

/**
 * May the caller see AT LEAST ONE of these faculties on a faculty-grain
 * dashboard? Grants are the set clampFacultyIdFilter clamps to: admin / UNIVERSITY_USER see
 * everything; a scoped user sees the faculties they are granted, plus the
 * faculty of any programme they are granted (a PROGRAM_USER is rolled up to
 * their programme's faculty on these dashboards).
 */
export async function canSeeAnyFacultyOnDashboard(user: SessionUser, facultyIds: readonly string[]): Promise<boolean> {
  const eff = await resolveEffectiveScope(user);
  if (eff.mode === 'all') return true;
  if (eff.mode === 'none') return false;
  const granted = new Set(eff.facultyIds);
  if (eff.programIds.length > 0) {
    const progs = await prisma.program.findMany({ where: { id: { in: eff.programIds } }, select: { facultyId: true } });
    for (const p of progs) granted.add(p.facultyId);
  }
  return facultyIds.some((f) => granted.has(f));
}

// /education/program-overlap — program-overlap.v1 network + ranked pair list (spec §10.1).
// A faculty-grain, non-program-aware dashboard: guarded and clamped exactly
// like /education/recruitment (assertCanSeeFacultyDashboards +
// clampFacultyIdFilter).
@Controller('/education/program-overlap')
export class ProgramOverlapController {
  @Get()
  @Authorized('institution:read:dashboard')
  @Provenance(PROGRAM_OVERLAP_PROVENANCE)
  async matrix(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(OverlapMatrixQuery)) q: OverlapMatrixQuery,
  ): Promise<WithMeta<OverlapMatrixResponse>> {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyIdFilter({ facultyId: q.facultyId ?? null }, user);
    const data = await overlapMatrix({ level: q.level, facultyId: clamped.facultyId });
    return { data, meta: { freshnessDate: data.completedAt } };
  }

  @Get('pairs/:pairId')
  @Authorized('institution:read:dashboard')
  @Provenance(PROGRAM_OVERLAP_PROVENANCE)
  async pair(
    @AuthSession() user: SessionUser,
    @Param('pairId') pairId: string,
  ): Promise<WithMeta<OverlapPairDetail>> {
    await assertCanSeeFacultyDashboards(user);
    const data = await overlapPairDetail(pairId);
    if (!data) throw new NotFoundException();
    // Either side in scope is enough: curriculum content is public, and the
    // matrix already shows a scoped user their programmes' outside siblings.
    if (!(await canSeeAnyFacultyOnDashboard(user, [data.programA.facultyId, data.programB.facultyId]))) {
      throw new ForbiddenException('Neither programme of this pair is in your assigned scope.');
    }
    return { data, meta: { freshnessDate: data.completedAt } };
  }
}
