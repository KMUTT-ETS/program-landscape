import { Controller, ForbiddenException, Get, NotFoundException, Param, Query } from '@nestjs/common';
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

// Roles that see the entire university unfiltered. FACULTY_USER and
// PROGRAM_USER get clamped to their own faculty/department on every
// program-list call so they never see another faculty's programs in
// the listing — even before they try to deep-dive.
function seesAllPrograms(role: SessionUser['role']): boolean {
  return (
    role === 'SUPER_ADMIN' ||
    role === 'SYSTEM_ADMIN' ||
    role === 'UNIVERSITY_USER'
  );
}

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

    // Hard scope clamp for FACULTY_USER + PROGRAM_USER — overrides any
    // wider scope the client passed. Honours impersonation since
    // user.facultyId reflects the impersonated session.
    if (!seesAllPrograms(user.role)) {
      if (!user.facultyId) {
        throw new ForbiddenException(
          'Your account has no faculty assignment. Contact an admin.',
        );
      }
      // If the request asked for a specific faculty/dept/program that
      // isn't mine, it's a 403. If it asked for university or nothing,
      // we silently clamp.
      if (where.facultyId && where.facultyId !== user.facultyId) {
        throw new ForbiddenException(
          "You can only view your own faculty's programs.",
        );
      }
      where.facultyId = user.facultyId;
      if (user.role === 'PROGRAM_USER') {
        if (!user.programId) {
          throw new ForbiddenException(
            'Your account has no program assignment. Contact an admin.',
          );
        }
        if (where.id && where.id !== user.programId) {
          throw new ForbiddenException('You can only view your own program.');
        }
        where.id = user.programId;
      }
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
  async getOne(@AuthSession() user: SessionUser, @Param('id') id: string) {
    const program = await prisma.program.findUnique({ where: { id } });
    if (!program) throw new NotFoundException();
    // FACULTY_USER + PROGRAM_USER: refuse if the program is outside
    // their assigned scope. This is the single-program counterpart to
    // the list-clamp above.
    if (!seesAllPrograms(user.role)) {
      if (!user.facultyId || program.facultyId !== user.facultyId) {
        throw new ForbiddenException(
          "This program is outside the faculty assigned to your account.",
        );
      }
      if (
        user.role === 'PROGRAM_USER' &&
        user.programId &&
        program.id !== user.programId
      ) {
        throw new ForbiddenException(
          "This is not the program assigned to your account.",
        );
      }
    }
    return program;
  }
}
