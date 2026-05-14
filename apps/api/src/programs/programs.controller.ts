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

interface EffectiveScope {
  seesAll: boolean;
  allowedFacultyIds: Set<string>;
  allowedProgramIds: Set<string>;
}

// Resolve the user's effective access from User.role + UserScope rows.
//
// SessionUser only carries primary (role, facultyId, programId), so
// auto-provisioned academic staff with role=PROGRAM_USER + programId=null
// + several UserScope rows have always-empty primary fields here. Without
// this resolver the program-list clamp at line ~80 throws "no program
// assignment" and the page reads as empty.
//
// This is a focused partial of the deferred UserScope Phase 2 rewrite —
// applied to the /programs endpoints because they're user-facing today.
// SessionUser-wide rewire still pending (see project memory).
async function resolveEffectiveScope(user: SessionUser): Promise<EffectiveScope> {
  if (seesAllPrograms(user.role)) {
    return {
      seesAll: true,
      allowedFacultyIds: new Set(),
      allowedProgramIds: new Set(),
    };
  }

  const scopes = await prisma.userScope.findMany({
    where: { userId: user.userId },
    select: { role: true, facultyId: true, programId: true },
  });

  // A UserScope row with an admin-grade or UNIVERSITY_USER role grants
  // see-everything — same effect as if the primary role were elevated.
  const hasUniversityScope = scopes.some(
    (s) =>
      s.role === 'UNIVERSITY_USER' ||
      s.role === 'SUPER_ADMIN' ||
      s.role === 'SYSTEM_ADMIN',
  );
  if (hasUniversityScope) {
    return {
      seesAll: true,
      allowedFacultyIds: new Set(),
      allowedProgramIds: new Set(),
    };
  }

  const allowedFacultyIds = new Set<string>();
  const allowedProgramIds = new Set<string>();

  // Primary fields contribute ONLY when the role matches that scope
  // axis. Without this gate, a user whose primary row has
  // role=PROGRAM_USER + facultyId=engineering (a back-context field
  // from FacultyMember sync) would have engineering added as a
  // FACULTY_USER-level grant — exposing all 19 engineering programs
  // when their actual scope is a single program.
  if (user.role === 'FACULTY_USER' && user.facultyId) {
    allowedFacultyIds.add(user.facultyId);
  }
  if (user.role === 'PROGRAM_USER' && user.programId) {
    allowedProgramIds.add(user.programId);
  }

  for (const s of scopes) {
    if (s.role === 'FACULTY_USER' && s.facultyId) {
      // FACULTY_USER grants visibility to the entire faculty.
      allowedFacultyIds.add(s.facultyId);
    } else if (s.role === 'PROGRAM_USER' && s.programId) {
      // PROGRAM_USER grants visibility to that single program only.
      // The faculty is NOT added — that would broaden access to every
      // program in the faculty, which is FACULTY_USER semantics.
      allowedProgramIds.add(s.programId);
    }
  }

  return { seesAll: false, allowedFacultyIds, allowedProgramIds };
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
    if (q.facultyId) where.facultyId = q.facultyId;
    if (q.curriculumYearBE) where.curriculumYearBE = q.curriculumYearBE;
    if (q.q) {
      // Free-text matching across the four "identifier" fields a Council
      // member or analyst would type. Case-insensitive on the EN strings,
      // exact-substring on the TH (Prisma + Postgres handle Thai casing
      // as identity — `mode: 'insensitive'` is a no-op on Thai code points).
      // Wrapped in AND so the scope-clamp's `OR` (faculty-IN ∨ program-IN)
      // below doesn't overwrite this clause.
      const needle = q.q;
      where.AND = [
        {
          OR: [
            { code: { contains: needle, mode: 'insensitive' } },
            { mhesiCode: { contains: needle, mode: 'insensitive' } },
            { nameEn: { contains: needle, mode: 'insensitive' } },
            { nameTh: { contains: needle } },
          ],
        },
      ];
    }

    // Narrow the result set by the requested scope. Access was already
    // checked by AccessControlGuard; this is a filter, not a check.
    // Keep the requested values separately (as plain strings) so the
    // scope clamp below can check them without fighting Prisma's
    // `string | StringFilter` union.
    let requestedFacultyId: string | null = null;
    let requestedProgramId: string | null = null;
    if (q.scope === 'faculty') {
      if (!q.scopeId) throw new ApiError('VALIDATION_FAILED', 'scopeId required');
      where.facultyId = q.scopeId;
      requestedFacultyId = q.scopeId;
    } else if (q.scope === 'department') {
      if (!q.scopeId) throw new ApiError('VALIDATION_FAILED', 'scopeId required');
      where.departmentId = q.scopeId;
    } else if (q.scope === 'program') {
      if (!q.scopeId) throw new ApiError('VALIDATION_FAILED', 'scopeId required');
      where.id = q.scopeId;
      requestedProgramId = q.scopeId;
    }

    // Hard scope clamp for FACULTY_USER + PROGRAM_USER — overrides any
    // wider scope the client passed. Reads effective scope from User +
    // UserScope rows so multi-scope users (e.g. 5 PROGRAM_USER scopes +
    // 1 UNIVERSITY_USER scope) get the union of their grants.
    const effective = await resolveEffectiveScope(user);
    if (!effective.seesAll) {
      const noGrants =
        effective.allowedFacultyIds.size === 0 &&
        effective.allowedProgramIds.size === 0;
      if (noGrants) {
        throw new ForbiddenException(
          'Your account has no faculty or program assignment. Contact an admin.',
        );
      }
      // If the request asked for a specific faculty/program that isn't
      // in the granted set, it's a 403. Otherwise clamp the where clause
      // to the union (facultyId IN allowed OR id IN allowed).
      if (requestedFacultyId && !effective.allowedFacultyIds.has(requestedFacultyId)) {
        throw new ForbiddenException(
          "You can only view programs in your assigned faculty.",
        );
      }
      if (requestedProgramId && !effective.allowedProgramIds.has(requestedProgramId)) {
        // Allow if the program's faculty is in the allowed set —
        // resolved by separate fetch since we can't infer facultyId
        // from `id` alone in the where clause.
        const target = await prisma.program.findUnique({
          where: { id: requestedProgramId },
          select: { facultyId: true },
        });
        if (!target || !effective.allowedFacultyIds.has(target.facultyId)) {
          throw new ForbiddenException(
            "This program is outside the scope assigned to your account.",
          );
        }
      }
      // Combined union clamp: (facultyId IN allowedFaculties) OR
      // (id IN allowedPrograms). Both empty was rejected above.
      const orClauses: Prisma.ProgramWhereInput[] = [];
      if (effective.allowedFacultyIds.size > 0) {
        orClauses.push({ facultyId: { in: [...effective.allowedFacultyIds] } });
      }
      if (effective.allowedProgramIds.size > 0) {
        orClauses.push({ id: { in: [...effective.allowedProgramIds] } });
      }
      where.OR = orClauses;
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
        include: {
          faculty: {
            select: { id: true, code: true, nameEn: true, nameTh: true },
          },
        },
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
    // their assigned scope. Consults UserScope rows so multi-scope
    // users (e.g. 5 PROGRAM_USER scopes + 1 UNIVERSITY_USER scope)
    // get the union of their grants.
    const effective = await resolveEffectiveScope(user);
    if (!effective.seesAll) {
      const facultyGranted = effective.allowedFacultyIds.has(program.facultyId);
      const programGranted = effective.allowedProgramIds.has(program.id);
      if (!facultyGranted && !programGranted) {
        throw new ForbiddenException(
          "This program is outside the scope assigned to your account.",
        );
      }
    }
    return program;
  }
}
