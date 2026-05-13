import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  ZodValidationPipe,
  assertCanSeeFacultyDashboards,
  assertUniversityWide,
  clampFacultyIdFilter,
  clampFacultyNameFilter,
} from '../common';
import { EducationService } from './education.service';
import { RecruitmentService } from './recruitment.service';
import {
  EducationRefreshService,
  REFRESHABLE_CUBES,
  type RefreshableCube,
} from './education-refresh.service';

const RecruitmentQuerySchema = z.object({
  entryYearBE: z.coerce.number().int().min(2400).max(2700).optional(),
  facultyId: z.string().min(1).optional(),
  level: z.enum(['BACHELOR', 'MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA']).optional(),
});

// Express coerces a query param that appears once into a string and
// twice or more into a string[]. We normalise both to string[] at the
// schema layer so the service interfaces stay clean.
const StringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): string[] => {
    if (v === undefined) return [];
    if (Array.isArray(v)) return v.filter((x) => x.length > 0);
    return v.length > 0 ? [v] : [];
  });

const NumberArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): number[] => {
    const arr = v === undefined ? [] : Array.isArray(v) ? v : [v];
    return arr
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
  });

const StatusGroupArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): Array<'INCOMING' | 'CURRENT' | 'FORMER'> => {
    const allowed = new Set(['INCOMING', 'CURRENT', 'FORMER']);
    const arr = v === undefined ? [] : Array.isArray(v) ? v : [v];
    return arr.filter((x): x is 'INCOMING' | 'CURRENT' | 'FORMER' =>
      allowed.has(x),
    );
  });

const StudentInfoQuerySchema = z.object({
  facultyName: StringArray,
  programLevel: StringArray,
  programName: StringArray,
  statusCode: NumberArray,
  statusGroup: StatusGroupArray,
});
type StudentInfoQuery = z.infer<typeof StudentInfoQuerySchema>;

const LocationQuerySchema = z.object({
  cohortYearBe: NumberArray,
  facultyName: StringArray,
  programLevel: StringArray,
  programName: StringArray,
  region: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v): Array<'NORTH' | 'NORTHEAST' | 'CENTRAL' | 'EAST' | 'WEST' | 'SOUTH'> => {
      const allowed = new Set([
        'NORTH',
        'NORTHEAST',
        'CENTRAL',
        'EAST',
        'WEST',
        'SOUTH',
      ]);
      const arr = v === undefined ? [] : Array.isArray(v) ? v : [v];
      return arr.filter((x): x is 'NORTH' | 'NORTHEAST' | 'CENTRAL' | 'EAST' | 'WEST' | 'SOUTH' =>
        allowed.has(x),
      );
    }),
});
type LocationQuery = z.infer<typeof LocationQuerySchema>;

const TuitionQuerySchema = z.object({
  semester: StringArray,
  facultyName: StringArray,
});
type TuitionQuery = z.infer<typeof TuitionQuerySchema>;

const PerformanceQuerySchema = z.object({
  facultyName: StringArray,
  programLevel: StringArray,
  programName: StringArray,
  region: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v): Array<'NORTH' | 'NORTHEAST' | 'CENTRAL' | 'EAST' | 'WEST' | 'SOUTH'> => {
      const allowed = new Set([
        'NORTH',
        'NORTHEAST',
        'CENTRAL',
        'EAST',
        'WEST',
        'SOUTH',
      ]);
      const arr = v === undefined ? [] : Array.isArray(v) ? v : [v];
      return arr.filter((x): x is 'NORTH' | 'NORTHEAST' | 'CENTRAL' | 'EAST' | 'WEST' | 'SOUTH' =>
        allowed.has(x),
      );
    }),
});
type PerformanceQuery = z.infer<typeof PerformanceQuerySchema>;

@Controller('/education')
export class EducationController {
  constructor(
    private readonly education: EducationService,
    private readonly refresher: EducationRefreshService,
    private readonly recruitment: RecruitmentService,
  ) {}

  @Get('recruitment')
  @Authorized('institution:read:dashboard')
  async recruitmentDashboard(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(RecruitmentQuerySchema))
    q: z.infer<typeof RecruitmentQuerySchema>,
  ) {
    assertCanSeeFacultyDashboards(user);
    // FACULTY_USER → facultyId is forced to user.facultyId regardless
    // of what the URL says. Admin-grade + UNIVERSITY_USER pass through.
    const clamped = clampFacultyIdFilter(
      { facultyId: q.facultyId ?? null },
      user,
    );
    return this.recruitment.getDashboard({
      entryYearBE: q.entryYearBE ?? null,
      facultyId: clamped.facultyId,
      level: q.level ?? null,
    });
  }

  @Post('refresh')
  @Authorized('institution:read:university')
  @AuditLog({
    action: 'education.refresh_cubes',
    entityType: 'EducationCubeRefresh',
  })
  async refresh(
    @AuthSession() user: SessionUser,
    @Body(
      new ZodValidationPipe(
        z
          .object({
            cubes: z
              .array(
                z.enum([
                  'student',
                  'location',
                  'tuition',
                  'performance',
                  'entryScores',
                  'recruitment',
                ]),
              )
              .optional(),
          })
          .default({}),
      ),
    )
    body: { cubes?: RefreshableCube[] },
  ) {
    assertUniversityWide(user);
    // Validate cube list — null / empty array means refresh everything.
    const cubes =
      body.cubes && body.cubes.length > 0
        ? body.cubes.filter((c): c is RefreshableCube =>
            REFRESHABLE_CUBES.includes(c),
          )
        : undefined;
    const result = await this.refresher.refresh(user.userId, cubes);
    return {
      startedAt: result.startedAt.toISOString(),
      completedAt: result.completedAt.toISOString(),
      durationMs: result.completedAt.getTime() - result.startedAt.getTime(),
      recordsByCube: result.recordsByCube,
      cubes,
    };
  }

  @Get('refresh/status')
  @Authorized('institution:read:university')
  async refreshStatus(@AuthSession() user: SessionUser) {
    assertUniversityWide(user);
    const latest = await this.refresher.latestPerCube();
    return {
      isRunning: this.refresher.isRunning(),
      cubes: latest.map((r) => ({
        cubeName: r.cubeName,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        recordsLoaded: r.recordsLoaded,
        durationMs: r.durationMs,
        errorMessage: r.errorMessage,
      })),
    };
  }

  @Get('student-info')
  @Authorized('institution:read:dashboard')
  async studentInfo(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(StudentInfoQuerySchema)) q: StudentInfoQuery,
  ) {
    assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null) return this.education.studentInfo({ ...q, facultyName: ['__none__'] });
    return this.education.studentInfo(clamped);
  }

  @Get('by-location')
  @Authorized('institution:read:dashboard')
  async byLocation(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(LocationQuerySchema)) q: LocationQuery,
  ) {
    assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null) return this.education.byLocation({ ...q, facultyName: ['__none__'] });
    return this.education.byLocation(clamped);
  }

  @Get('active-pivot')
  @Authorized('institution:read:dashboard')
  async activePivot(@AuthSession() user: SessionUser) {
    assertCanSeeFacultyDashboards(user);
    const facultyName = await this.resolveFacultyNameClamp(user);
    return this.education.activePivot(
      facultyName === '__none__' ? { facultyName: '__none__' } : { facultyName },
    );
  }

  @Get('international')
  @Authorized('institution:read:dashboard')
  async international(@AuthSession() user: SessionUser) {
    assertCanSeeFacultyDashboards(user);
    const facultyName = await this.resolveFacultyNameClamp(user);
    return this.education.international(
      facultyName === '__none__' ? { facultyName: '__none__' } : { facultyName },
    );
  }

  /** Returns the Thai faculty name to clamp queries to for FACULTY_USER,
   *  or `undefined` for admin-grade + UNIVERSITY_USER (no clamp).
   *  '__none__' is a sentinel for "user has no resolvable faculty" so
   *  the cube query yields zero rows. */
  private async resolveFacultyNameClamp(
    user: SessionUser,
  ): Promise<string | '__none__' | undefined> {
    if (user.role !== 'FACULTY_USER') return undefined;
    if (!user.facultyId) return '__none__';
    const faculty = await prisma.faculty.findUnique({
      where: { id: user.facultyId },
      select: { nameTh: true },
    });
    return faculty?.nameTh ?? '__none__';
  }

  @Get('tuition')
  @Authorized('institution:read:dashboard')
  async tuition(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(TuitionQuerySchema)) q: TuitionQuery,
  ) {
    assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null) return this.education.tuition({ ...q, facultyName: ['__none__'] });
    return this.education.tuition(clamped);
  }

  // ── Performance dashboard endpoints ──────────────────────────────

  @Get('performance/overall')
  @Authorized('institution:read:dashboard')
  async performanceOverall(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(PerformanceQuerySchema)) q: PerformanceQuery,
  ) {
    assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.education.performanceOverall({ ...q, facultyName: ['__none__'] });
    return this.education.performanceOverall(clamped);
  }

  @Get('performance/by-program')
  @Authorized('institution:read:dashboard')
  async performanceByProgram(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(PerformanceQuerySchema)) q: PerformanceQuery,
  ) {
    assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.education.performanceByProgram({ ...q, facultyName: ['__none__'] });
    return this.education.performanceByProgram(clamped);
  }

  @Get('performance/by-location')
  @Authorized('institution:read:dashboard')
  async performanceByLocation(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(PerformanceQuerySchema)) q: PerformanceQuery,
  ) {
    assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.education.performanceByLocation({ ...q, facultyName: ['__none__'] });
    return this.education.performanceByLocation(clamped);
  }

  @Get('entry-scores')
  @Authorized('institution:read:dashboard')
  async entryScores(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(PerformanceQuerySchema)) q: PerformanceQuery,
  ) {
    assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.education.entryScores({ ...q, facultyName: ['__none__'] });
    return this.education.entryScores(clamped);
  }
}
