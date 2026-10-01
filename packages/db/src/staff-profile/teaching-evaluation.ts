// Teaching-evaluation summary for one staff record — the single loader behind
// the /profile "My teaching evaluation" panel and the external staff-profile
// API's `teachingEvaluation` section. The summarising itself is the pure,
// browser-safe summariseTeachingEvaluation in @kku/shared.
import { summariseTeachingEvaluation, type TeachingEvaluationSummary } from '@kku/shared';
import { prisma } from '../index';
import { instructorPersonal } from '../evaluations';

/** Teaching-evaluation summary for one staff record. Callers enforce visibility:
 *  /profile passes the session user's own record; the external API only calls it
 *  for clients granted the `teachingEvaluation` section. */
export async function getStaffTeachingEvaluation(
  facultyMemberId: string,
): Promise<TeachingEvaluationSummary | null> {
  const [result, lastRun] = await Promise.all([
    instructorPersonal(facultyMemberId),
    prisma.ingestionRun.findFirst({
      where: { status: 'SUCCEEDED', dataSource: { slug: 'kku-evaluations' } },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    }),
  ]);
  return summariseTeachingEvaluation(result, lastRun?.completedAt?.toISOString() ?? null);
}
