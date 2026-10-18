import type { PrismaClient, ProgramLevel, ProgramStatus } from '@prisma/client';

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

  // Every foreign key into `programs` is onDelete: Cascade, so deleting an
  // imported programme would take its enrolment, finance, cohort, alumni,
  // outcome and admission rows with it — rows a connector wrote and this
  // import never touched. Start-over refuses while any exist.
  //
  // This list is the data-bearing children. EXTEND IT when a tier-1 dataset
  // lands; a missing entry here is silent data loss, not a failed check.
  cascadeBlockers: async (prisma, runIds): Promise<{ label: string; count: number }[]> => {
    const where = { program: { ingestionRunId: { in: [...runIds] } } };
    const [enrolment, financial, cohorts, alumni, outcomes, tcas, campaigns, courses] =
      await Promise.all([
        prisma.enrollmentMetric.count({ where }),
        prisma.financialMetric.count({ where }),
        prisma.studentCohortDistribution.count({ where }),
        prisma.alumniCohortStatus.count({ where }),
        prisma.graduateOutcome.count({ where }),
        prisma.tcasAdmissionStat.count({ where }),
        prisma.admissionCampaignStat.count({ where }),
        prisma.programCourse.count({ where }),
      ]);

    return [
      { label: 'enrolment figures', count: enrolment },
      { label: 'financial figures', count: financial },
      { label: 'student cohorts', count: cohorts },
      { label: 'alumni cohorts', count: alumni },
      { label: 'graduate outcomes', count: outcomes },
      { label: 'TCAS admission statistics', count: tcas },
      { label: 'admission campaigns', count: campaigns },
      { label: 'courses', count: courses },
    ].filter((b) => b.count > 0);
  },

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.program.deleteMany({ where: { ingestionRunId: { in: [...runIds] } } });
    return result.count;
  },
};
