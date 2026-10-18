/**
 * Whether an import may stamp its own run onto a row that already exists.
 *
 * Start-over deletes the rows an import's own runs created. So claiming a
 * row another source wrote would put that source's data inside this
 * dataset's blast radius — an adopter who corrects one year of tuition and
 * later starts over would take the registrar's whole history with it.
 *
 * It claims in exactly two cases, both of which are rows no live source
 * owns: a null run (legacy or hand-seeded data, which `realDataWhere()`
 * hides until something claims it) and a mocked run (demo seed). In both,
 * stamping is what makes the uploaded figures visible at all.
 *
 * This diverges from the connectors, which rewrite `ingestionRunId` on
 * every update. They can: nothing deletes by connector run id.
 */
export function claimsRow(existing: {
  ingestionRunId: string | null;
  ingestionRun: { dataSource: { mocked: boolean } } | null;
}): boolean {
  if (existing.ingestionRunId === null) return true;
  return existing.ingestionRun?.dataSource.mocked === true;
}

/** The `select` that `claimsRow` needs, for the loader's existence query. */
export const PROVENANCE_SELECT = {
  ingestionRunId: true,
  ingestionRun: { select: { dataSource: { select: { mocked: true } } } },
} as const;
