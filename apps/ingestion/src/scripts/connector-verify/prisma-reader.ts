import type { PrismaClient } from '@kku/db';

import type { RowCounts, RunSummary, VerifyReader } from './types';
import { DATASET_VISIBILITY } from './visibility';

/** The database side of `connector:verify`. Reads only. */
export function createPrismaReader(prisma: PrismaClient): VerifyReader {
  return {
    async dataSources(slugs) {
      return prisma.dataSource.findMany({
        where: { slug: { in: [...slugs] } },
        select: { slug: true, mocked: true, baseUrl: true },
      });
    },

    async latestRun(sourceSlug): Promise<RunSummary | null> {
      const run = await prisma.ingestionRun.findFirst({
        where: { dataSource: { slug: sourceSlug } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          startedAt: true,
          errorCode: true,
          errorMessage: true,
          recordsFetched: true,
          recordsLoaded: true,
          recordsFailed: true,
          metadata: true,
        },
      });
      return run ?? null;
    },

    async rowCounts(dataset, importRunId): Promise<RowCounts | null> {
      const v = DATASET_VISIBILITY[dataset];
      if (!v) return null;
      const [stamped, visible, linked] = await Promise.all([
        v.count(prisma, importRunId, 'stamped'),
        v.count(prisma, importRunId, 'visible'),
        v.countLinked ? v.countLinked(prisma, importRunId) : Promise.resolve(null),
      ]);
      return { stamped, visible, linked };
    },
  };
}
