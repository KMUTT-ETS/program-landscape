import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
} from '../common';

const SubscribeBodySchema = z.object({
  filterType: z.enum(['program', 'skill', 'sector', 'signal_type']),
  filterValue: z.string().min(1).max(120),
  minImpactScore: z.coerce.number().min(0).max(1).default(0),
});
type SubscribeBody = z.infer<typeof SubscribeBodySchema>;

@Controller('/notifications')
export class NotificationsController {
  @Get()
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'notifications', name: 'In-app notifications' }] })
  async list(
    @AuthSession() user: SessionUser,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Math.min(Number(limitRaw ?? '50') || 50, 200);
    const rows = await prisma.notification.findMany({
      where: {
        userId: user.userId,
        ...(unreadOnly === 'true' ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const unreadCount = await prisma.notification.count({
      where: { userId: user.userId, readAt: null },
    });
    return { notifications: rows, unreadCount };
  }

  @Post(':id/mark-read')
  @Authorized('programs:read:all')
  async markRead(@AuthSession() user: SessionUser, @Param('id') id: string) {
    // Only the owner can flip their own row.
    await prisma.notification.updateMany({
      where: { id, userId: user.userId },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  @Post('mark-all-read')
  @Authorized('programs:read:all')
  async markAllRead(@AuthSession() user: SessionUser) {
    const { count } = await prisma.notification.updateMany({
      where: { userId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  // ── Subscriptions ────────────────────────────────────────────────
  @Get('subscriptions')
  @Authorized('programs:read:all')
  async listSubs(@AuthSession() user: SessionUser) {
    return prisma.signalSubscription.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('subscriptions')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'notifications.subscribe', entityType: 'SignalSubscription' })
  async subscribe(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(SubscribeBodySchema)) body: SubscribeBody,
  ) {
    return prisma.signalSubscription.upsert({
      where: {
        userId_filterType_filterValue: {
          userId: user.userId,
          filterType: body.filterType,
          filterValue: body.filterValue,
        },
      },
      update: {
        minImpactScore: body.minImpactScore,
        isActive: true,
      },
      create: {
        userId: user.userId,
        filterType: body.filterType,
        filterValue: body.filterValue,
        minImpactScore: body.minImpactScore,
        isActive: true,
      },
    });
  }

  @Delete('subscriptions/:id')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'notifications.unsubscribe', entityType: 'SignalSubscription' })
  async unsubscribe(@AuthSession() user: SessionUser, @Param('id') id: string) {
    await prisma.signalSubscription.deleteMany({
      where: { id, userId: user.userId },
    });
    return { ok: true };
  }
}
