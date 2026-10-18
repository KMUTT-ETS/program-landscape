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
 * Say the second half of that out loud, because it is the part that costs
 * someone data: claiming a row ALSO pulls it into start-over's reach. A
 * legacy row with null provenance that an upload corrects is removed whole
 * by a later start-over, not reverted to what it held before. That trade is
 * deliberate — an unclaimed row is invisible, and an invisible row the
 * operator believes they just uploaded is the worse failure — and
 * docs/data-import.md states it in those terms.
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
