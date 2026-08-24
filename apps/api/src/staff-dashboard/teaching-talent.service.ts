import { Injectable } from '@nestjs/common';
import {
  TEACHING_TALENT_METHODOLOGY_VERSION,
  teachingTalentRoster,
  type TeachingTalentFilter,
  type TeachingTalentOptions,
  type TeachingTalentResult,
} from '@kku/db';

// Thin DI wrapper over the @kku/db teaching-talent helper. The workbook
// builder lands here in the export task.
@Injectable()
export class TeachingTalentService {
  readonly methodologyVersion = TEACHING_TALENT_METHODOLOGY_VERSION;

  roster(
    filter: TeachingTalentFilter | undefined,
    opts: TeachingTalentOptions = {},
  ): Promise<TeachingTalentResult> {
    return teachingTalentRoster(filter, opts);
  }
}
