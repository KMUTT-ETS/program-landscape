import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import { prisma } from '@kku/db';
import {
  AuthSession,
  Authorized,
  ZodValidationPipe,
  assertCanSeeFacultyDashboards,
  assertUniversityWide,
  clampFacultyNameFilter,
  resolveEffectiveScope,
} from '../common';
import { StaffService } from './staff.service';
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

const TeachingWorkloadDeepDiveSchema = TeachingWorkloadQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  onlyUnresolved: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
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
// need staffType/track/budget/nationality. We DO need source + yearFrom
// because the kku-publications corpus has multiple sources
// (Scopus / PubMed / legacy OpenAlex) and a configurable time window.
// Active-only is hardcoded at the service layer — this view shows
// active employees only by design.
const ResearchFilterSchema = z.object({
  facultyName: StringArray,
  sources: StringArray,
  yearFrom: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .refine((v) => v === undefined || (Number.isInteger(v) && v >= 1900 && v <= 2100), {
      message: 'yearFrom must be an integer between 1900 and 2100',
    }),
});

// Staff dashboard reads from the staff-master + compensation cubes.
// Visibility: admin-grade + UNIVERSITY_USER see everything; FACULTY_USER
// gets the same UI but every list/aggregate is clamped to user.facultyId
// at the server. PROGRAM_USER is excluded (no per-program variant).
// Refresh endpoints stay university-only — a FACULTY_USER shouldn't
// trigger a global cube rebuild.

@Controller('/staff-dashboard')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly queue: IngestionQueueService,
    private readonly teaching: TeachingWorkloadService,
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
  // Scope clamp axis is the TEACHER's home faculty (fm.faculty_id), not
  // the course-owning faculty — a Math teacher teaching a service course
  // to Engineering students still counts as Math's load. Admin /
  // UNIVERSITY_USER pass `facultyIds=null` (no clamp).

  @Get('teaching-workload/filter-options')
  @Authorized('institution:read:dashboard')
  async teachingWorkloadFilterOptions(@AuthSession() user: SessionUser) {
    await assertCanSeeFacultyDashboards(user);
    const facultyIds = await this.resolveTeachingFacultyIds(user);
    return this.teaching.filterOptions(facultyIds);
  }

  @Get('teaching-workload/summary')
  @Authorized('institution:read:dashboard')
  async teachingWorkloadSummary(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(TeachingWorkloadQuerySchema))
    q: z.infer<typeof TeachingWorkloadQuerySchema>,
  ) {
    await assertCanSeeFacultyDashboards(user);
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
    await assertCanSeeFacultyDashboards(user);
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
    await assertCanSeeFacultyDashboards(user);
    const filter = await this.resolveTeachingFilter(user, q);
    return this.teaching.byFaculty(filter);
  }

  @Get('teaching-workload/teachers')
  @Authorized('institution:read:dashboard')
  async teachingWorkloadTeachers(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(TeachingWorkloadDeepDiveSchema))
    q: z.infer<typeof TeachingWorkloadDeepDiveSchema>,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const filter = await this.resolveTeachingFilter(user, q);
    return this.teaching.teachers({
      ...filter,
      limit: q.limit ?? 500,
      onlyUnresolved: q.onlyUnresolved,
    });
  }

  /**
   * Resolve the user's effective faculty grants to a list of Faculty.id
   * for the teaching-workload service. Returns `null` for admin /
   * UNIVERSITY_USER (no clamp), or an array of granted IDs otherwise.
   *
   * PROGRAM_USER without faculty/uni grant has already been 403'd by
   * `assertCanSeeFacultyDashboards`. PROGRAM_USER WITH a FACULTY_USER
   * UserScope grant inherits the faculty's full teacher list.
   */
  private async resolveTeachingFacultyIds(
    user: SessionUser,
  ): Promise<string[] | null> {
    const eff = await resolveEffectiveScope(user);
    if (eff.mode === 'all') return null;
    if (eff.mode === 'none') return [];
    // Programs granted directly roll up to their faculty so the teacher
    // list is still meaningful at the faculty level.
    const facultyIds = new Set<string>(eff.facultyIds);
    if (eff.programIds.length > 0) {
      const progs = await prisma.program.findMany({
        where: { id: { in: eff.programIds } },
        select: { facultyId: true },
      });
      for (const p of progs) facultyIds.add(p.facultyId);
    }
    return [...facultyIds];
  }

  private async resolveTeachingFilter(
    user: SessionUser,
    q: z.infer<typeof TeachingWorkloadQuerySchema>,
  ): Promise<TeachingWorkloadFilter> {
    const facultyIds = await this.resolveTeachingFacultyIds(user);
    let acadYearBE = q.acadYearBE;
    let semester = q.semester;
    if (acadYearBE === undefined || semester === undefined) {
      const latest = await this.teaching.resolveLatestSnapshot(facultyIds);
      if (latest) {
        acadYearBE = acadYearBE ?? latest.acadYearBE;
        semester = semester ?? latest.semester;
      }
    }
    return {
      facultyIds,
      acadYearBE,
      semester,
      levelName: q.levelName,
    };
  }
}
