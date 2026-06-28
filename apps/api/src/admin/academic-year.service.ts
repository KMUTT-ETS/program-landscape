import { Injectable } from '@nestjs/common';
import {
  prisma,
  ACADEMIC_YEAR_SETTING_KEY,
  getAcademicYearContext,
  invalidateAcademicYearCache,
} from '@kku/db';

export interface AcademicYearView {
  nextStartDate: string; // YYYY-MM-DD
  currentAcademicYearBE: number;
  latestCompleteEntryYearBE: number;
  inProgressEntryYearBE: number;
  isStale: boolean;
  suggestedNextDate: string; // YYYY-MM-DD — June 16 of (current CE year + 1)
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class AcademicYearService {
  async get(): Promise<AcademicYearView> {
    const ctx = await getAcademicYearContext();
    const suggestedCE = ctx.currentAcademicYearBE - 543 + 1;
    return {
      nextStartDate: toYmd(ctx.nextStartDate),
      currentAcademicYearBE: ctx.currentAcademicYearBE,
      latestCompleteEntryYearBE: ctx.latestCompleteEntryYearBE,
      inProgressEntryYearBE: ctx.inProgressEntryYearBE,
      isStale: ctx.isStale,
      suggestedNextDate: `${suggestedCE}-06-16`,
    };
  }

  async set(nextStartDate: string, userId: string): Promise<AcademicYearView> {
    await prisma.systemSetting.upsert({
      where: { key: ACADEMIC_YEAR_SETTING_KEY },
      update: { value: nextStartDate, updatedBy: userId },
      create: { key: ACADEMIC_YEAR_SETTING_KEY, value: nextStartDate, updatedBy: userId },
    });
    invalidateAcademicYearCache();
    return this.get();
  }
}
