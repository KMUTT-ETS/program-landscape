import { ApiError } from '@kku/shared';

import type { ImportLoadContext } from '../types';

// Helpers shared by the programme-scoped datasets that replace only their own
// earlier uploads (digital competency, employer feedback).

/** Ids of every run written by one dataset's own uploads, the current run included. */
export async function ownRunIds(tx: ImportLoadContext['tx'], slug: string): Promise<string[]> {
  const runs = await tx.ingestionRun.findMany({
    where: { dataSource: { slug } },
    select: { id: true },
  });
  return runs.map((r) => r.id);
}

/** Refuses a file naming a programme code that does not exist, telling the operator what to do. */
export function assertProgrammeCodesExist(
  codes: readonly string[],
  found: ReadonlySet<string>,
): void {
  for (const code of codes) {
    if (!found.has(code)) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `Programme code "${code}" does not exist. Upload the Programmes sheet first.`,
      );
    }
  }
}
