import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { Prisma, prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
} from '../common';

// Trends Radar API — feed, detail, by-program, by-skill, annotate,
// mark-reviewed, weekly digest PDF.

const ListQuerySchema = z.object({
  signalType: z.enum(['POLICY', 'RESEARCH', 'MARKET', 'TECH', 'NEWS']).optional(),
  // Time window in days from now; 7/30/90/365 are the canonical options.
  windowDays: z.coerce.number().int().positive().max(3650).default(90),
  minImpactScore: z.coerce.number().min(0).max(1).default(0),
  // Free-text search over title + Thai/English summary.
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
type ListQuery = z.infer<typeof ListQuerySchema>;

const AnnotateBodySchema = z.object({
  bodyEn: z.string().optional(),
  bodyTh: z.string().optional(),
  kind: z.enum(['comment', 'review_note']).default('comment'),
});
type AnnotateBody = z.infer<typeof AnnotateBodySchema>;

@Controller('/trends')
export class TrendsController {
  @Get()
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'trend-signals', name: 'Trend Signals' }] })
  async list(@Query(new ZodValidationPipe(ListQuerySchema)) q: ListQuery) {
    const since = new Date(Date.now() - q.windowDays * 24 * 60 * 60 * 1000);
    const where: Prisma.TrendSignalWhereInput = {
      detectedDate: { gte: since },
      impactScore: { gte: q.minImpactScore },
    };
    if (q.signalType) where.signalType = q.signalType;
    if (q.search) {
      where.OR = [
        { title: { contains: q.search, mode: 'insensitive' } },
        { summaryTh: { contains: q.search } },
        { summaryEn: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const [signals, total] = await Promise.all([
      prisma.trendSignal.findMany({
        where,
        orderBy: [{ impactScore: 'desc' }, { detectedDate: 'desc' }],
        skip: q.offset,
        take: q.limit,
      }),
      prisma.trendSignal.count({ where }),
    ]);
    const windowStart = since;

    // Summary counts matching the top-of-page "127 signals…" line.
    const [highImpactCount, dangerZoneCount] = await Promise.all([
      prisma.trendSignal.count({
        where: { detectedDate: { gte: since }, impactScore: { gte: 0.7 } },
      }),
      // "affecting programs in danger zone" needs a cross-join against
      // cockpit health scores. For v1 we return 0 — the cross-join is a
      // worthwhile prompt-08 deliverable (Gap Analyzer computes this
      // routinely). Placeholder keeps the shape stable.
      Promise.resolve(0),
    ]);

    return {
      total,
      windowStart: windowStart.toISOString(),
      highImpactCount,
      dangerZoneCount,
      signals: signals.map(toDto),
    };
  }

  @Get('by-program/:programId')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'trend-signals', name: 'Trend Signals' }] })
  async byProgram(@Param('programId') programId: string) {
    const rows = await prisma.trendSignal.findMany({
      where: { affectedProgramIds: { has: programId } },
      orderBy: { detectedDate: 'desc' },
      take: 50,
    });
    return { signals: rows.map(toDto) };
  }

  @Get('by-skill/:skillId')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'trend-signals', name: 'Trend Signals' }] })
  async bySkill(@Param('skillId') skillId: string) {
    const rows = await prisma.trendSignal.findMany({
      where: { affectedSkillIds: { has: skillId } },
      orderBy: { detectedDate: 'desc' },
      take: 50,
    });
    return { signals: rows.map(toDto) };
  }

  @Get('digest/weekly')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'trend-signals', name: 'Trend Signals' }] })
  async weeklyDigest() {
    // Returns the DATA for a weekly digest — the PDF itself is cut by
    // POST /pdf/generate from the cockpit's digest template. Separating
    // shape from format means the in-app "digest view" and the PDF
    // share one source of truth.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const signals = await prisma.trendSignal.findMany({
      where: { detectedDate: { gte: since } },
      orderBy: [{ impactScore: 'desc' }, { detectedDate: 'desc' }],
      take: 30,
    });
    const weekLabel = `สัปดาห์ที่ ${weekOfYear(since)} ปี ${new Date().getFullYear() + 543}`;
    const dateLabel = formatThaiDate(new Date());
    return {
      weekLabel,
      dateLabel,
      overview:
        `สัญญาณทั้งหมด ${signals.length} ชิ้นในรอบสัปดาห์ที่ผ่านมา · ` +
        `สัญญาณผลกระทบสูง ${signals.filter((s) => s.impactScore >= 0.7).length} ชิ้น`,
      signals: signals.map((s) => ({
        id: s.id,
        titleTh: s.title,
        source: s.sourceUrl ?? 'unspecified',
        signalType: s.signalType,
        summary: s.summaryTh ?? s.summaryEn ?? '',
        implicationForKku: undefined,
        url: s.sourceUrl ?? undefined,
      })),
    };
  }

  @Get(':id')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'trend-signals', name: 'Trend Signals' }] })
  async getOne(@Param('id') id: string) {
    const signal = await prisma.trendSignal.findUnique({ where: { id } });
    if (!signal) throw new NotFoundException();
    // Annotations + related AiInference for the "show reasoning" panel.
    const [annotations, ai] = await Promise.all([
      prisma.annotation.findMany({
        where: { entityType: 'trend_signal', entityId: id },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true, email: true } } },
        take: 20,
      }),
      signal.aiInferenceId
        ? prisma.aiInference.findUnique({ where: { id: signal.aiInferenceId } })
        : Promise.resolve(null),
    ]);
    // Resolve affected programs + skills into display shape.
    const [programs, skills] = await Promise.all([
      signal.affectedProgramIds.length > 0
        ? prisma.program.findMany({
            where: { id: { in: signal.affectedProgramIds } },
            select: { id: true, code: true, nameEn: true, nameTh: true },
          })
        : Promise.resolve([]),
      signal.affectedSkillIds.length > 0
        ? prisma.skill.findMany({
            where: { id: { in: signal.affectedSkillIds } },
            select: { id: true, nameEn: true, nameTh: true },
          })
        : Promise.resolve([]),
    ]);
    return {
      signal: toDto(signal),
      aiInference: ai
        ? {
            id: ai.id,
            model: ai.model,
            prompt: ai.prompt,
            response: ai.response,
            confidence: ai.confidence,
            latencyMs: ai.latencyMs,
          }
        : null,
      programs,
      skills,
      annotations: annotations.map((a) => ({
        id: a.id,
        kind: a.kind,
        bodyEn: a.bodyEn,
        bodyTh: a.bodyTh,
        author: a.user.name ?? a.user.email,
        createdAt: a.createdAt,
      })),
    };
  }

  @Post(':id/annotate')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'trend.annotate', entityType: 'Annotation' })
  async annotate(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AnnotateBodySchema)) body: AnnotateBody,
  ) {
    return prisma.annotation.create({
      data: {
        userId: user.userId,
        entityType: 'trend_signal',
        entityId: id,
        kind: body.kind,
        bodyEn: body.bodyEn,
        bodyTh: body.bodyTh,
      },
    });
  }

  @Post(':id/mark-reviewed')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'trend.mark_reviewed', entityType: 'Annotation' })
  async markReviewed(@AuthSession() user: SessionUser, @Param('id') id: string) {
    // Review state lives as an Annotation with kind='signal_review' +
    // bodyEn='reviewed'. Keeps TrendSignal append-only while still
    // giving the UI a "mark as seen" affordance.
    return prisma.annotation.create({
      data: {
        userId: user.userId,
        entityType: 'trend_signal',
        entityId: id,
        kind: 'signal_review',
        bodyEn: 'reviewed',
      },
    });
  }
}

function toDto(s: {
  id: string;
  signalType: 'POLICY' | 'RESEARCH' | 'MARKET' | 'TECH' | 'NEWS';
  title: string;
  summaryTh: string | null;
  summaryEn: string | null;
  sourceUrl: string | null;
  detectedDate: Date;
  impactScore: number;
  affectedProgramIds: string[];
  affectedSkillIds: string[];
  aiInferenceId: string | null;
}) {
  return {
    id: s.id,
    signalType: s.signalType,
    title: s.title,
    summaryTh: s.summaryTh,
    summaryEn: s.summaryEn,
    sourceUrl: s.sourceUrl,
    detectedDate: s.detectedDate.toISOString(),
    impactScore: s.impactScore,
    affectedProgramIds: s.affectedProgramIds,
    affectedSkillIds: s.affectedSkillIds,
    aiInferenceId: s.aiInferenceId,
  };
}

function weekOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
}

function formatThaiDate(d: Date): string {
  const months = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear() + 543}`;
}
