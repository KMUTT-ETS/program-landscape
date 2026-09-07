import { aiModelHealth, prisma } from '@kku/db';

/**
 * Daily at 04:00 Asia/Bangkok — after the 02:00 backup and 03:00 backup
 * verification timers, so the three operational jobs never overlap.
 *
 * entityId carries the MODEL as well as the method, so re-running while a pin
 * is still broken suppresses a duplicate, while repinning to a DIFFERENT bad
 * model raises a fresh alert. Methods that return to ok have their outstanding
 * notifications marked read: an inbox full of alarms for things already fixed
 * teaches people to ignore the bell, which is how a real alert gets missed.
 */
export async function runModelHealthNotifier(): Promise<void> {
  const verdicts = await aiModelHealth();
  const admins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true },
  });

  for (const v of verdicts) {
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
    const existing = await prisma.notification.findFirst({
      where: { kind: 'ai_model_health', entityType: 'ai_model_override', entityId, readAt: null },
      select: { id: true },
    });
    if (existing) continue;

    for (const admin of admins) {
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
  }
}
