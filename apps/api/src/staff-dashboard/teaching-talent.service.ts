import { Injectable } from '@nestjs/common';
import {
  TALENT_THRESHOLD_OPTIONS,
  TEACHING_TALENT_METHODOLOGY_VERSION,
  classifyTalent,
  teachingTalentRoster,
  type TeachingTalentFilter,
  type TeachingTalentOptions,
  type TeachingTalentResult,
} from '@kku/db';
import { buildTalentWorkbook, talentWorkbookFilename } from './teaching-talent-workbook';

/** Re-exported for the controller's Zod schema. A threshold outside this
 *  list (a crafted `0`) would export the whole roster as "talent". */
export const ALLOWED_TALENT_THRESHOLDS: readonly number[] = TALENT_THRESHOLD_OPTIONS;

// Thin DI wrapper over the @kku/db teaching-talent helper, plus the XLSX
// export path.
@Injectable()
export class TeachingTalentService {
  readonly methodologyVersion = TEACHING_TALENT_METHODOLOGY_VERSION;

  roster(
    filter: TeachingTalentFilter | undefined,
    opts: TeachingTalentOptions = {},
  ): Promise<TeachingTalentResult> {
    return teachingTalentRoster(filter, opts);
  }

  async export(args: {
    facultyName: string[];
    threshold: number;
  }): Promise<{ filename: string; base64: string; rowCount: number; byteSize: number }> {
    const result = await teachingTalentRoster(
      { facultyName: args.facultyName },
      { includeContact: true, includeUnmatched: true },
    );
    const buffer = buildTalentWorkbook(result, {
      threshold: args.threshold,
      facultyName: args.facultyName,
    });
    // rowCount counts talents, not spreadsheet rows — it is what the audit
    // log and the About sheet both report.
    const rowCount = result.rows.filter(
      (r) =>
        classifyTalent(
          Object.fromEntries(Object.entries(r.byYear).map(([y, c]) => [y, c.ratingAvg])),
          result.years,
          args.threshold,
        ).isTalent,
    ).length;
    return {
      filename: talentWorkbookFilename(result.years, args.threshold),
      base64: buffer.toString('base64'),
      rowCount,
      byteSize: buffer.byteLength,
    };
  }
}
