/**
 * The group a campaign row's planned-seat figure belongs to.
 *
 * Planned seats are summed as MAX(plan) per recruitment programme, because
 * a Thai registrar's export repeats one programme's PLAN_PER_YEAER across
 * every campaign track it runs — summing the rows naively would multiply
 * the intended intake by the number of tracks.
 *
 * A spreadsheet-imported row has no recruitment-programme id; the adopter
 * states planned seats on the row itself. Such a row is therefore its own
 * group, keyed on the round and campaign that already identify it, so two
 * campaigns in one year both count instead of collapsing into the larger.
 *
 * The prefixes keep the two namespaces apart: a registrar id that happens
 * to contain the separator can never collide with a synthesised key.
 */
export function campaignPlanKey(row: {
  recruitmentProgramId: string | null;
  round: string;
  campaignName: string;
}): string {
  return row.recruitmentProgramId !== null
    ? `pid:${row.recruitmentProgramId}`
    : `row:${row.round}\u0000${row.campaignName}`;
}
