import type { PrismaClient } from '@prisma/client';

import { ApiError, DQ_MODULES, theoryModules } from '@kku/shared';

import type {
  ImportColumn,
  ImportDataset,
  ImportLoadContext,
  ImportLoadResult,
  ImportRow,
} from '../types';
import { buddhistYearColumn, toBuddhistEra } from './cohorts';

// Tier 2. Digital competency: the two aggregate tables behind the Student DQ
// dashboard and the Deep-Dive's Digital competency section.
//
// Both are PROGRAMME-SCOPED. Neither table has a unique key, so there is
// nothing to merge on: a programme named in the file has its imported rows
// replaced wholesale. The replace deletes only rows written by THIS dataset's
// own earlier uploads — rows written by the `kku-dq` connector, or by the
// other digital-competency sheet, are never touched.
//
// The framework is the 13-module DQ framework in `@kku/shared` (`DQ_MODULES`).
// An institution that runs a different test must map it onto those axes, or
// the radar is sparse.

export const DIGITAL_COMPETENCY_IMPORT_VERSION = 'xlsx-import.v1';

const COHORTS_SLUG = 'xlsx-digital-competency-cohorts';
const MODULES_SLUG = 'xlsx-digital-competency-modules';

const PROGRAMME_COLUMN: ImportColumn = {
  header: 'Programme Code',
  key: 'programmeCode',
  type: 'text',
  required: true,
  guide:
    'The bachelor programme these students belong to, exactly as its Programme Code in the ' +
    'Programmes sheet. Digital competency is an undergraduate measure: rows for another level are ' +
    'stored but no score reads them.',
  example: 'ENG-ME-BSC',
  references: { dataset: 'programmes', column: 'code' },
};

const THEORY_MODULE_NAMES = theoryModules()
  .map((m) => `${m.no} ${m.nameEn}`)
  .join(', ');

/** Programme id, faculty id and the Thai names both tables denormalise. */
async function resolveProgrammes(
  ctx: ImportLoadContext,
  rows: readonly ImportRow[],
): Promise<
  Map<string, { id: string; nameTh: string; facultyId: string; facultyName: string }>
> {
  const codes = [...new Set(rows.map((r) => String(r.programmeCode)))];
  const found = await ctx.tx.program.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, nameTh: true, facultyId: true, faculty: { select: { nameTh: true } } },
  });
  const byCode = new Map(
    found.map((p) => [
      p.code,
      { id: p.id, nameTh: p.nameTh, facultyId: p.facultyId, facultyName: p.faculty.nameTh },
    ]),
  );
  for (const code of codes) {
    if (!byCode.has(code)) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `Programme code "${code}" does not exist. Upload the Programmes sheet first.`,
      );
    }
  }
  return byCode;
}

/** Runs written by one dataset's own uploads, current run included. */
async function ownRunIds(tx: ImportLoadContext['tx'], slug: string): Promise<string[]> {
  const runs = await tx.ingestionRun.findMany({
    where: { dataSource: { slug } },
    select: { id: true },
  });
  return runs.map((r) => r.id);
}

export const digitalCompetencyCohortsDataset: ImportDataset = {
  slug: 'digital-competency-cohorts',
  title: 'Digital Competency — Cohorts',
  description:
    'How many students of each entry cohort sat a digital competency test, how many have a score, ' +
    'and how many passed every module. One row per programme per entry year. A programme named in ' +
    'the file has its previously imported cohort rows replaced. Feeds the Digital competency section ' +
    'of the Deep-Dive and the Student DQ dashboard.',
  tier: 2,
  sheetName: 'Digital Competency Cohorts',
  columns: [
    PROGRAMME_COLUMN,
    buddhistYearColumn('Entry Year', 'entryYear', 'The year this cohort started.'),
    {
      header: 'Students Tested',
      key: 'studentsTested',
      type: 'integer',
      required: true,
      guide:
        'Students of this cohort who sat the test at all. A row covering fewer than five students ' +
        'is refused, so no individual’s result can be inferred.',
      example: '120',
      groupSizeFor: { minimum: 5 },
    },
    {
      header: 'Students With Scores',
      key: 'studentsWithScores',
      type: 'integer',
      required: true,
      guide:
        'Of those, how many have at least one module score. Cannot exceed Students Tested. A ' +
        'programme with fewer than six scored students across all its rows shows no score — the ' +
        'count is shown instead.',
      example: '110',
    },
    {
      header: 'Students Passing All Modules',
      key: 'studentsAllPassed',
      type: 'integer',
      required: true,
      guide:
        'Of those with scores, how many passed every module they took. Cannot exceed Students With ' +
        'Scores. Divided by it, this is the programme’s pass rate.',
      example: '80',
    },
  ],
  strategy: {
    kind: 'programme-scoped',
    scopeColumns: ['programmeCode'],
    match: { kind: 'unique', columns: ['programmeCode', 'entryYear'] },
  },
  rowRules: [
    {
      message: 'Students With Scores cannot exceed Students Tested — check the two columns against each other.',
      check: (r) =>
        typeof r.studentsWithScores !== 'number' || typeof r.studentsTested !== 'number'
          ? true
          : r.studentsWithScores <= r.studentsTested,
    },
    {
      message:
        'Students Passing All Modules cannot exceed Students With Scores — check the two columns against each other.',
      check: (r) =>
        typeof r.studentsAllPassed !== 'number' || typeof r.studentsWithScores !== 'number'
          ? true
          : r.studentsAllPassed <= r.studentsWithScores,
    },
  ],

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const byCode = await resolveProgrammes(ctx, rows);
    const runIds = await ownRunIds(ctx.tx, COHORTS_SLUG);

    const deleted = await ctx.tx.dqStudentCube.deleteMany({
      where: {
        programId: { in: [...byCode.values()].map((p) => p.id) },
        ingestionRunId: { in: runIds },
      },
    });

    const created = await ctx.tx.dqStudentCube.createMany({
      data: rows.map((row) => {
        const p = byCode.get(String(row.programmeCode))!;
        return {
          facultyName: p.facultyName,
          facultyId: p.facultyId,
          programId: p.id,
          programName: p.nameTh,
          cohortYearBe: toBuddhistEra(Number(row.entryYear)),
          studentsTested: Number(row.studentsTested),
          studentsWithScores: Number(row.studentsWithScores),
          studentsAllPassed: Number(row.studentsAllPassed),
          ingestionRunId: ctx.ingestionRunId,
        };
      }),
    });

    return { inserted: created.count, updated: 0, deleted: deleted.count };
  },

  // Rows this dataset itself wrote: the table also holds the connector's.
  count: (prisma: PrismaClient): Promise<number> =>
    prisma.dqStudentCube.count({
      where: { ingestionRun: { dataSource: { slug: COHORTS_SLUG } } },
    }),

  countForScope: async (prisma, scopes): Promise<number> => {
    const codes = scopes.map((s) => String(s.programmeCode));
    if (codes.length === 0) return 0;
    const programmes = await prisma.program.findMany({
      where: { code: { in: codes } },
      select: { id: true },
    });
    return prisma.dqStudentCube.count({
      where: {
        programId: { in: programmes.map((p) => p.id) },
        ingestionRun: { dataSource: { slug: COHORTS_SLUG } },
      },
    });
  },

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.dqStudentCube.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};

export const digitalCompetencyModulesDataset: ImportDataset = {
  slug: 'digital-competency-modules',
  title: 'Digital Competency — Modules',
  description:
    'Mean score on each of the 13 digital competency modules, per programme per entry year. A ' +
    'programme named in the file has its previously imported module rows replaced. Feeds the radar ' +
    'and the overall digital competency mean (modules 1–12) in the Deep-Dive. Load alongside the ' +
    'Digital Competency — Cohorts sheet: the score is withheld until that sheet gives six scored students.',
  tier: 2,
  sheetName: 'Digital Competency Modules',
  columns: [
    PROGRAMME_COLUMN,
    buddhistYearColumn('Entry Year', 'entryYear', 'The year this cohort started.'),
    {
      header: 'Module',
      key: 'moduleNo',
      type: 'integer',
      required: true,
      guide:
        `The module number, 1 to 13: ${THEORY_MODULE_NAMES}. Module 13 (practical) is stored and ` +
        'drawn on the radar but is left out of the overall mean. These 13 are the framework’s own ' +
        'axes: a different test must be mapped onto them, or the radar is sparse.',
      example: '6',
      check: (value) =>
        typeof value === 'number' && (!Number.isInteger(value) || value < 1 || value > 13)
          ? `${value} is not a module. Use a whole number from 1 to 13.`
          : null,
    },
    {
      header: 'Students Taking',
      key: 'takenCount',
      type: 'integer',
      required: true,
      guide:
        'Students who took this module. A row covering fewer than five students is refused. It is ' +
        'the weight of this row in the overall mean.',
      example: '100',
      groupSizeFor: { minimum: 5 },
    },
    {
      header: 'Mean Score (0–100)',
      key: 'meanScore',
      type: 'decimal',
      required: true,
      guide:
        'The mean score of those students on a 0–100 scale (72.5, not 0.725). A value outside 0–100 ' +
        'is refused.',
      example: '72.5',
      check: (value) =>
        typeof value === 'number' && (value < 0 || value > 100)
          ? `${value} is not on the scale. This column takes a mean between 0 and 100.`
          : null,
    },
    {
      header: 'Students In Scope',
      key: 'studentsInScope',
      type: 'integer',
      required: true,
      guide:
        'Students of this cohort with any score at all — the coverage denominator. Cannot be fewer ' +
        'than Students Taking.',
      example: '110',
    },
  ],
  strategy: {
    kind: 'programme-scoped',
    scopeColumns: ['programmeCode'],
    match: { kind: 'unique', columns: ['programmeCode', 'entryYear', 'moduleNo'] },
  },
  rowRules: [
    {
      message: 'Students In Scope cannot be fewer than Students Taking — check the two columns against each other.',
      check: (r) =>
        typeof r.studentsInScope !== 'number' || typeof r.takenCount !== 'number'
          ? true
          : r.studentsInScope >= r.takenCount,
    },
  ],

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const byCode = await resolveProgrammes(ctx, rows);
    const runIds = await ownRunIds(ctx.tx, MODULES_SLUG);

    const deleted = await ctx.tx.dqModuleCube.deleteMany({
      where: {
        programId: { in: [...byCode.values()].map((p) => p.id) },
        ingestionRunId: { in: runIds },
      },
    });

    const data = rows.map((row) => {
      const p = byCode.get(String(row.programmeCode))!;
      const moduleNo = Number(row.moduleNo);
      // The theory module of that number; 1–13 all exist as THEORY.
      const module = DQ_MODULES.find((m) => m.kind === 'THEORY' && m.no === moduleNo);
      if (!module) {
        throw new ApiError('VALIDATION_FAILED', `Module ${moduleNo} is not a digital competency module.`);
      }
      const takenCount = Number(row.takenCount);
      return {
        facultyName: p.facultyName,
        facultyId: p.facultyId,
        programId: p.id,
        programName: p.nameTh,
        cohortYearBe: toBuddhistEra(Number(row.entryYear)),
        moduleKey: module.key,
        moduleNo: module.no,
        moduleKind: module.kind,
        takenCount,
        // The cube stores a sum so rollups weight by taker count.
        scoreSum: Number(row.meanScore) * takenCount,
        studentsInScope: Number(row.studentsInScope),
        ingestionRunId: ctx.ingestionRunId,
      };
    });
    const created = await ctx.tx.dqModuleCube.createMany({ data });

    return { inserted: created.count, updated: 0, deleted: deleted.count };
  },

  count: (prisma: PrismaClient): Promise<number> =>
    prisma.dqModuleCube.count({
      where: { ingestionRun: { dataSource: { slug: MODULES_SLUG } } },
    }),

  countForScope: async (prisma, scopes): Promise<number> => {
    const codes = scopes.map((s) => String(s.programmeCode));
    if (codes.length === 0) return 0;
    const programmes = await prisma.program.findMany({
      where: { code: { in: codes } },
      select: { id: true },
    });
    return prisma.dqModuleCube.count({
      where: {
        programId: { in: programmes.map((p) => p.id) },
        ingestionRun: { dataSource: { slug: MODULES_SLUG } },
      },
    });
  },

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.dqModuleCube.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
