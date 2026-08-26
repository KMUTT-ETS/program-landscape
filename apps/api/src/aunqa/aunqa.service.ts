import { Injectable, NotFoundException } from '@nestjs/common';
import {
  aunqaCompletenessForPrograms,
  aunqaReadinessForProgram,
  prisma,
  type CriterionCompleteness,
  type CriterionReadiness,
  type ReadinessBand,
} from '@kku/db';
import {
  AUNQA_CRITERIA,
  AUNQA_UNEVIDENCED_CRITERIA,
  type AunqaUnevidencedCriterion,
} from '@kku/shared';

export interface AunqaProgramSummary {
  id: string;
  code: string;
  nameEn: string | null;
  nameTh: string;
  level: string;
  facultyId: string;
  facultyNameTh: string;
  facultyNameEn: string | null;
}

export interface AunqaProgramAnalysis {
  program: AunqaProgramSummary;
  criteria: CriterionReadiness[];
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: ReadinessBand;
  /** Criteria 6 and 7 travel with the payload so the page can name them
   *  once. They are not "missing data" for this programme — the platform
   *  holds nothing that could evidence them for any programme, and a
   *  reader who saw six criteria and no note would infer six is the whole
   *  framework. */
  unevidencedCriteria: readonly AunqaUnevidencedCriterion[];
}

export interface AunqaOverviewRow {
  program: AunqaProgramSummary;
  criteria: CriterionCompleteness[];
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: ReadinessBand;
}

export interface AunqaFacultyOverview {
  /** Column headers for the table, from the registry — the page never
   *  writes a criterion number or title of its own. */
  criteria: Array<{ id: string; title: string; subCriteriaTotal: number }>;
  programs: AunqaOverviewRow[];
  unevidencedCriteria: readonly AunqaUnevidencedCriterion[];
}

const PROGRAM_SELECT = {
  id: true,
  code: true,
  nameEn: true,
  nameTh: true,
  level: true,
  facultyId: true,
  faculty: { select: { nameTh: true, nameEn: true } },
} as const;

interface ProgramRow {
  id: string;
  code: string;
  nameEn: string | null;
  nameTh: string;
  level: string;
  facultyId: string;
  faculty: { nameTh: string; nameEn: string | null };
}

function toSummary(row: ProgramRow): AunqaProgramSummary {
  return {
    id: row.id,
    code: row.code,
    nameEn: row.nameEn,
    nameTh: row.nameTh,
    level: row.level,
    facultyId: row.facultyId,
    facultyNameTh: row.faculty.nameTh,
    facultyNameEn: row.faculty.nameEn,
  };
}

@Injectable()
export class AunqaService {
  /** One programme, every binding resolved. The caller has already run
   *  `assertProgramAccessible`. */
  async programAnalysis(programId: string): Promise<AunqaProgramAnalysis> {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: PROGRAM_SELECT,
    });
    if (!program) throw new NotFoundException();

    const readiness = await aunqaReadinessForProgram(programId);
    return {
      program: toSummary(program),
      criteria: readiness.criteria,
      subCriteriaTotal: readiness.subCriteriaTotal,
      subCriteriaWithEvidence: readiness.subCriteriaWithEvidence,
      band: readiness.band,
      unevidencedCriteria: AUNQA_UNEVIDENCED_CRITERIA,
    };
  }

  /**
   * Completeness for every programme in the caller's scope.
   *
   * `facultyName` arrives already clamped by the controller. An empty
   * array means no filter — the university-wide caller — and the sentinel
   * `['__none__']` matches no faculty, which is how a caller with no
   * grants gets an empty table instead of the whole university.
   */
  async facultyOverview(filter: { facultyName: string[] }): Promise<AunqaFacultyOverview> {
    const programs = await prisma.program.findMany({
      where:
        filter.facultyName.length > 0
          ? { faculty: { nameTh: { in: filter.facultyName } } }
          : {},
      select: PROGRAM_SELECT,
      orderBy: [{ faculty: { nameTh: 'asc' } }, { code: 'asc' }],
    });

    const completeness = await aunqaCompletenessForPrograms(programs.map((p) => p.id));
    const byId = new Map(completeness.map((c) => [c.programId, c]));

    return {
      criteria: AUNQA_CRITERIA.map((c) => ({
        id: c.id,
        title: c.title,
        subCriteriaTotal: c.subCriteria.length,
      })),
      programs: programs.map((p) => {
        const row = byId.get(p.id);
        return {
          program: toSummary(p),
          criteria: row?.criteria ?? [],
          subCriteriaTotal: row?.subCriteriaTotal ?? 0,
          subCriteriaWithEvidence: row?.subCriteriaWithEvidence ?? 0,
          band: row?.band ?? 'no-evidence',
        };
      }),
      unevidencedCriteria: AUNQA_UNEVIDENCED_CRITERIA,
    };
  }
}
