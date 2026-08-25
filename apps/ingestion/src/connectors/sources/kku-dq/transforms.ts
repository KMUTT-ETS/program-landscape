// Pure record → cube-key mapping for the kku-dq connector.
//
// PDPA posture: `accumulate` copies dimensions from its `dims` argument
// and nothing else — no field of `DqExportItem` other than the module
// scores is ever read into a row, so the names the export carries cannot
// reach the database by way of this file. The guarantee stops at the
// parameter: `CubeDims` is a plain interface, so a caller that builds it
// by spreading a student-shaped object would carry the extra fields
// through `{ ...dims }` with no type error. Callers must therefore build
// `dims` as an explicit object literal (the connector does). A test
// asserts the no-name property for the shape this file controls.

import { z } from 'zod';
import { DQ_MODULES, dqModuleByKey, dqScoreWasTaken } from '@kku/shared';

/**
 * `hasResult` / `allPassed` arrive as `null` — not absent — for students
 * with no result yet: 2,404 of 24,777 on the live export. Zod's
 * `.default()` fires on `undefined` only, so `z.boolean().default(false)`
 * rejected exactly those records and silently dropped them from the
 * TESTED count. A null verdict is "no verdict", which is not a pass, so
 * both null and absent coerce to false here — in the schema, where the
 * next caller of it gets the same treatment for free.
 */
const dqFlag = z
  .boolean()
  .nullish()
  .transform((v) => v ?? false);

/** A module score outside this range is corrupt, not a low mark. */
const SCORE_MIN = 0;
const SCORE_MAX = 100;

export const DqExportItemSchema = z.object({
  studentId: z.string().min(1),
  // Present in the payload; parsed so an upstream shape change is
  // visible, but deliberately never carried into a cube row.
  firstname: z.string().optional(),
  lastname: z.string().optional(),
  faculty: z.string().nullable().optional(),
  hasResult: dqFlag,
  allPassed: dqFlag,
  // Deliberately NOT range-constrained: a corrupt value must cost that
  // one score, not the whole student. `accumulate` skips and counts it.
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
  cohortYearBe: number | null;
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
  /**
   * Score keys the framework does not know, counted per key. Module 13
   * (Generative AI) arrived unannounced once already and distorted every
   * mean until it was found; a module 14 must be loud, not invisible.
   * The connector surfaces these in `IngestionRun.metadata`.
   */
  unknownModuleKeys: Map<string, number>;
  /** Known modules whose score fell outside 0-100, counted per key. */
  outOfRangeScores: Map<string, number>;
}

/** Distinct-key ceiling on the two diagnostic maps. A garbled payload
 *  must not turn the accumulator into an unbounded string store; past
 *  this point the counts stop growing and the run still reports. */
const MAX_TRACKED_KEYS = 200;

function bump(counter: Map<string, number>, key: string): void {
  const seen = counter.get(key);
  if (seen === undefined && counter.size >= MAX_TRACKED_KEYS) return;
  counter.set(key, (seen ?? 0) + 1);
}

export function emptyAccumulator(): DqAccumulator {
  return {
    students: new Map(),
    modules: new Map(),
    unknownModuleKeys: new Map(),
    outOfRangeScores: new Map(),
  };
}

function dimKey(d: CubeDims): string {
  return [d.facultyName, d.programId ?? '', d.cohortYearBe ?? ''].join('|');
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
 *    or scoreSum;
 *  - a score outside 0-100 is corrupt: it is skipped entirely (no row,
 *    no denominator) and counted, so it cannot poison a mean unseen;
 *  - a score key the framework does not know is counted, so a new module
 *    announces itself instead of silently vanishing from every cube.
 */
export function accumulate(acc: DqAccumulator, item: DqExportItem, dims: CubeDims): void {
  const k = dimKey(dims);
  const scores = item.modules ?? {};
  const hasScores = Object.keys(scores).length > 0;

  for (const key of Object.keys(scores)) {
    if (!dqModuleByKey(key)) bump(acc.unknownModuleKeys, key);
  }

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
    if (!Number.isFinite(raw) || raw < SCORE_MIN || raw > SCORE_MAX) {
      bump(acc.outOfRangeScores, mod.key);
      continue;
    }
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
