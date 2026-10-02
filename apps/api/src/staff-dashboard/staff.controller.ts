import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import { prisma } from '@kku/db';
import {
  AuditLog,
  AuthSession,
  Authorized,
  ZodValidationPipe,
  assertCanSeeFacultyDashboards,
  assertCanSeeProgramAwareDashboards,
  assertUniversityWide,
  clampFacultyNameFilter,
  resolveOfferingScope,
} from '../common';
import { StaffService } from './staff.service';
import { GrantsService, detailScopeNames } from './grants.service';
import {
  TeachingWorkloadService,
  type TeachingWorkloadFilter,
} from './teaching-workload.service';
import { IngestionQueueService } from '../data-sources/ingestion-queue.service';

const STAFF_REFRESH_SLUGS = [
  'unicon-ds2001',
  'unicon-ds2003',
  'unicon-ds2004',
  'kku-hr-processed',
  'kku-research-services',
] as const;
type StaffSlug = (typeof STAFF_REFRESH_SLUGS)[number];

const RefreshBodySchema = z
  .object({
    slugs: z.array(z.enum(STAFF_REFRESH_SLUGS)).optional(),
  })
  .default({});

const StringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): string[] => {
    if (v === undefined) return [];
    if (Array.isArray(v)) return v.filter((x) => x.length > 0);
    return v.length > 0 ? [v] : [];
  });

const TrackArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): Array<'ACADEMIC' | 'SUPPORT'> => {
    const arr = v === undefined ? [] : Array.isArray(v) ? v : [v];
    return arr.filter((x): x is 'ACADEMIC' | 'SUPPORT' => x === 'ACADEMIC' || x === 'SUPPORT');
  });

const TeachingWorkloadQuerySchema = z.object({
  acadYearBE: z.coerce.number().int().min(2500).max(2700).optional(),
  semester: z.coerce.number().int().min(1).max(4).optional(),
  levelName: StringArray,
});

const StaffFilterSchema = z.object({
  facultyName: StringArray,
  staffTypeId: StringArray,
  track: TrackArray,
  academicStandingId: StringArray,
  positionLevelId: StringArray,
  budgetId: StringArray,
  nationalityId: StringArray,
});

// Research view has its own narrower filter set — we drive it off
// FacultyMember + ResearchOutput (not staff_master_records), so we don't
// need staffType/track/budget/nationality. We DO need source + a time
// filter because the kku-publications corpus has multiple sources
// (Scopus / PubMed / legacy OpenAlex). The time filter is either:
//   - yearFrom (accumulate from this year forward, inclusive), OR
//   - yearExact (only this specific year)
// yearExact wins when both are present.
const yearValidator = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined ? undefined : Number(v)))
  .refine((v) => v === undefined || (Number.isInteger(v) && v >= 1900 && v <= 2100), {
    message: 'year must be an integer between 1900 and 2100',
  });

const GrantTypeArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): Array<'RESEARCH' | 'ACADEMIC_SERVICE' | 'CONSULTING' | 'OTHER'> => {
    const arr = v === undefined ? [] : Array.isArray(v) ? v : [v];
    return arr.filter((x): x is 'RESEARCH' | 'ACADEMIC_SERVICE' | 'CONSULTING' | 'OTHER' =>
      ['RESEARCH', 'ACADEMIC_SERVICE', 'CONSULTING', 'OTHER'].includes(x));
  });

const beYear = z.coerce.number().int().min(2500).max(2700).optional();

const GrantsFilterSchema = z.object({
  facultyName: StringArray,
  yearFrom: beYear,
  yearTo: beYear,
  type: GrantTypeArray,
  funder: StringArray,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  sort: z.enum(['year', 'budget', 'title']).default('year'),
}).transform((q) =>
  // A reversed range is swapped, as /staff/research does, rather than returning nothing.
  q.yearFrom !== undefined && q.yearTo !== undefined && q.yearFrom > q.yearTo
    ? { ...q, yearFrom: q.yearTo, yearTo: q.yearFrom }
    : q,
);

const ResearchFilterSchema = z.object({
  facultyName: StringArray,
  sources: StringArray,
  // Inclusive [yearFrom, yearTo] window driven by the UI range slider.
  yearFrom: yearValidator,
  yearTo: yearValidator,
  // Legacy single-year alias (older bookmarked URLs); the slider no
  // longer emits it but the service still honours it.
  yearExact: yearValidator,
});

// Staff dashboard reads from the staff-master + compensation cubes.
// Visibility: admin-grade + UNIVERSITY_USER see everything; FACULTY_USER
// gets the same UI but every list/aggregate is clamped to user.facultyId
// at the server. PROGRAM_USER is admitted too: the clamp rolls their
// programme up to its faculty (these dashboards have no per-program variant).
// Refresh endpoints stay university-only — a FACULTY_USER shouldn't
// trigger a global cube rebuild.

@Controller('/staff-dashboard')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly queue: IngestionQueueService,
    private readonly teaching: TeachingWorkloadService,
    private readonly grants: GrantsService,
  ) {}

  @Get('filter-options')
  @Authorized('institution:read:dashboard')
  async filterOptions(@AuthSession() user: SessionUser) {
    await assertCanSeeFacultyDashboards(user);
    if (user.role === 'FACULTY_USER' && user.facultyId) {
      const faculty = await prisma.faculty.findUnique({
        where: { id: user.facultyId },
        select: { nameTh: true },
      });
      return this.staff.filterOptions({
        facultyName: faculty?.nameTh ?? '__none__',
      });
    }
    return this.staff.filterOptions();
  }

  @Post('refresh')
  @Authorized('institution:read:university')
  @AuditLog({ action: 'ingestion.run_now', entityType: 'DataSource' })
  async refresh(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(RefreshBodySchema)) body: { slugs?: StaffSlug[] },
  ) {
    await assertUniversityWide(user);
    const slugs = (body.slugs && body.slugs.length > 0 ? body.slugs : STAFF_REFRESH_SLUGS) as StaffSlug[];
    const queued: Array<{ slug: string; jobId: string }> = [];
    for (const slug of slugs) {
      const jobId = await this.queue.enqueueManual(slug, user.userId);
      queued.push({ slug, jobId });
    }
    return { queued };
  }

  @Get('refresh/status')
  @Authorized('institution:read:dashboard')
  async refreshStatus(@AuthSession() user: SessionUser) {
    await assertCanSeeFacultyDashboards(user);
    const slugs = [...STAFF_REFRESH_SLUGS];
    const sources = await prisma.dataSource.findMany({
      where: { slug: { in: slugs } },
      select: { id: true, slug: true, name: true },
    });
    const out: Array<{
      slug: string;
      name: string;
      status: string | null;
      startedAt: string | null;
      completedAt: string | null;
      recordsLoaded: number | null;
      durationMs: number | null;
      errorMessage: string | null;
    }> = [];
    for (const slug of slugs) {
      const source = sources.find((s) => s.slug === slug);
      if (!source) {
        out.push({ slug, name: slug, status: null, startedAt: null, completedAt: null, recordsLoaded: null, durationMs: null, errorMessage: null });
        continue;
      }
      const latest = await prisma.ingestionRun.findFirst({
        where: { dataSourceId: source.id },
        orderBy: { createdAt: 'desc' },
        select: { status: true, startedAt: true, completedAt: true, recordsLoaded: true, durationMs: true, errorMessage: true },
      });
      out.push({
        slug,
        name: source.name,
        status: latest?.status ?? null,
        startedAt: latest?.startedAt?.toISOString() ?? null,
        completedAt: latest?.completedAt?.toISOString() ?? null,
        recordsLoaded: latest?.recordsLoaded ?? null,
        durationMs: latest?.durationMs ?? null,
        errorMessage: latest?.errorMessage ?? null,
      });
    }
    return { sources: out };
  }

  @Get('workforce')
  @Authorized('institution:read:dashboard')
  async workforce(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(StaffFilterSchema)) q: z.infer<typeof StaffFilterSchema>,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.staff.workforce({ ...q, facultyName: ['__none__'] });
    return this.staff.workforce(clamped);
  }

  @Get('faculty-by-program')
  @Authorized('institution:read:dashboard')
  async facultyByProgram(@AuthSession() user: SessionUser) {
    await assertCanSeeFacultyDashboards(user);
    const facultyId =
      user.role === 'FACULTY_USER' && user.facultyId ? user.facultyId : undefined;
    return this.staff.facultyByProgram({ facultyId });
  }

  @Get('research')
  @Authorized('institution:read:dashboard')
  async research(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ResearchFilterSchema)) q: z.infer<typeof ResearchFilterSchema>,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.staff.researchOutput({ ...q, facultyName: ['__none__'] });
    return this.staff.researchOutput(clamped);
  }

  @Get('grants')
  @Authorized('institution:read:dashboard')
  async grantsDashboard(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(GrantsFilterSchema)) q: z.infer<typeof GrantsFilterSchema>,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    return this.grants.dashboard(clamped ?? { ...q, facultyName: ['__none__'] });
  }

  @Get('grants/:id')
  @Authorized('institution:read:dashboard')
  async grantDetail(@AuthSession() user: SessionUser, @Param('id') id: string) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter({ facultyName: [] as string[] }, user);
    return this.grants.detail(id, detailScopeNames(clamped));
  }

  @Get('compensation')
  @Authorized('institution:read:dashboard')
  async compensation(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(StaffFilterSchema)) q: z.infer<typeof StaffFilterSchema>,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.staff.compensation({ ...q, facultyName: ['__none__'] });
    return this.staff.compensation(clamped);
  }

  // ───── /staff-dashboard/teaching-workload — subject teaching workload ─────
  //
  // Scope clamp:
  //   admin / UNIVERSITY_USER — see everything
  //   FACULTY_USER            — teachers whose home faculty is granted
  //                             (clamps fm.faculty_id, NOT the course-
  //                             owning faculty, so a Math teacher
  //                             running a GE service course still
  //                             counts as Math's load)
  //   PROGRAM_USER            — teachers who teach the program's
  //                             courses (clamps c.course_code via
  //                             program_courses, includes GE)
  //   mixed                   — OR of the above

  @Get('teaching-workload/filter-options')
  @Authorized('institution:read:dashboard')
  async teachingWorkloadFilterOptions(@AuthSession() user: SessionUser) {
    await assertCanSeeProgramAwareDashboards(user);
    const scope = await resolveOfferingScope(user);
    return this.teaching.filterOptions(scope);
  }

  @Get('teaching-workload/summary')
  @Authorized('institution:read:dashboard')
  async teachingWorkloadSummary(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(TeachingWorkloadQuerySchema))
    q: z.infer<typeof TeachingWorkloadQuerySchema>,
  ) {
    await assertCanSeeProgramAwareDashboards(user);
    const filter = await this.resolveTeachingFilter(user, q);
    return this.teaching.summary(filter);
  }

  @Get('teaching-workload/histogram')
  @Authorized('institution:read:dashboard')
  async teachingWorkloadHistogram(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(TeachingWorkloadQuerySchema))
    q: z.infer<typeof TeachingWorkloadQuerySchema>,
  ) {
    await assertCanSeeProgramAwareDashboards(user);
    const filter = await this.resolveTeachingFilter(user, q);
    return this.teaching.histogram(filter);
  }

  @Get('teaching-workload/by-faculty')
  @Authorized('institution:read:dashboard')
  async teachingWorkloadByFaculty(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(TeachingWorkloadQuerySchema))
    q: z.infer<typeof TeachingWorkloadQuerySchema>,
  ) {
    await assertCanSeeProgramAwareDashboards(user);
    const filter = await this.resolveTeachingFilter(user, q);
    return this.teaching.byFaculty(filter);
  }

  @Get('teaching-workload/teachers')
  @Authorized('institution:read:dashboard')
  async teachingWorkloadTeachers(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(TeachingWorkloadQuerySchema))
    q: z.infer<typeof TeachingWorkloadQuerySchema>,
  ) {
    await assertCanSeeProgramAwareDashboards(user);
    const filter = await this.resolveTeachingFilter(user, q);
    return this.teaching.teachersDrillDown(filter);
  }

  @Get('teaching-workload/students-by-faculty')
  @Authorized('institution:read:dashboard')
  async teachingWorkloadStudentsByFaculty(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(TeachingWorkloadQuerySchema))
    q: z.infer<typeof TeachingWorkloadQuerySchema>,
  ) {
    await assertCanSeeProgramAwareDashboards(user);
    const filter = await this.resolveTeachingFilter(user, q);
    return this.teaching.studentsByFaculty(filter);
  }

  private async resolveTeachingFilter(
    user: SessionUser,
    q: z.infer<typeof TeachingWorkloadQuerySchema>,
  ): Promise<TeachingWorkloadFilter> {
    const scope = await resolveOfferingScope(user);
    let acadYearBE = q.acadYearBE;
    let semester = q.semester;
    if (acadYearBE === undefined || semester === undefined) {
      const latest = await this.teaching.resolveLatestSnapshot(scope);
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
    };
  }
}
