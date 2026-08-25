// Pure record → cube-key mapping for the kku-dq connector.
//
// PDPA posture is enforced here by construction: the accumulator's row
// types have no name fields, so a name cannot reach the database even if
// a future edit forgets to strip it. A test asserts that.

import { z } from 'zod';
import { DQ_MODULES, dqScoreWasTaken } from '@kku/shared';

export const DqExportItemSchema = z.object({
  studentId: z.string().min(1),
  // Present in the payload; parsed so an upstream shape change is
  // visible, but deliberately never carried into a cube row.
  firstname: z.string().optional(),
  lastname: z.string().optional(),
  faculty: z.string().nullable().optional(),
  hasResult: z.boolean().default(false),
  allPassed: z.boolean().default(false),
  modules: z.record(z.string(), z.number()).optional().default({}),
});
export type DqExportItem = z.infer<typeof DqExportItemSchema>;

export const DqExportResponseSchema = z.object({
  items: z.array(z.unknown()),
  totalItems: z.number().optional(),
});

export interface CubeDims {
  facultyName: string;
  facultyId: string | null;
  programId: string | null;
  programName: string | null;
  cohortYearBE: number | null;
}

export interface StudentCubeRow extends CubeDims {
  studentsTested: number;
  studentsWithScores: number;
  studentsAllPassed: number;
}

export interface ModuleCubeRow extends CubeDims {
  moduleKey: string;
  moduleNo: number;
  moduleKind: string;
  takenCount: number;
  scoreSum: number;
  studentsInScope: number;
}

export interface DqAccumulator {
  students: Map<string, StudentCubeRow>;
  modules: Map<string, ModuleCubeRow>;
}

export function emptyAccumulator(): DqAccumulator {
  return { students: new Map(), modules: new Map() };
}

function dimKey(d: CubeDims): string {
  return [d.facultyName, d.programId ?? '', d.cohortYearBE ?? ''].join('|');
}

/**
 * Fold one export item into the accumulator.
 *
 * Counting rules, all measured from the source (see the design doc):
 *  - every item counts as TESTED, whatever its flags;
 *  - an item counts as SCORED only when it actually carries module
 *    scores — 2,772 items claim `hasResult` with an empty payload;
 *  - a module score of 0 means NOT TAKEN: the module still gets a row
 *    (so coverage is reportable) but contributes nothing to takenCount
 *    or scoreSum.
 */
export function accumulate(acc: DqAccumulator, item: DqExportItem, dims: CubeDims): void {
  const k = dimKey(dims);
  const scores = item.modules ?? {};
  const hasScores = Object.keys(scores).length > 0;

  const s = acc.students.get(k) ?? {
    ...dims,
    studentsTested: 0,
    studentsWithScores: 0,
    studentsAllPassed: 0,
  };
  s.studentsTested += 1;
  if (hasScores) s.studentsWithScores += 1;
  if (item.allPassed) s.studentsAllPassed += 1;
  acc.students.set(k, s);

  if (!hasScores) return;

  for (const mod of DQ_MODULES) {
    const raw = scores[mod.key];
    if (raw === undefined) continue;
    const mk = `${k}|${mod.key}`;
    const m = acc.modules.get(mk) ?? {
      ...dims,
      moduleKey: mod.key,
      moduleNo: mod.no,
      moduleKind: mod.kind,
      takenCount: 0,
      scoreSum: 0,
      studentsInScope: 0,
    };
    m.studentsInScope += 1;
    if (dqScoreWasTaken(raw)) {
      m.takenCount += 1;
      m.scoreSum += raw;
    }
    acc.modules.set(mk, m);
  }
}
