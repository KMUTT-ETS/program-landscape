import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  ZodValidationPipe,
  assertCanSeeFacultyDashboards,
  assertCanSeeProgramAwareDashboards,
  assertProgramAccessible,
  assertUniversityWide,
  clampFacultyIdFilter,
  clampFacultyNameFilter,
  resolveOfferingScope,
} from '../common';
import { EducationService } from './education.service';
import { RecruitmentService } from './recruitment.service';
import { ClassOfferingsService, type ClassOfferingsFilter } from './class-offerings.service';
import { EvaluationsService } from './evaluations.service';
import { AiJobsQueueService } from '../ai-jobs/ai-jobs-queue.service';
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

// Class-GPA — distinct from PerformanceQuery (student GPA cube uses
// region; class GPA uses acadYearBE/semester/geOnly from class_offerings).
// Reuses the StringArray + NumberArray helpers declared at the top of
// this file (lines 35 + 44).
const ClassGpaQuerySchema = z.object({
  facultyName: StringArray,
  levelName: StringArray,
  acadYearBE: NumberArray,
  semester: NumberArray,
  geOnly: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
});
type ClassGpaQuery = z.infer<typeof ClassGpaQuerySchema>;

const ClassOfferingsQuerySchema = z.object({
  facultyName: StringArray,
  acadYearBE: z.coerce.number().int().min(2500).max(2700).optional(),
  semester: z.coerce.number().int().min(1).max(4).optional(),
  levelName: StringArray,
  geOnly: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});
type ClassOfferingsQuery = z.infer<typeof ClassOfferingsQuerySchema>;

// Student-evaluation filter (POWERBI.EVALUATE_INSTRUCTOR). Reuses
// StringArray + NumberArray helpers from the top of this file.
const SatisfactionQuerySchema = z.object({
  facultyName: StringArray,
  acadYearBE: NumberArray,
  semester: NumberArray,
});
type SatisfactionQuery = z.infer<typeof SatisfactionQuerySchema>;

@Controller('/education')
export class EducationController {
  constructor(
    private readonly education: EducationService,
    private readonly refresher: EducationRefreshService,
    private readonly recruitment: RecruitmentService,
    private readonly classOfferings: ClassOfferingsService,
    private readonly evaluations: EvaluationsService,
    private readonly aiJobs: AiJobsQueueService,
  ) {}

  @Get('recruitment')
  @Authorized('institution:read:dashboard')
  async recruitmentDashboard(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(RecruitmentQuerySchema))
    q: z.infer<typeof RecruitmentQuerySchema>,
  ) {
    await assertCanSeeFacultyDashboards(user);
    // FACULTY_USER → facultyId is forced to user.facultyId regardless
    // of what the URL says. Admin-grade + UNIVERSITY_USER pass through.
    const clamped = await clampFacultyIdFilter(
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
    await assertUniversityWide(user);
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
    await assertUniversityWide(user);
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

  // ───── Class offerings + class GPA refresh ────────────────────────
  //
  // class_offerings (incl. the grade-distribution columns + precomputed
  // class_gpa) is NOT an ingestion-framework connector — it's loaded by
  // the link-class-offerings script. POST enqueues a RUN_CLASS_OFFERINGS_LINK
  // BullMQ job; the ingestion worker spawns the bundled script. GET
  // reports the table's freshness (it carries a refreshedAt column) +
  // whether a refresh job is currently in flight.

  @Post('class-offerings/refresh')
  @Authorized('institution:read:university')
  @AuditLog({
    action: 'education.refresh_class_offerings',
    entityType: 'ClassOfferingRefresh',
  })
  async classOfferingsRefresh(@AuthSession() user: SessionUser) {
    await assertUniversityWide(user);
    const jobId = await this.aiJobs.enqueue({
      kind: 'RUN_CLASS_OFFERINGS_LINK',
      // entityId is an unused sentinel — the refresh is portfolio-wide.
      entityId: '__all__',
      trigger: 'MANUAL',
      triggeredByUserId: user.userId,
    });
    return { jobId };
  }

  @Get('class-offerings/refresh/status')
  @Authorized('institution:read:university')
  async classOfferingsRefreshStatus(@AuthSession() user: SessionUser) {
    await assertUniversityWide(user);
    const [agg, running] = await Promise.all([
      prisma.classOffering.aggregate({
        _count: { _all: true },
        _max: { refreshedAt: true },
      }),
      this.aiJobs.countRunning('RUN_CLASS_OFFERINGS_LINK'),
    ]);
    const withGpa = await prisma.classOffering.count({
      where: { classGpa: { not: null } },
    });
    return {
      isRunning: running > 0,
      rowCount: agg._count._all,
      withGpaCount: withGpa,
      lastRefreshedAt: agg._max.refreshedAt?.toISOString() ?? null,
    };
  }

  @Get('student-info')
  @Authorized('institution:read:dashboard')
  async studentInfo(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(StudentInfoQuerySchema)) q: StudentInfoQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
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
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null) return this.education.byLocation({ ...q, facultyName: ['__none__'] });
    return this.education.byLocation(clamped);
  }

  @Get('active-pivot')
  @Authorized('institution:read:dashboard')
  async activePivot(@AuthSession() user: SessionUser) {
    await assertCanSeeFacultyDashboards(user);
    const facultyName = await this.resolveFacultyNameClamp(user);
    return this.education.activePivot(
      facultyName === '__none__' ? { facultyName: '__none__' } : { facultyName },
    );
  }

  @Get('international')
  @Authorized('institution:read:dashboard')
  async international(@AuthSession() user: SessionUser) {
    await assertCanSeeFacultyDashboards(user);
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
    await assertCanSeeFacultyDashboards(user);
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
    await assertCanSeeFacultyDashboards(user);
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
    await assertCanSeeFacultyDashboards(user);
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
    await assertCanSeeFacultyDashboards(user);
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
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.education.entryScores({ ...q, facultyName: ['__none__'] });
    return this.education.entryScores(clamped);
  }

  // ───── /education/performance — class GPA (new in v1.2.9) ─────────────
  // Class GPA computed from ClassOffering grade distributions, distinct
  // from STUDENT cumulative GPA above. Same role-clamp pattern via
  // clampFacultyNameFilter so a FACULTY_USER sees only their faculty's
  // classes.

  @Get('performance/class-gpa/overall')
  @Authorized('institution:read:dashboard')
  async classGpaOverall(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ClassGpaQuerySchema)) q: ClassGpaQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.education.classGpaOverall({ ...q, facultyName: ['__none__'] });
    return this.education.classGpaOverall(clamped);
  }

  @Get('performance/class-gpa/trend')
  @Authorized('institution:read:dashboard')
  async classGpaTrend(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ClassGpaQuerySchema)) q: ClassGpaQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.education.classGpaTrend({ ...q, facultyName: ['__none__'] });
    return this.education.classGpaTrend(clamped);
  }

  @Get('performance/class-gpa/by-program')
  @Authorized('institution:read:dashboard')
  async classGpaByProgram(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ClassGpaQuerySchema)) q: ClassGpaQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.education.classGpaByProgram({ ...q, facultyName: ['__none__'] });
    return this.education.classGpaByProgram(clamped);
  }

  @Get('performance/class-gpa/courses/:programId')
  @Authorized('institution:read:dashboard')
  async classGpaCourses(
    @AuthSession() user: SessionUser,
    @Param('programId') programId: string,
    @Query(new ZodValidationPipe(ClassGpaQuerySchema)) q: ClassGpaQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    // Per-program clamp. The course drill lives behind the parent
    // by-program table (which the page-level facultyName filter
    // narrows) — but a crafted URL with another faculty's programId
    // would otherwise bypass that narrowing. assertProgramAccessible
    // throws 403 for FACULTY_USER / PROGRAM_USER trying to peek
    // outside their scope.
    await assertProgramAccessible(programId, user);
    return this.education.classGpaByCourse(programId, {
      acadYearBE: q.acadYearBE,
      semester: q.semester,
    });
  }

  // ───── /education/class-offerings — subject offerings & fulfilment ─────
  //
  // Scope clamp:
  //   admin / UNIVERSITY_USER — see everything
  //   FACULTY_USER            — see their faculty's class offerings
  //                             (clamps c.registry_faculty_name)
  //   PROGRAM_USER            — see only courses in their program(s)
  //                             via program_courses (extracted from
  //                             the curriculum PDF; falls back to
  //                             teacher-derived for un-digested programs)
  //   mixed                   — OR of the above

  @Get('class-offerings/filter-options')
  @Authorized('institution:read:dashboard')
  async classOfferingsFilterOptions(@AuthSession() user: SessionUser) {
    await assertCanSeeProgramAwareDashboards(user);
    const scope = await resolveOfferingScope(user);
    return this.classOfferings.filterOptions(scope);
  }

  @Get('class-offerings/summary')
  @Authorized('institution:read:dashboard')
  async classOfferingsSummary(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ClassOfferingsQuerySchema)) q: ClassOfferingsQuery,
  ) {
    await assertCanSeeProgramAwareDashboards(user);
    const filter = await this.resolveClassOfferingsFilter(user, q);
    return this.classOfferings.summary(filter);
  }

  @Get('class-offerings/heatmap')
  @Authorized('institution:read:dashboard')
  async classOfferingsHeatmap(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ClassOfferingsQuerySchema)) q: ClassOfferingsQuery,
  ) {
    await assertCanSeeProgramAwareDashboards(user);
    // Heatmap deliberately spans all years/semesters — strip those filters.
    const filter = await this.resolveClassOfferingsFilter(user, q);
    return this.classOfferings.heatmap({
      scope: filter.scope,
      levelName: filter.levelName,
      geOnly: filter.geOnly,
    });
  }

  @Get('class-offerings/distribution')
  @Authorized('institution:read:dashboard')
  async classOfferingsDistribution(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ClassOfferingsQuerySchema)) q: ClassOfferingsQuery,
  ) {
    await assertCanSeeProgramAwareDashboards(user);
    const filter = await this.resolveClassOfferingsFilter(user, q);
    return this.classOfferings.distribution(filter);
  }

  @Get('class-offerings/ge')
  @Authorized('institution:read:dashboard')
  async classOfferingsGe(@AuthSession() user: SessionUser) {
    await assertCanSeeProgramAwareDashboards(user);
    const scope = await resolveOfferingScope(user);
    return this.classOfferings.geBreakdown(scope);
  }

  @Get('class-offerings/deep-dive')
  @Authorized('institution:read:dashboard')
  async classOfferingsDeepDive(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ClassOfferingsQuerySchema)) q: ClassOfferingsQuery,
  ) {
    await assertCanSeeProgramAwareDashboards(user);
    const filter = await this.resolveClassOfferingsFilter(user, q);
    return this.classOfferings.deepDiveDrillDown(filter);
  }

  /**
   * Shared resolver: build the offering scope from the caller's
   * effective grants and default to the latest snapshot when the
   * query doesn't pin (acadYearBE, semester).
   */
  private async resolveClassOfferingsFilter(
    user: SessionUser,
    q: ClassOfferingsQuery,
  ): Promise<ClassOfferingsFilter> {
    const scope = await resolveOfferingScope(user);
    let acadYearBE = q.acadYearBE;
    let semester = q.semester;
    if (acadYearBE === undefined || semester === undefined) {
      const latest = await this.classOfferings.resolveLatestSnapshot(scope);
      if (latest) {
        acadYearBE = acadYearBE ?? latest.acadYearBE;
        semester = semester ?? latest.semester;
      }
    }
    return {
      scope,
      acadYearBE,
      semester,
      levelName: q.levelName,
      geOnly: q.geOnly,
    };
  }

  // ───── /education/satisfaction — student-evaluation dashboard ─────────
  //
  // Course-aggregated only (no per-instructor names exposed here — those
  // live on /staff/teaching with tiered visibility). Scope-clamped:
  //   admin / UNIVERSITY_USER — all faculties
  //   FACULTY_USER            — their faculty (via clampFacultyNameFilter)
  //   PROGRAM_USER            — rolls up to their faculty (program-level
  //                             evaluations don't exist at course-aggregate)
  //
  // PDPA gate is enforced at ingestion (rows with n<5 never reach DB);
  // no additional suppression needed at the query layer.

  @Get('satisfaction/overall')
  @Authorized('institution:read:dashboard')
  async satisfactionOverall(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(SatisfactionQuerySchema)) q: SatisfactionQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.evaluations.overall({ ...q, facultyName: ['__none__'] });
    return this.evaluations.overall(clamped);
  }

  @Get('satisfaction/by-course')
  @Authorized('institution:read:dashboard')
  async satisfactionByCourse(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(SatisfactionQuerySchema)) q: SatisfactionQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.evaluations.coursesByYear({ ...q, facultyName: ['__none__'] });
    return this.evaluations.coursesByYear(clamped);
  }

  @Get('satisfaction/by-program')
  @Authorized('institution:read:dashboard')
  async satisfactionByProgram(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(SatisfactionQuerySchema)) q: SatisfactionQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.evaluations.coursesByProgram({ ...q, facultyName: ['__none__'] });
    return this.evaluations.coursesByProgram(clamped);
  }

  // GET /education/satisfaction/course-questions?...scope&...filter
  //
  // Per-question detail at any scope. The hover tooltip on every rating
  // cell calls this — the scope is set by which cell the user is hovering
  // (faculty row × overall column → just facultyId; course row × year
  // column → courseCode + programId + acadYearBE; etc.). Inherits the
  // page-level filter (facultyName / semester) on top.
  @Get('satisfaction/course-questions')
  @Authorized('institution:read:dashboard')
  async satisfactionCourseQuestions(
    @AuthSession() user: SessionUser,
    @Query('facultyId') facultyId: string | undefined,
    @Query('programLevel') programLevel: string | undefined,
    @Query('programId') programId: string | undefined,
    @Query('courseCode') courseCode: string | undefined,
    @Query('acadYearBE') acadYearBEStr: string | undefined,
    @Query(new ZodValidationPipe(SatisfactionQuerySchema)) q: SatisfactionQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    // When a programId is supplied, verify the user can access that
    // program. The SQL clamp would zero-out cross-faculty results
    // anyway, but the explicit 403 is a cleaner UX signal.
    if (programId) await assertProgramAccessible(programId, user);
    const clamped = await clampFacultyNameFilter(q, user);
    const filter = clamped === null ? { ...q, facultyName: ['__none__'] } : clamped;
    const acadYearBE = acadYearBEStr ? Number(acadYearBEStr) : undefined;
    return this.evaluations.courseQuestionDetail({
      facultyId,
      programLevel,
      programId,
      courseCode,
      acadYearBE: Number.isFinite(acadYearBE) ? acadYearBE : undefined,
      filter,
    });
  }

  // GET /education/satisfaction/course-detail?courseCode=X&programId=Y&...filter
  //
  // Richer payload for the click-to-drill panel below the pivot. Returns
  // summary KPIs + (year × sem) trend + per-question heatmap for one
  // (program × course) pair. Course-aggregated — no instructor names.
  @Get('satisfaction/course-detail')
  @Authorized('institution:read:dashboard')
  async satisfactionCourseDetail(
    @AuthSession() user: SessionUser,
    @Query('courseCode') courseCode: string,
    @Query('programId') programId: string,
    @Query(new ZodValidationPipe(SatisfactionQuerySchema)) q: SatisfactionQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    // Per-program access — matches the class-GPA `courses/:programId`
    // pattern. FACULTY_USER / PROGRAM_USER can't drill into a course
    // outside their granted scope even via a crafted URL.
    await assertProgramAccessible(programId, user);
    const clamped = await clampFacultyNameFilter(q, user);
    const filter = clamped === null ? { ...q, facultyName: ['__none__'] } : clamped;
    return this.evaluations.courseDetail({ programId, courseCode, filter });
  }

  @Get('satisfaction/trend')
  @Authorized('institution:read:dashboard')
  async satisfactionTrend(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(SatisfactionQuerySchema)) q: SatisfactionQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.evaluations.trend({ ...q, facultyName: ['__none__'] });
    return this.evaluations.trend(clamped);
  }

  @Get('satisfaction/question-gaps')
  @Authorized('institution:read:dashboard')
  async satisfactionQuestionGaps(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(SatisfactionQuerySchema)) q: SatisfactionQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.evaluations.questionGaps({ ...q, facultyName: ['__none__'] });
    return this.evaluations.questionGaps(clamped);
  }

  @Get('satisfaction/questions')
  @Authorized('institution:read:dashboard')
  async satisfactionQuestions(@AuthSession() user: SessionUser) {
    await assertCanSeeFacultyDashboards(user);
    return this.evaluations.questionCatalog();
  }
}
