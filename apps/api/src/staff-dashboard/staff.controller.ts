import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import { prisma } from '@kku/db';
import { AuthSession, Authorized, ZodValidationPipe } from '../common';
import { StaffService } from './staff.service';
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

// Roles that see the whole university unfiltered. Everyone else
// (FACULTY_USER, PROGRAM_USER) is clamped to their own faculty so
// staff PII for other faculties never crosses the wire.
function seesAllFaculties(role: SessionUser['role']): boolean {
  return (
    role === 'SUPER_ADMIN' ||
    role === 'SYSTEM_ADMIN' ||
    role === 'UNIVERSITY_USER'
  );
}

// Resolves the user's own facultyName (Thai) once per request and
// rewrites any incoming facultyName filter to that single value.
// Returns the rewritten filter — or null if the user can't see
// anything (FACULTY_USER without an assigned facultyId).
async function clampFacultyFilter<F extends { facultyName: string[] }>(
  filter: F,
  user: SessionUser,
): Promise<F | null> {
  if (seesAllFaculties(user.role)) return filter;
  if (!user.facultyId) return null;
  const faculty = await prisma.faculty.findUnique({
    where: { id: user.facultyId },
    select: { nameTh: true, nameEn: true },
  });
  if (!faculty) return null;
  // Staff data is keyed off Thai faculty name (matches the StaffMasterRecord
  // import format from KKU HR). Replace whatever the client sent.
  return { ...filter, facultyName: [faculty.nameTh] };
}

@Controller('/staff-dashboard')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly queue: IngestionQueueService,
  ) {}

  @Get('filter-options')
  @Authorized('programs:read:all')
  filterOptions() {
    return this.staff.filterOptions();
  }

  @Post('refresh')
  @Authorized('programs:read:all')
  async refresh(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(RefreshBodySchema)) body: { slugs?: StaffSlug[] },
  ) {
    const slugs = (body.slugs && body.slugs.length > 0 ? body.slugs : STAFF_REFRESH_SLUGS) as StaffSlug[];
    const queued: Array<{ slug: string; jobId: string }> = [];
    for (const slug of slugs) {
      const jobId = await this.queue.enqueueManual(slug, user.userId);
      queued.push({ slug, jobId });
    }
    return { queued };
  }

  @Get('refresh/status')
  @Authorized('programs:read:all')
  async refreshStatus() {
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
  @Authorized('programs:read:all')
  async workforce(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(StaffFilterSchema)) q: z.infer<typeof StaffFilterSchema>,
  ) {
    const clamped = await clampFacultyFilter(q, user);
    if (!clamped) return this.staff.workforce({ ...q, facultyName: ['__none__'] });
    return this.staff.workforce(clamped);
  }

  @Get('faculty-by-program')
  @Authorized('programs:read:all')
  async facultyByProgram(@AuthSession() user: SessionUser) {
    // FACULTY_USER + PROGRAM_USER see only programs in their own faculty.
    if (seesAllFaculties(user.role)) return this.staff.facultyByProgram();
    if (!user.facultyId) return [];
    return this.staff.facultyByProgram({ facultyId: user.facultyId });
  }

  @Get('research')
  @Authorized('programs:read:all')
  async research(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ResearchFilterSchema)) q: z.infer<typeof ResearchFilterSchema>,
  ) {
    const clamped = await clampFacultyFilter(q, user);
    if (!clamped) return this.staff.researchOutput({ ...q, facultyName: ['__none__'] });
    return this.staff.researchOutput(clamped);
  }

  @Get('compensation')
  @Authorized('programs:read:all')
  async compensation(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(StaffFilterSchema)) q: z.infer<typeof StaffFilterSchema>,
  ) {
    const clamped = await clampFacultyFilter(q, user);
    if (!clamped) return this.staff.compensation({ ...q, facultyName: ['__none__'] });
    return this.staff.compensation(clamped);
  }
}
