import type { Prisma, PrismaClient } from '@prisma/client';

/** DataSource slug of the programme-courses spreadsheet import. */
export const PROGRAMME_COURSES_SOURCE_SLUG = 'xlsx-programme-courses';

/** Why the PDF extractor leaves an import-owned programme alone. */
export const IMPORT_OWNED_SKIP_REASON =
  'course list supplied by spreadsheet import — not re-extracting';

/**
 * Course rows written by the spreadsheet import for the given programmes.
 * Ownership is the run link, not `methodVersion`: start-over deletes by run
 * id, so ownership and hand-back follow the same relation.
 */
export function importOwnedCourseWhere(
  programIds: readonly string[],
): Prisma.ProgramCourseWhereInput {
  return {
    programId: { in: [...programIds] },
    ingestionRun: { dataSource: { slug: PROGRAMME_COURSES_SOURCE_SLUG } },
  };
}

/** The subset of `programIds` whose course list was supplied by the import. */
export async function importOwnedProgramIds(
  client: Prisma.TransactionClient | PrismaClient,
  programIds: readonly string[],
): Promise<Set<string>> {
  if (programIds.length === 0) return new Set();
  const rows = await client.programCourse.findMany({
    where: importOwnedCourseWhere(programIds),
    select: { programId: true },
    distinct: ['programId'],
  });
  return new Set(rows.map((r) => r.programId));
}
