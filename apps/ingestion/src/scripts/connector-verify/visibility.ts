import { IS_CANONICAL_PROGRAM, realDataWhere } from '@kku/db';
import type { PrismaClient } from '@kku/db';

/** stamped = carries the run id; visible = also passes realDataWhere(); linked = reaches a programme or faculty. */
export type RowFilter = 'stamped' | 'visible' | 'linked';

export interface DatasetVisibility {
  /** Rows written by `runId` that match `filter`. */
  count(prisma: PrismaClient, runId: string, filter: Exclude<RowFilter, 'linked'>): Promise<number>;
  /** Rows written by `runId` that link to a canonical programme or a faculty; omitted when the dataset has no such key. */
  countLinked?(prisma: PrismaClient, runId: string): Promise<number>;
}

function base(runId: string, filter: Exclude<RowFilter, 'linked'>) {
  return filter === 'visible' ? { ingestionRunId: runId, ...realDataWhere() } : { ingestionRunId: runId };
}

/**
 * Where each dataset's rows live — the model is the one the dataset's own
 * `count()` uses in packages/db/src/import/datasets/. A dataset missing here
 * reports SKIP ("no visibility check for this dataset yet").
 *
 * `countLinked` exists only where a mapping mistake can load rows that join
 * to nothing the app shows: rows on a non-canonical programme (hidden by
 * IS_CANONICAL_PROGRAM), or a nullable faculty/programme link left empty.
 */
export const DATASET_VISIBILITY: Readonly<Record<string, DatasetVisibility>> = {
  programmes: {
    count: (p, runId, f) => p.program.count({ where: base(runId, f) }),
    countLinked: (p, runId) => p.program.count({ where: { ingestionRunId: runId, ...IS_CANONICAL_PROGRAM } }),
  },
  faculties: {
    count: (p, runId, f) => p.faculty.count({ where: base(runId, f) }),
  },
  departments: {
    count: (p, runId, f) => p.department.count({ where: base(runId, f) }),
  },
  'faculty-members': {
    count: (p, runId, f) => p.facultyMember.count({ where: base(runId, f) }),
  },
  'enrollment-metrics': {
    count: (p, runId, f) => p.enrollmentMetric.count({ where: base(runId, f) }),
    countLinked: (p, runId) =>
      p.enrollmentMetric.count({ where: { ingestionRunId: runId, program: IS_CANONICAL_PROGRAM } }),
  },
  'financial-metrics': {
    count: (p, runId, f) => p.financialMetric.count({ where: base(runId, f) }),
    countLinked: (p, runId) =>
      p.financialMetric.count({ where: { ingestionRunId: runId, program: IS_CANONICAL_PROGRAM } }),
  },
  'graduate-outcomes': {
    count: (p, runId, f) => p.graduateOutcome.count({ where: base(runId, f) }),
    countLinked: (p, runId) =>
      p.graduateOutcome.count({ where: { ingestionRunId: runId, program: IS_CANONICAL_PROGRAM } }),
  },
  'class-offerings': {
    count: (p, runId, f) => p.classOffering.count({ where: base(runId, f) }),
    countLinked: (p, runId) =>
      p.classOffering.count({ where: { ingestionRunId: runId, facultyId: { not: null } } }),
  },
  'admission-campaigns': {
    count: (p, runId, f) => p.admissionCampaignStat.count({ where: base(runId, f) }),
    countLinked: (p, runId) =>
      p.admissionCampaignStat.count({
        where: {
          ingestionRunId: runId,
          OR: [{ program: IS_CANONICAL_PROGRAM }, { facultyId: { not: null } }],
        },
      }),
  },
};
