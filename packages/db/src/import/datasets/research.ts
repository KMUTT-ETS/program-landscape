import type { PrismaClient, ResearchOutputType } from '@prisma/client';

import { ApiError } from '@kku/shared';

import type {
  ImportDataset,
  ImportLoadContext,
  ImportLoadResult,
  ImportRow,
} from '../types';
import { optDate, optNum, optStr } from './optional';
import { yearColumn } from './enrollment';
import { PROVENANCE_SELECT, claimsRow } from './provenance';

// Tier 2. Publications, one row per paper PER AUTHOR.
//
// That shape is the table's, not ours: `research_outputs` holds a row for
// each (paper, KKU author) pair, which is how a paper counts for every
// faculty that contributed to it. Two staff who wrote the same paper get
// two rows, and this import must not collapse them.
//
// Matching is manual (§8.3). `doi` is indexed but NOT unique, and making it
// unique would collide with rows the kku-research connector already wrote,
// so the loader does findFirst → update | create: by DOI where there is
// one, by (title, year) where there is not. Both are scoped to the staff
// member, so a fallback match can never reach across people.

const TYPES = ['JOURNAL', 'CONFERENCE', 'PATENT', 'BOOK'] as const;

export const researchDataset: ImportDataset = {
  slug: 'research-outputs',
  title: 'Publications',
  description:
    'Research outputs, one row per paper per author. A paper with three of ' +
    'your staff on it is three rows — that is how it counts for each of them.',
  tier: 2,
  sheetName: 'Publications',
  columns: [
    {
      header: 'Employee Code',
      key: 'employeeCode',
      type: 'text',
      required: true,
      guide:
        'Which of your staff this row credits, exactly as in the Staff sheet. ' +
        'List a co-authored paper once per author, each on its own row.',
      example: 'EMP-10427',
      references: { dataset: 'faculty-members', column: 'employeeCode' },
    },
    yearColumn('Year', 'year', 'Year of publication.'),
    {
      header: 'Type',
      key: 'type',
      type: 'enum',
      required: true,
      enumValues: TYPES,
      guide: 'What kind of output it is.',
      example: 'JOURNAL',
    },
    {
      header: 'Title',
      key: 'title',
      type: 'text',
      required: true,
      guide:
        'The full title. Where a row has no DOI this is half of what identifies ' +
        'it, so keep it identical between uploads or you will get a duplicate.',
      example: 'Fatigue in welded steel connections',
    },
    {
      header: 'Venue',
      key: 'venue',
      type: 'text',
      required: false,
      guide: 'Journal, conference or publisher. Optional.',
      example: 'Journal of Structural Engineering',
    },
    {
      header: 'Citations',
      key: 'citations',
      type: 'integer',
      required: false,
      guide:
        'Citation count at the time of export. Blank keeps whatever is stored, ' +
        'so a sheet without this column never resets counts a connector supplied.',
      example: '19',
      check: (value) =>
        typeof value === 'number' && value < 0 ? 'A citation count cannot be negative.' : null,
    },
    {
      header: 'DOI',
      key: 'doi',
      type: 'text',
      required: false,
      guide:
        'Digital Object Identifier, if the output has one. Supplying it is what ' +
        'lets a re-upload recognise the same paper even if its title was edited.',
      example: '10.1234/jse.2023.0042',
    },
  ],
  strategy: {
    kind: 'upsert',
    match: { kind: 'manual', columns: ['doi', 'employeeCode'], fallback: ['title', 'year', 'employeeCode'] },
  },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const codes = [...new Set(rows.map((r) => String(r.employeeCode)))];
    const members = await ctx.tx.facultyMember.findMany({
      where: { employeeCode: { in: codes } },
      select: { id: true, employeeCode: true },
    });
    const memberByCode = new Map(members.map((m) => [m.employeeCode, m.id]));

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const employeeCode = String(row.employeeCode);
      const facultyMemberId = memberByCode.get(employeeCode);
      if (!facultyMemberId) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Employee code "${employeeCode}" does not exist. Upload the Staff sheet first.`,
        );
      }

      // An absent DOI column matches by title and year, and leaves a stored
      // DOI alone on update.
      const doiCell = optStr(row.doi);
      const doi = doiCell ?? null;
      const title = String(row.title);
      const year = Number(row.year);

      // Both branches are scoped to this person. A paper is one row per
      // author, so matching on title alone would let one person's upload
      // silently take over another's row.
      const existing = await ctx.tx.researchOutput.findFirst({
        where: doi !== null ? { facultyMemberId, doi } : { facultyMemberId, title, year },
        select: { id: true, ...PROVENANCE_SELECT },
      });

      const fields = {
        year,
        type: String(row.type) as ResearchOutputType,
        title,
        venue: optStr(row.venue),
        doi: doiCell,
      };

      if (existing) {
        // Blank citations leave a connector-supplied count alone rather
        // than zeroing it, so a sheet without the column is still safe.
        const data: typeof fields & { citations?: number; ingestionRunId?: string } = { ...fields };
        if (typeof row.citations === 'number') data.citations = row.citations;
        if (claimsRow(existing)) data.ingestionRunId = ctx.ingestionRunId;

        await ctx.tx.researchOutput.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await ctx.tx.researchOutput.create({
          data: {
            facultyMemberId,
            ...fields,
            citations: Number(row.citations ?? 0),
            source: 'xlsx-import',
            ingestionRunId: ctx.ingestionRunId,
          },
        });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.researchOutput.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.researchOutput.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
