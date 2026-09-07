import { Logger } from '@nestjs/common';
import { aiModelHealth, prisma } from '@kku/db';

const logger = new Logger('ModelHealthNotifier');

/**
 * Daily at 04:00 Asia/Bangkok (repeat + an immediate one-off boot run — see
 * ingestion.service.ts) — after the 02:00 backup and 03:00 backup
 * verification timers, so the three operational jobs never overlap.
 *
 * Audience is SUPER_ADMIN only, deliberately narrower than the
 * `isAdminGrade` set (SUPER_ADMIN + SYSTEM_ADMIN) that reads
 * /admin/system-status. Only SUPER_ADMIN can actually change a pin at
 * /admin/app/ai-settings — alerting people who cannot act on it trains them
 * to ignore the bell.
 *
 * Dedup is per (entityId, admin), not per entityId: entityId carries the
 * method AND the effective model, so re-pinning to a DIFFERENT bad model
 * raises a fresh alert instead of being suppressed by the old one, and —
 * because the check is "which admins already hold an unread row for this
 * entityId", not "does any unread row exist" — an admin promoted to
 * SUPER_ADMIN while a pin is already broken still gets notified on the next
 * sweep, even though other admins were already notified about it. Methods
 * that recover to 'ok' have their outstanding alerts marked read: an inbox
 * full of alarms for things already fixed teaches people to ignore the
 * bell, which is how a real alert gets missed.
 *
 * Each verdict is handled in its own try/catch. A DB hiccup while
 * processing one method must never abort the sweep for every method after
 * it — a monitoring feature that silently drops alerts on partial failure
 * reintroduces exactly the "nothing told anyone" bug it exists to catch.
 */
export async function runModelHealthNotifier(): Promise<void> {
  const verdicts = await aiModelHealth();
  const admins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true },
  });

  for (const v of verdicts) {
    try {
      if (v.status === 'ok') {
        await prisma.notification.updateMany({
          where: {
            kind: 'ai_model_health',
            entityType: 'ai_model_override',
            entityId: { startsWith: `${v.methodPrefix}:` },
            readAt: null,
          },
          data: { readAt: new Date() },
        });
        continue;
      }

      const entityId = `${v.methodPrefix}:${v.effectiveModel}`;
      const alreadyNotified = await prisma.notification.findMany({
        where: { kind: 'ai_model_health', entityType: 'ai_model_override', entityId, readAt: null },
        select: { userId: true },
      });
      const notifiedIds = new Set(alreadyNotified.map((n) => n.userId));
      const toNotify = admins.filter((admin) => !notifiedIds.has(admin.id));

      for (const admin of toNotify) {
        await prisma.notification.create({
          data: {
            userId: admin.id,
            kind: 'ai_model_health',
            severity: v.status === 'failing' ? 'high' : 'medium',
            title: `AI model problem: ${v.methodPrefix}`,
            bodyEn: v.detail,
            entityType: 'ai_model_override',
            entityId,
          },
        });
      }
    } catch (err) {
      logger.error(
        `model-health notify failed for ${v.methodPrefix} (${v.effectiveModel}): ` +
          `${(err as Error).message}`,
      );
    }
  }
}
