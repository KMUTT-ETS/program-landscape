// Dev-only: populate research_outputs.scholar_authors for existing
// google-scholar rows by re-parsing each member's most recent archived
// Scholar fetch (scholar_fetch_archives), so no pages are scraped again.
//   pnpm --filter @kku/db exec tsx scripts/scholar-authors-backfill.ts          (dry run)
//   pnpm --filter @kku/db exec tsx scripts/scholar-authors-backfill.ts --apply
import { Prisma } from '@prisma/client';
import { parseScholarPublications } from '@kku/shared';
import { prisma } from '../src/index';

// Must equal ARCHIVE_PAGE_BREAK in src/scholar-fetch.ts.
const PAGE_BREAK = '\n<!-- kku:scholar-page-break -->\n';
const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const archives = await prisma.scholarFetchArchive.findMany({
    orderBy: { createdAt: 'desc' },
    select: { rawPayload: true, fetchRun: { select: { facultyMemberId: true } } },
  });
  const members = new Set<string>();
  let rows = 0;
  for (const archive of archives) {
    const memberId = archive.fetchRun.facultyMemberId;
    if (!memberId || members.has(memberId)) continue; // newest archive per member only
    members.add(memberId);
    const papers = archive.rawPayload.split(PAGE_BREAK).flatMap((html) => parseScholarPublications(html));
    for (const p of papers) {
      if (!p.authors) continue;
      const where: Prisma.ResearchOutputWhereInput = {
        facultyMemberId: memberId,
        scholarPaperId: p.scholarPaperId,
        source: 'google-scholar',
        scholarAuthors: { equals: Prisma.DbNull },
      };
      if (apply) {
        const result = await prisma.researchOutput.updateMany({
          where,
          data: {
            scholarAuthors: { names: p.authors.names, complete: p.authors.complete, fetchedAt: new Date().toISOString() },
          },
        });
        rows += result.count;
      } else {
        rows += await prisma.researchOutput.count({ where });
      }
    }
  }
  console.log(`${apply ? 'updated' : 'would update'} ${rows} row(s) across ${members.size} member(s)`);
  if (apply && members.size > 0) {
    // The epoch is PUBLICATIONS_CACHE_INVALIDATED_MS: the next profile load recomputes.
    await prisma.staffPublicationsCache.updateMany({
      where: { facultyMemberId: { in: [...members] } },
      data: { fetchedAt: new Date(0) },
    });
  }
  await prisma.$disconnect();
}

void main();
