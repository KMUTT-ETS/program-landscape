import type { FacultyKind, PrismaClient } from '@prisma/client';

import type { ImportDataset, ImportLoadContext, ImportLoadResult, ImportRow } from '../types';

// Tier 0. Nothing else can load until this does: departments reference a
// faculty code, programmes reference both, and every metric row hangs off a
// programme. On a fresh install there is no admin API for this table at all
// — the faculty list is a seed constant — so this declaration is the only
// way an adopting university can get started without editing code.

const KINDS = ['ACADEMIC', 'ADMIN', 'INSTITUTE', 'RESEARCH_CENTER'] as const;

export const facultiesDataset: ImportDataset = {
  slug: 'faculties',
  title: 'Faculties',
  description:
    'The faculties, colleges and institutes that own programmes. Upload this first — ' +
    'departments and programmes refer to these codes.',
  tier: 0,
  sheetName: 'Faculties',
  columns: [
    {
      header: 'Faculty Code',
      key: 'code',
      type: 'text',
      required: true,
      guide:
        'Your own identifier for the faculty, e.g. ENG. It must stay the same ' +
        'between uploads, because it is how a row is matched to one already ' +
        'here. Format the cell as text if the code starts with a zero, or ' +
        'Excel will drop it.',
      example: 'ENG',
    },
    {
      header: 'Name (Thai)',
      key: 'nameTh',
      type: 'text',
      required: true,
      guide: 'The faculty name in Thai, as it should appear on screen and in reports.',
      example: 'คณะวิศวกรรมศาสตร์',
    },
    {
      header: 'Name (English)',
      key: 'nameEn',
      type: 'text',
      required: true,
      guide: 'The faculty name in English.',
      example: 'Faculty of Engineering',
    },
    {
      header: 'Kind',
      key: 'kind',
      type: 'enum',
      required: false,
      enumValues: KINDS,
      guide:
        'What sort of unit this is. Leave blank for an ordinary teaching ' +
        'faculty — it defaults to ACADEMIC.',
      example: 'ACADEMIC',
    },
  ],
  strategy: { kind: 'upsert', match: { kind: 'unique', columns: ['code'] } },
  dependents: ['departments', 'programmes'],

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const code = String(row.code);
      const data = {
        nameTh: String(row.nameTh),
        nameEn: String(row.nameEn),
        kind: (row.kind ? String(row.kind) : 'ACADEMIC') as FacultyKind,
        ingestionRunId: ctx.ingestionRunId,
      };
      const existing = await ctx.tx.faculty.findUnique({ where: { code }, select: { id: true } });
      if (existing) {
        await ctx.tx.faculty.update({ where: { code }, data });
        updated += 1;
      } else {
        await ctx.tx.faculty.create({ data: { code, ...data } });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.faculty.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.faculty.deleteMany({ where: { ingestionRunId: { in: [...runIds] } } });
    return result.count;
  },
};
