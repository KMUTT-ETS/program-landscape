import type { PrismaClient } from '@prisma/client';

import { ApiError } from '@kku/shared';

import type {
  ImportDataset,
  ImportLoadContext,
  ImportLoadResult,
  ImportRow,
} from '../types';
import { PROVENANCE_SELECT, claimsRow } from './provenance';

// Tier 2. Who teaches each programme.
//
// The link table the Deep-Dive is built on, and the one input an adopting
// university had no route to at all. Everywhere else, a sheet fills a table
// that stands on its own; this one fills the join that makes three OTHER
// sheets mean something:
//
//   - the faculty section and the succession-risk view read it directly;
//   - `student_faculty_ratio`, `publications_per_faculty` and
//     `senior_rank_share` — effectively the whole Capability dimension of
//     the health score — are computed through it;
//   - a publication attaches to a PERSON, and reaches a programme only
//     through here, so without these rows an imported research roster
//     contributes nothing to any programme page.
//
// Until now it was written only by `program-faculty.v1`, an AI extraction
// over the programme's Thai curriculum PDF. An adopter with no such PDF —
// which is every university outside this one's document conventions — had
// no way to state who teaches what.
//
// `realDataWhere()` is NOT applied to this table by any reader, so unlike
// the tier-1 metrics there is no invisibility trap here: a row loads and is
// read. The run id exists for start-over, not for visibility.

/**
 * How a person serves a programme. Mirrors the `ProgramFacultyRole` enum.
 * A blank cell stores CORE, which is also the column default in the schema.
 */
const ROLES = ['COORDINATOR', 'CORE', 'SUPPORT'] as const;

type Role = (typeof ROLES)[number];

export const programFacultyDataset: ImportDataset = {
  slug: 'program-faculty',
  title: 'Programme teaching staff',
  description:
    'Which staff teach which programmes. One row per person per programme — ' +
    'the link that lets publications, seniority and staffing ratios reach a ' +
    'programme page.',
  tier: 2,
  sheetName: 'Programme Staff',
  columns: [
    {
      header: 'Programme Code',
      key: 'programmeCode',
      type: 'text',
      required: true,
      guide:
        'The programme this person teaches on, exactly as it appears in the ' +
        'Programmes sheet.',
      example: 'ENG-CPE-BSC',
      references: { dataset: 'programmes', column: 'code' },
    },
    {
      header: 'Employee Code',
      key: 'employeeCode',
      type: 'text',
      required: true,
      guide:
        'The staff member, exactly as it appears in the Academic staff ' +
        'roster. Upload that sheet first.',
      example: 'EMP-10234',
      references: { dataset: 'faculty-members', column: 'employeeCode' },
    },
    {
      header: 'Role',
      key: 'role',
      type: 'enum',
      required: false,
      enumValues: ROLES,
      guide:
        'How this person serves the programme. A coordinator runs it, core ' +
        'staff own its required teaching, support staff contribute to it. ' +
        'Leave blank for core.',
      example: 'CORE',
    },
    {
      header: 'Curriculum Year',
      key: 'curriculumYear',
      type: 'integer',
      required: false,
      guide:
        'Optional. The curriculum revision this roster belongs to, as a ' +
        'Common Era year (2024, not 2567). Leave it blank unless you keep ' +
        'more than one revision of a programme — a blank uses whichever ' +
        'revision the programme is currently on, and a programme with no ' +
        'revisions at all is perfectly normal.',
      example: '2024',
      check: (value) => {
        if (typeof value !== 'number') return null;
        if (value < 1950) return `${value} is too early to be a curriculum year.`;
        if (value > new Date().getUTCFullYear() + 10) {
          return `${value} is too far ahead. If this is a Buddhist-era year, subtract 543 — BE 2567 is CE 2024.`;
        }
        return null;
      },
    },
  ],
  strategy: {
    // Exactly the shape of the unique index, `(facultyMemberId, programId)`.
    // A curriculum revision is an ATTRIBUTE of the link and deliberately NOT
    // part of its identity: the index permits one row per person per
    // programme, so keying on the revision too would let the sheet accept
    // two rows that the insert then rejects — an error naming a database
    // constraint rather than a cell the operator can fix.
    kind: 'upsert',
    match: { kind: 'unique', columns: ['programmeCode', 'employeeCode'] },
  },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const programmeCodes = [...new Set(rows.map((r) => String(r.programmeCode)))];
    const employeeCodes = [...new Set(rows.map((r) => String(r.employeeCode)))];

    const [programmes, members] = await Promise.all([
      ctx.tx.program.findMany({
        where: { code: { in: programmeCodes } },
        select: { id: true, code: true, activeRevisionId: true },
      }),
      ctx.tx.facultyMember.findMany({
        where: { employeeCode: { in: employeeCodes } },
        select: { id: true, employeeCode: true },
      }),
    ]);
    const programByCode = new Map(programmes.map((p) => [p.code, p]));
    const memberIdByCode = new Map(members.map((m) => [m.employeeCode, m.id]));

    // Revisions are per programme, so a stated year resolves within the
    // programme it was stated for — two programmes may both have a 2024
    // revision and they are different rows.
    const revisions = await ctx.tx.programRevision.findMany({
      where: { programId: { in: programmes.map((p) => p.id) } },
      select: { id: true, programId: true, curriculumYearBE: true },
    });
    const revisionByProgrammeYear = new Map(
      revisions
        .filter((r) => r.curriculumYearBE !== null)
        .map((r) => [`${r.programId}\u001f${r.curriculumYearBE}`, r.id]),
    );

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const programmeCode = String(row.programmeCode);
      const programme = programByCode.get(programmeCode);
      if (!programme) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Programme code "${programmeCode}" does not exist. Upload the Programmes sheet first.`,
        );
      }

      const employeeCode = String(row.employeeCode);
      const facultyMemberId = memberIdByCode.get(employeeCode);
      if (!facultyMemberId) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Employee code "${employeeCode}" does not exist. Upload the Academic staff roster first.`,
        );
      }

      // Validation has already rejected anything outside ROLES; a blank
      // cell is the common case and means core.
      const role: Role = typeof row.role === 'string' && row.role !== ''
        ? (row.role as Role)
        : 'CORE';

      // Blank means "the revision this programme is on", which is what the
      // AI path records. A stated year must resolve, or the operator has
      // named a revision that does not exist and would otherwise get a row
      // silently attached to the wrong one.
      let programRevisionId: string | null = programme.activeRevisionId;
      if (typeof row.curriculumYear === 'number') {
        const buddhistYear = row.curriculumYear + 543;
        const found = revisionByProgrammeYear.get(`${programme.id}\u001f${buddhistYear}`);
        if (!found) {
          throw new ApiError(
            'VALIDATION_FAILED',
            `Programme "${programmeCode}" has no curriculum revision for ${row.curriculumYear}. ` +
              'Leave Curriculum Year blank to use the revision the programme is currently on.',
          );
        }
        programRevisionId = found;
      }

      const existing = await ctx.tx.programFaculty.findUnique({
        where: { facultyMemberId_programId: { facultyMemberId, programId: programme.id } },
        select: { id: true, ...PROVENANCE_SELECT },
      });

      if (existing) {
        // Same rule as every other dataset: an upload never re-attributes a
        // row a live source created, because start-over deletes by run id
        // and claiming one would put its history inside this dataset's
        // blast radius. A row from the curriculum-PDF extraction carries no
        // run at all, so it IS claimed — the operator has just asserted it.
        const data: Record<string, string | null> = {};
        if (row.role !== undefined) data.role = role;
        // A sheet without the Curriculum Year column leaves the stored revision alone.
        if (row.curriculumYear !== undefined) data.programRevisionId = programRevisionId;
        if (claimsRow(existing)) data.ingestionRunId = ctx.ingestionRunId;

        await ctx.tx.programFaculty.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await ctx.tx.programFaculty.create({
          data: {
            programId: programme.id,
            facultyMemberId,
            role,
            programRevisionId,
            ingestionRunId: ctx.ingestionRunId,
          },
        });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.programFaculty.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.programFaculty.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
