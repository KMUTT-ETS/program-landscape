import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { prisma, withCanonical } from '@kku/db';
import {
  ApiError,
  ProgramListQuerySchema,
  type ProgramListQuery,
} from '@kku/shared';
import type { Prisma } from '@kku/db';
import {
  Authorized,
  AuthSession,
  Provenance,
  ZodValidationPipe,
} from '../common';
import type { SessionUser } from '@kku/shared';

@Controller('/programs')
export class ProgramsController {
  @Get()
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'kku-reg', name: 'KKU Registration' }],
    methodologyVersion: 'v1',
  })
  async list(
    @Query(new ZodValidationPipe(ProgramListQuerySchema)) q: ProgramListQuery,
    @AuthSession() user: SessionUser,
  ) {
    const where: Prisma.ProgramWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.level) where.level = q.level;

    // Narrow the result set by the requested scope. Access was already
    // checked by AccessControlGuard; this is a filter, not a check.
    if (q.scope === 'faculty') {
      if (!q.scopeId) throw new ApiError('VALIDATION_FAILED', 'scopeId required');
      where.facultyId = q.scopeId;
    } else if (q.scope === 'department') {
      if (!q.scopeId) throw new ApiError('VALIDATION_FAILED', 'scopeId required');
      where.departmentId = q.scopeId;
    } else if (q.scope === 'program') {
      if (!q.scopeId) throw new ApiError('VALIDATION_FAILED', 'scopeId required');
      where.id = q.scopeId;
    }

    // The curriculum landscape is the canonical 297 KKU programs (those
    // with a sequenceNoFromSheet from the master sheet). Legacy mock-seed
    // rows and programs that arrive only via staff/student ingestion as
    // a side-effect must NOT show here — they remain joinable from staff
    // and education dashboards but are not "the curriculum".
    const canonicalWhere = withCanonical(where);

    const [rows, total] = await prisma.$transaction([
      prisma.program.findMany({
        where: canonicalWhere,
        orderBy: { code: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.program.count({ where: canonicalWhere }),
    ]);

    return {
      data: rows,
      meta: {
        scope: { level: q.scope, id: q.scopeId ?? null },
        pagination: { page: q.page, pageSize: q.pageSize, total },
        viewerRole: user.role,
      },
    };
  }

  @Get(':id')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async getOne(@Param('id') id: string) {
    const program = await prisma.program.findUnique({ where: { id } });
    if (!program) throw new NotFoundException();
    return program;
  }
}
