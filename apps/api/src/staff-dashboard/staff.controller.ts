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
  workforce(@Query(new ZodValidationPipe(StaffFilterSchema)) q: z.infer<typeof StaffFilterSchema>) {
    return this.staff.workforce(q);
  }

  @Get('faculty-by-program')
  @Authorized('programs:read:all')
  facultyByProgram() {
    return this.staff.facultyByProgram();
  }

  @Get('research')
  @Authorized('programs:read:all')
  research(@Query(new ZodValidationPipe(StaffFilterSchema)) q: z.infer<typeof StaffFilterSchema>) {
    return this.staff.researchOutput(q);
  }

  @Get('compensation')
  @Authorized('programs:read:all')
  compensation(@Query(new ZodValidationPipe(StaffFilterSchema)) q: z.infer<typeof StaffFilterSchema>) {
    return this.staff.compensation(q);
  }
}
