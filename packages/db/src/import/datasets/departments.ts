import type { PrismaClient } from '@prisma/client';

import { ApiError } from '@kku/shared';

import type { ImportDataset, ImportLoadContext, ImportLoadResult, ImportRow } from '../types';

// Tier 0. Departments sit between a faculty and a programme. A programme may
// have none, so this dataset is optional for an installation that does not
// model departments at all.

export const departmentsDataset: ImportDataset = {
  slug: 'departments',
  title: 'Departments',
  description:
    'Departments within a faculty. Optional — leave this empty if your ' +
    'programmes hang directly off faculties.',
  tier: 0,
  sheetName: 'Departments',
  columns: [
    {
      header: 'Department Code',
      key: 'code',
      type: 'text',
      required: true,
      guide:
        'Your own identifier for the department. It must stay the same between ' +
        'uploads, because it is how a row is matched to one already here.',
      example: 'ENG-CIVIL',
    },
    {
      header: 'Name (Thai)',
      key: 'nameTh',
      type: 'text',
      required: true,
      guide: 'The department name in Thai.',
      example: 'สาขาวิชาวิศวกรรมโยธา',
    },
    {
      header: 'Name (English)',
      key: 'nameEn',
      type: 'text',
      required: true,
      guide: 'The department name in English.',
      example: 'Department of Civil Engineering',
    },
    {
      header: 'Faculty Code',
      key: 'facultyCode',
      type: 'text',
      required: true,
      guide:
        'The owning faculty, written exactly as its Faculty Code in the ' +
        'Faculties sheet. Upload Faculties first.',
      example: 'ENG',
      references: { dataset: 'faculties', column: 'code' },
    },
  ],
  strategy: { kind: 'upsert', match: { kind: 'unique', columns: ['code'] } },
  dependents: ['programmes'],

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    // Resolve every faculty code in one query rather than one per row.
    const codes = [...new Set(rows.map((r) => String(r.facultyCode)))];
    const faculties = await ctx.tx.faculty.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    const facultyIdByCode = new Map(faculties.map((f) => [f.code, f.id]));

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const facultyCode = String(row.facultyCode);
      const facultyId = facultyIdByCode.get(facultyCode);
      if (!facultyId) {
        // Validation checks references before the loader runs, so reaching
        // here means the two disagree. Fail the whole file rather than drop
        // the row silently.
        throw new ApiError(
          'VALIDATION_FAILED',
          `Faculty code "${facultyCode}" does not exist. Upload the Faculties sheet first.`,
        );
      }

      const code = String(row.code);
      const data = {
        nameTh: String(row.nameTh),
        nameEn: String(row.nameEn),
        facultyId,
      };
      const existing = await ctx.tx.department.findUnique({ where: { code }, select: { id: true } });
      if (existing) {
        // See faculties.ts: provenance marks origin, not last writer.
        await ctx.tx.department.update({ where: { code }, data });
        updated += 1;
      } else {
        await ctx.tx.department.create({ data: { code, ...data, ingestionRunId: ctx.ingestionRunId } });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.department.count(),

  // `FacultyMember.department` is SetNull and programmes are covered by
  // `dependents`, so the only cascade worth refusing for is staff: clearing
  // departments would quietly unassign them.
  cascadeBlockers: async (prisma, runIds): Promise<{ label: string; count: number }[]> => {
    const staff = await prisma.facultyMember.count({
      where: { department: { ingestionRunId: { in: [...runIds] } } },
    });
    return staff > 0 ? [{ label: 'staff assigned to these departments', count: staff }] : [];
  },

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.department.deleteMany({ where: { ingestionRunId: { in: [...runIds] } } });
    return result.count;
  },
};
