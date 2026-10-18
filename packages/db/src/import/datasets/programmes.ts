import type { Prisma, PrismaClient, ProgramLevel, ProgramStatus } from '@prisma/client';

import { ApiError } from '@kku/shared';

import type { ImportDataset, ImportLoadContext, ImportLoadResult, ImportRow } from '../types';

// Tier 0, and the one that decides whether anything is visible.
//
// IS_CANONICAL_PROGRAM (packages/db/src/canonical-programs.ts) keys on
// sequenceNoFromSheet IS NOT NULL, and Council surfaces enumerate through
// withCanonical(). A programme imported without one loads successfully, says
// so, and is then invisible on every one of those surfaces. The admin
// creator already solves this (apps/api/src/programs/programs.service.ts);
// this loader does the same thing.

const LEVELS = ['BACHELOR', 'MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA'] as const;
const STATUSES = ['ACTIVE', 'PAUSED', 'SUNSET'] as const;

// ── What a start-over on this dataset would destroy ──────────────────────
//
// THIRTY-FIVE tables hold `onDelete: Cascade` foreign keys into `programs`.
// Deleting an imported programme empties every one of them for that row —
// including the PDF a human attached, the courses an AI run extracted at
// real cost, and the risk assessment Council read last week. None of that
// came from the import and none of it is restored by re-uploading the file.
//
// So the guard counts them all and refuses rather than cascading. The list
// is kept honest by test/import-cascade-coverage.test.ts, which reads the
// schema: a new Cascade child fails the suite until it is classified here.
// The first version of this list named eight of the thirty-five.

interface CascadeChild {
  /** Prisma model name. Matched against schema.prisma by the structural test. */
  model: string;
  /** How an operator would recognise it. Several models may share a label. */
  label: string;
  count: (tx: Prisma.TransactionClient, runIds: readonly string[]) => Promise<number>;
}

/** Cascade children whose rows block a start-over while any exist. */
export const CASCADE_CHILDREN: readonly CascadeChild[] = [
  // Metrics — the tier-1 import datasets, plus what connectors write beside them.
  { model: 'EnrollmentMetric', label: 'enrolment figures', count: (p, r) => p.enrollmentMetric.count({ where: byProgram(r) }) },
  { model: 'FinancialMetric', label: 'financial figures', count: (p, r) => p.financialMetric.count({ where: byProgram(r) }) },
  { model: 'GraduateOutcome', label: 'graduate outcomes', count: (p, r) => p.graduateOutcome.count({ where: byProgram(r) }) },
  { model: 'StudentCohortDistribution', label: 'student cohorts', count: (p, r) => p.studentCohortDistribution.count({ where: byProgram(r) }) },
  { model: 'AlumniCohortStatus', label: 'alumni cohorts', count: (p, r) => p.alumniCohortStatus.count({ where: byProgram(r) }) },
  { model: 'StudentDemographic', label: 'student demographics', count: (p, r) => p.studentDemographic.count({ where: byProgram(r) }) },
  { model: 'EmployerFeedback', label: 'employer feedback responses', count: (p, r) => p.employerFeedback.count({ where: byProgram(r) }) },

  // Curriculum — attached by hand or extracted by paid AI runs.
  { model: 'ProgramDocument', label: 'attached documents', count: (p, r) => p.programDocument.count({ where: byProgram(r) }) },
  { model: 'Curriculum', label: 'curricula', count: (p, r) => p.curriculum.count({ where: byProgram(r) }) },
  { model: 'Course', label: 'courses', count: (p, r) => p.course.count({ where: byProgram(r) }) },
  { model: 'ProgramCourse', label: 'courses', count: (p, r) => p.programCourse.count({ where: byProgram(r) }) },
  { model: 'ProgramLearningOutcome', label: 'learning outcomes', count: (p, r) => p.programLearningOutcome.count({ where: byProgram(r) }) },
  { model: 'ProgramSkill', label: 'skill links', count: (p, r) => p.programSkill.count({ where: byProgram(r) }) },
  { model: 'ProgramRevision', label: 'curriculum revisions', count: (p, r) => p.programRevision.count({ where: byProgram(r) }) },
  { model: 'ProgramCurriculumRevision', label: 'curriculum revisions', count: (p, r) => p.programCurriculumRevision.count({ where: byProgram(r) }) },

  // People.
  { model: 'ProgramFaculty', label: 'teaching-staff assignments', count: (p, r) => p.programFaculty.count({ where: byProgram(r) }) },

  // AI-derived analysis. Recomputable, but only by paying for it again.
  { model: 'ProgramStrategicNarrative', label: 'AI analysis', count: (p, r) => p.programStrategicNarrative.count({ where: byProgram(r) }) },
  { model: 'ProgramAiReadinessAssessment', label: 'AI analysis', count: (p, r) => p.programAiReadinessAssessment.count({ where: byProgram(r) }) },
  { model: 'ProgramResearchExpertise', label: 'AI analysis', count: (p, r) => p.programResearchExpertise.count({ where: byProgram(r) }) },
  { model: 'ProgramPedagogyAssessment', label: 'AI analysis', count: (p, r) => p.programPedagogyAssessment.count({ where: byProgram(r) }) },
  { model: 'AunqaCriterionNarrative', label: 'AI analysis', count: (p, r) => p.aunqaCriterionNarrative.count({ where: byProgram(r) }) },
  { model: 'ProgramDemandMatch', label: 'demand matches', count: (p, r) => p.programDemandMatch.count({ where: byProgram(r) }) },
  { model: 'ProgramMarketProfile', label: 'market profiles', count: (p, r) => p.programMarketProfile.count({ where: byProgram(r) }) },
  { model: 'ProgramJobThaiLink', label: 'labour-market links', count: (p, r) => p.programJobThaiLink.count({ where: byProgram(r) }) },
  { model: 'ProgramJobField', label: 'labour-market links', count: (p, r) => p.programJobField.count({ where: byProgram(r) }) },
  { model: 'ProgramOverlapPair', label: 'overlap findings', count: (p, r) => p.programOverlapPair.count({ where: { OR: [{ programA: byRun(r) }, { programB: byRun(r) }] } }) },

  // Governance history. Council has seen these.
  { model: 'RiskAssessment', label: 'risk assessments', count: (p, r) => p.riskAssessment.count({ where: byProgram(r) }) },
  { model: 'RiskIndicatorBreach', label: 'risk assessments', count: (p, r) => p.riskIndicatorBreach.count({ where: byProgram(r) }) },
  { model: 'VerdictSnapshot', label: 'stored verdicts', count: (p, r) => p.verdictSnapshot.count({ where: byProgram(r) }) },
  { model: 'ProgramLifecycleSnapshot', label: 'stored verdicts', count: (p, r) => p.programLifecycleSnapshot.count({ where: byProgram(r) }) },

  // Benchmarking.
  { model: 'ProgramPeerReview', label: 'peer reviews', count: (p, r) => p.programPeerReview.count({ where: byProgram(r) }) },
  { model: 'ProgramPeerSelection', label: 'peer selections', count: (p, r) => p.programPeerSelection.count({ where: byProgram(r) }) },

  // Operator-curated mappings. Cheap to lose, impossible to notice.
  { model: 'RegistryProgramMapping', label: 'registry mappings', count: (p, r) => p.registryProgramMapping.count({ where: byProgram(r) }) },
  { model: 'ProgramMhesiAlias', label: 'MHESI aliases', count: (p, r) => p.programMhesiAlias.count({ where: byProgram(r) }) },
  { model: 'AdmissionStatProgramMapping', label: 'admission-statistic mappings', count: (p, r) => p.admissionStatProgramMapping.count({ where: byProgram(r) }) },
];

/**
 * Cascade children that are deliberately not counted, each with its reason.
 *
 * Empty today. An entry here is a decision that losing the table's rows is
 * acceptable, which is a thing to argue for in review, not to assume.
 */
export const CASCADE_CHILDREN_UNREACHABLE: readonly { model: string; reason: string }[] = [];

/** Rows hanging off a programme this import created. */
function byProgram(runIds: readonly string[]) {
  return { program: { ingestionRunId: { in: [...runIds] } } };
}

function byRun(runIds: readonly string[]) {
  return { ingestionRunId: { in: [...runIds] } };
}

export const programmesDataset: ImportDataset = {
  slug: 'programmes',
  title: 'Programmes',
  description:
    'The curricula this institution offers. Upload Faculties — and Departments, ' +
    'if you use them — first. Every metric you import later refers to these codes.',
  tier: 0,
  sheetName: 'Programmes',
  columns: [
    {
      header: 'Programme Code',
      key: 'code',
      type: 'text',
      required: true,
      guide:
        'Your own identifier for the programme. It must stay the same between ' +
        'uploads, because it is how a row is matched to one already here, and ' +
        'every metric sheet refers to the programme by this code.',
      example: 'ENG-CIVIL-BE',
    },
    {
      header: 'Name (Thai)',
      key: 'nameTh',
      type: 'text',
      required: true,
      guide: 'The programme name in Thai.',
      example: 'วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมโยธา',
    },
    {
      header: 'Name (English)',
      key: 'nameEn',
      type: 'text',
      required: true,
      guide: 'The programme name in English.',
      example: 'Bachelor of Engineering in Civil Engineering',
    },
    {
      header: 'Faculty Code',
      key: 'facultyCode',
      type: 'text',
      required: true,
      guide: 'The owning faculty, exactly as in the Faculties sheet.',
      example: 'ENG',
      references: { dataset: 'faculties', column: 'code' },
    },
    {
      header: 'Department Code',
      key: 'departmentCode',
      type: 'text',
      required: false,
      guide:
        'The owning department, exactly as in the Departments sheet. Leave ' +
        'blank if the programme hangs directly off the faculty.',
      example: 'ENG-CIVIL',
      references: { dataset: 'departments', column: 'code' },
    },
    {
      header: 'Level',
      key: 'level',
      type: 'enum',
      required: true,
      enumValues: LEVELS,
      guide:
        'The degree level. HIGHER_GRAD_DIPLOMA is a post-master certificate, ' +
        'such as a medical specialty board.',
      example: 'BACHELOR',
    },
    {
      header: 'Status',
      key: 'status',
      type: 'enum',
      required: false,
      enumValues: STATUSES,
      guide:
        'Whether the programme is running. Leave blank for an active one. ' +
        'PAUSED means not currently admitting; SUNSET means closing or closed.',
      example: 'ACTIVE',
    },
    {
      header: 'Year Established',
      key: 'yearEstablished',
      type: 'integer',
      required: false,
      guide: 'The Gregorian year the programme first admitted students, e.g. 2015.',
      example: '2015',
    },
    {
      header: 'Duration (years)',
      key: 'durationYears',
      type: 'integer',
      required: false,
      guide:
        'Nominal years to completion. Used to decide when a cohort should have ' +
        'graduated, so a six-year degree is not judged on a four-year clock.',
      example: '4',
    },
    {
      header: 'Total Credits',
      key: 'totalCredits',
      type: 'integer',
      required: false,
      guide: 'Credits required to graduate.',
      example: '140',
    },
    {
      header: 'Official Code',
      key: 'mhesiCode',
      type: 'text',
      required: false,
      guide:
        'The national registration code for this curriculum, if your ministry ' +
        'issues one. Not required, and not used to match rows. Note: a code ' +
        'that is exactly 13 digits may be refused as a personal identifier — ' +
        'prefix it (for example "MHESI-") if your ministry issues codes of ' +
        'that length.',
      example: '25501011100123',
    },
  ],
  strategy: { kind: 'upsert', match: { kind: 'unique', columns: ['code'] } },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const facultyCodes = [...new Set(rows.map((r) => String(r.facultyCode)))];
    const departmentCodes = [...new Set(
      rows.map((r) => (r.departmentCode ? String(r.departmentCode) : null)).filter((c): c is string => c !== null),
    )];

    const [faculties, departments] = await Promise.all([
      ctx.tx.faculty.findMany({ where: { code: { in: facultyCodes } }, select: { id: true, code: true } }),
      departmentCodes.length > 0
        ? ctx.tx.department.findMany({ where: { code: { in: departmentCodes } }, select: { id: true, code: true } })
        : Promise.resolve([]),
    ]);
    const facultyIdByCode = new Map(faculties.map((f) => [f.code, f.id]));
    const departmentIdByCode = new Map(departments.map((d) => [d.code, d.id]));

    // Allocate the sequence range once and increment in memory: one aggregate
    // per load rather than per row.
    //
    // CONCURRENCY, stated honestly: sequenceNoFromSheet is @unique and
    // nothing here retries. Two imports running at once both read this max
    // under READ COMMITTED, both try the same numbers, and the loser's
    // transaction fails on the unique — the upload is refused and must be
    // retried by hand. That is acceptable because imports are a deliberate
    // admin action, not a background job; it is NOT silent corruption. If
    // concurrent imports ever become routine, take an advisory lock here.
    const maxSeq = await ctx.tx.program.aggregate({ _max: { sequenceNoFromSheet: true } });
    let nextSeq = (maxSeq._max.sequenceNoFromSheet ?? 0) + 1;

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const facultyCode = String(row.facultyCode);
      const facultyId = facultyIdByCode.get(facultyCode);
      if (!facultyId) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Faculty code "${facultyCode}" does not exist. Upload the Faculties sheet first.`,
        );
      }

      let departmentId: string | null = null;
      if (row.departmentCode) {
        const departmentCode = String(row.departmentCode);
        departmentId = departmentIdByCode.get(departmentCode) ?? null;
        if (!departmentId) {
          throw new ApiError(
            'VALIDATION_FAILED',
            `Department code "${departmentCode}" does not exist. Upload the Departments sheet first.`,
          );
        }
      }

      const code = String(row.code);
      const data = {
        nameTh: String(row.nameTh),
        nameEn: String(row.nameEn),
        facultyId,
        departmentId,
        level: String(row.level) as ProgramLevel,
        status: (row.status ? String(row.status) : 'ACTIVE') as ProgramStatus,
        yearEstablished: row.yearEstablished === null ? null : Number(row.yearEstablished),
        durationYears: row.durationYears === null ? null : Number(row.durationYears),
        totalCredits: row.totalCredits === null ? null : Number(row.totalCredits),
        mhesiCode: row.mhesiCode === null ? null : String(row.mhesiCode),
      };

      const existing = await ctx.tx.program.findUnique({
        where: { code },
        select: { id: true, sequenceNoFromSheet: true },
      });

      if (existing) {
        // Never re-number an existing programme: other systems and shared
        // links may already quote its canonical code. But DO give one a
        // number if it has none — otherwise it stays invisible to every
        // Council surface despite having just been updated.
        //
        // ingestionRunId is deliberately not written here: provenance marks
        // which import created a row, not which one last touched it, and a
        // delete on this table cascades into every metric table.
        await ctx.tx.program.update({
          where: { code },
          data:
            existing.sequenceNoFromSheet === null
              ? { ...data, sequenceNoFromSheet: nextSeq++ }
              : data,
        });
        updated += 1;
      } else {
        await ctx.tx.program.create({
          data: { code, ...data, sequenceNoFromSheet: nextSeq, ingestionRunId: ctx.ingestionRunId },
        });
        nextSeq += 1;
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.program.count(),


  cascadeBlockers: async (prisma, runIds): Promise<{ label: string; count: number }[]> => {
    const counted = await Promise.all(
      CASCADE_CHILDREN.map(async (child) => ({
        label: child.label,
        count: await child.count(prisma, runIds),
      })),
    );
    // Same label twice (one per underlying table) reads as a mistake, so
    // merge before the message is built.
    const merged = new Map<string, number>();
    for (const row of counted) {
      if (row.count === 0) continue;
      merged.set(row.label, (merged.get(row.label) ?? 0) + row.count);
    }
    return [...merged].map(([label, count]) => ({ label, count }));
  },

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.program.deleteMany({ where: { ingestionRunId: { in: [...runIds] } } });
    return result.count;
  },
};
