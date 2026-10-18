import { Prisma } from '@prisma/client';

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
 * to contain the separator can never collide with a synthesised key. The
 * separator is the ASCII unit separator rather than NUL, because Postgres
 * refuses a NUL byte in text and the same key has to be computable in SQL
 * (campaignPlanKeySql below).
 */
export function campaignPlanKey(row: {
  recruitmentProgramId: string | null;
  round: string;
  campaignName: string;
}): string {
  return row.recruitmentProgramId !== null
    ? `pid:${row.recruitmentProgramId}`
    : `row:${row.round}\u001f${row.campaignName}`;
}

/**
 * `campaignPlanKey` as SQL, for the readers that aggregate in the database.
 *
 * A plain `GROUP BY recruitment_program_id` folds every NULL into ONE
 * group, so an installation whose campaigns all came from a spreadsheet
 * would report the largest single plan as its entire intake. The two
 * implementations are pinned to each other by
 * test/campaign-plan-key-sql.test.ts; change one and change the other.
 */
export function campaignPlanKeySqlText(alias: string): string {
  return `COALESCE(
    'pid:' || ${alias}.recruitment_program_id,
    'row:' || ${alias}.round || chr(31) || ${alias}.campaign_name
  )`;
}

/** The same fragment for a tagged-template query. One definition, two shapes. */
export function campaignPlanKeySql(alias: string): Prisma.Sql {
  return Prisma.raw(campaignPlanKeySqlText(alias));
}
