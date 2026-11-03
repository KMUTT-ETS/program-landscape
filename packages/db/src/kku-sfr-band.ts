import type { Prisma, PrismaClient, SfrBand } from '@prisma/client';

/**
 * KKU's student:staff-ratio bands, by faculty code AND KKU's Thai faculty
 * name. Before Faculty.sfrBand existed this was a code map inside
 * health-score.ts. Matching the name as well as the code keeps an adopter
 * whose codes happen to coincide (EN, MD, ...) from being given KKU's bands.
 *
 * The migration 20261103120000_faculty_sfr_band carries the same pairs; a
 * test asserts they agree.
 */
export const KKU_SFR_BANDS: ReadonlyArray<{ code: string; nameTh: string; band: SfrBand }> = [
  { code: 'MD', nameTh: 'คณะแพทยศาสตร์', band: 'CLINICAL' },
  { code: 'DT', nameTh: 'คณะทันตแพทยศาสตร์', band: 'CLINICAL' },
  { code: 'VM', nameTh: 'คณะสัตวแพทยศาสตร์', band: 'CLINICAL' },
  { code: 'NU', nameTh: 'คณะพยาบาลศาสตร์', band: 'CLINICAL' },
  { code: 'AMS', nameTh: 'คณะเทคนิคการแพทย์', band: 'CLINICAL' },
  { code: 'PH', nameTh: 'คณะสาธารณสุขศาสตร์', band: 'CLINICAL' },
  { code: 'PHA', nameTh: 'คณะเภสัชศาสตร์', band: 'CLINICAL' },
  { code: 'AG', nameTh: 'คณะเกษตรศาสตร์', band: 'STEM_LAB' },
  { code: 'SC', nameTh: 'คณะวิทยาศาสตร์', band: 'STEM_LAB' },
  { code: 'EN', nameTh: 'คณะวิศวกรรมศาสตร์', band: 'STEM_LAB' },
  { code: 'TC', nameTh: 'คณะเทคโนโลยี', band: 'STEM_LAB' },
  { code: 'COC', nameTh: 'วิทยาลัยการคอมพิวเตอร์', band: 'STEM_LAB' },
  { code: 'AR', nameTh: 'คณะสถาปัตยกรรมศาสตร์', band: 'STUDIO' },
  { code: 'FAR', nameTh: 'คณะศิลปกรรมศาสตร์', band: 'STUDIO' },
  { code: 'BS', nameTh: 'คณะบริหารธุรกิจและการบัญชี', band: 'PROFESSIONAL' },
  { code: 'LAW', nameTh: 'คณะนิติศาสตร์', band: 'PROFESSIONAL' },
  { code: 'EC', nameTh: 'คณะเศรษฐศาสตร์', band: 'PROFESSIONAL' },
  { code: 'COPA', nameTh: 'วิทยาลัยนโยบายและกิจการสาธารณะ', band: 'PROFESSIONAL' },
  { code: 'IC', nameTh: 'วิทยาลัยนานาชาติ', band: 'PROFESSIONAL' },
  { code: 'NK', nameTh: 'คณะสหวิทยาการ', band: 'PROFESSIONAL' },
  { code: 'GS', nameTh: 'บัณฑิตวิทยาลัย', band: 'PROFESSIONAL' },
  { code: 'MBA', nameTh: 'วิทยาลัยบัณฑิตศึกษาการจัดการ', band: 'PROFESSIONAL' },
  { code: 'HU', nameTh: 'คณะมนุษยศาสตร์และสังคมศาสตร์', band: 'HUMANITIES' },
  { code: 'ED', nameTh: 'คณะศึกษาศาสตร์', band: 'HUMANITIES' },
];

/** Minimal client surface, so it runs against PrismaClient or a transaction. */
export type SfrBackfillClient = Pick<PrismaClient | Prisma.TransactionClient, 'faculty'>;

/**
 * Sets KKU's bands on KKU-named faculties whose band is still null. Never
 * overwrites a stored band, so operator edits win. Idempotent.
 */
export async function backfillKkuSfrBands(client: SfrBackfillClient): Promise<{ updated: number }> {
  let updated = 0;
  for (const { code, nameTh, band } of KKU_SFR_BANDS) {
    const res = await client.faculty.updateMany({
      where: { code, nameTh, sfrBand: null },
      data: { sfrBand: band },
    });
    updated += res.count;
  }
  return { updated };
}
