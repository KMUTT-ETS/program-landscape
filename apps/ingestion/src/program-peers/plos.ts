import { prisma } from '@kku/db';

/**
 * The programme's PLOs, in order, from the program_learning_outcomes table
 * (filled by program-overlap prep from PROGRAM_SKILLS_DETAILED). Labels such as
 * "PLO 1.1" are already stripped. Empty when the table has no rows for it.
 */
export async function loadProgramPlos(programId: string): Promise<string[]> {
  const rows = await prisma.programLearningOutcome.findMany({
    where: { programId },
    orderBy: { ordinal: 'asc' },
    select: { textNormalised: true },
  });
  return rows.map((r) => r.textNormalised);
}
