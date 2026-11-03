import type { PrismaClient, ResearchServiceMemberRole, ResearchServiceProjectType } from '@prisma/client';

import { ApiError } from '@kku/shared';

import type {
  ImportColumn,
  ImportDataset,
  ImportLoadContext,
  ImportLoadResult,
  ImportRow,
} from '../types';
import { toBuddhistEra } from './cohorts';
import { yearColumn } from './enrollment';
import { PROVENANCE_SELECT, claimsRow } from './provenance';

// Tier 2. Externally funded projects and the staff on them: the two tables
// behind the Staff grants dashboard and the Financial dimension's grant award.
//
// They share their tables with the `kku-research-services` connector, which
// replaces its own snapshot daily. So an imported project carries an id the
// connector can never produce:
//   - id               `rsp-xlsx-<code>`   (the connector writes `rsp-<n>`)
//   - sourceProposalKey `xlsx:<code>`
//   - sourceProposalId  a NEGATIVE integer (the connector's are positive)
// and `clear` deletes by import run only.
//
// People appear ONLY as an employee code resolved to a staff member: there is
// no name column and the lead's citizen-id hash is never filled.

export const EXTERNAL_GRANTS_IMPORT_VERSION = 'xlsx-import.v1';

const TYPES: Readonly<Record<string, ResearchServiceProjectType>> = {
  Research: 'RESEARCH',
  'Academic service': 'ACADEMIC_SERVICE',
  Consulting: 'CONSULTING',
  Other: 'OTHER',
};

const ROLES: Readonly<Record<string, ResearchServiceMemberRole>> = {
  Lead: 'LEAD',
  'Co-investigator': 'CO_INVESTIGATOR',
};

const PROJECTS_SLUG = 'xlsx-external-grants';
const TEAM_SLUG = 'xlsx-external-grant-team';

const projectId = (code: string): string => `rsp-xlsx-${code}`;

const PROJECT_CODE_COLUMN: ImportColumn = {
  header: 'Project Code',
  key: 'projectCode',
  type: 'text',
  required: true,
  guide:
    'Your own identifier for the project, unique within the file. It is how a re-upload finds ' +
    'the same project, so it must not change between uploads.',
  example: 'GRANT-2025-014',
};

export const externalGrantsDataset: ImportDataset = {
  slug: 'external-grants',
  title: 'External Grants',
  description:
    'Externally funded research and academic-service projects, one row per project, with the ' +
    'whole-project budget. Pair it with the External Grant Team sheet. Feeds the Staff grants ' +
    'dashboard and the grant award on a programme’s Financial score.',
  tier: 2,
  sheetName: 'External Grants',
  columns: [
    PROJECT_CODE_COLUMN,
    {
      header: 'Title (Thai)',
      key: 'titleTh',
      type: 'text',
      required: true,
      guide: 'The project title in Thai. If you have no Thai title, repeat the English one.',
      example: 'โครงการวิจัยตัวอย่าง',
    },
    {
      header: 'Title (English)',
      key: 'titleEn',
      type: 'text',
      required: false,
      guide: 'The project title in English.',
      example: 'Sample research project',
    },
    {
      header: 'Type',
      key: 'type',
      type: 'enum',
      required: true,
      enumValues: Object.keys(TYPES),
      guide: 'What kind of project this is.',
      example: 'Research',
    },
    yearColumn(
      'Fiscal Year',
      'fiscalYear',
      'The fiscal year the project belongs to. The Thai fiscal year starts on 1 October of the ' +
        'previous calendar year, so fiscal year 2025 began on 1 October 2024. The award counts the ' +
        'last three complete fiscal years. Stored converted to the Buddhist era (plus 543).',
    ),
    {
      header: 'Budget (THB)',
      key: 'budgetThb',
      type: 'integer',
      required: false,
      guide:
        'The whole-project budget in baht. It is counted once for the project, never split ' +
        'between people or faculties. Leave blank if unknown: the project then counts for nothing ' +
        'in the award.',
      example: '1500000',
      check: (value) =>
        typeof value === 'number' && value < 0 ? 'A budget cannot be negative.' : null,
    },
    {
      header: 'Funder',
      key: 'funder',
      type: 'text',
      required: false,
      guide: 'The funding body.',
      example: 'National Research Council',
    },
    {
      header: 'Lead Faculty Code',
      key: 'leadFacultyCode',
      type: 'text',
      required: true,
      guide: 'The faculty leading the project, exactly as in the Faculties sheet.',
      example: 'ENG',
      references: { dataset: 'faculties', column: 'code' },
    },
  ],
  strategy: { kind: 'upsert', match: { kind: 'unique', columns: ['projectCode'] } },
  dependents: ['external-grant-team'],

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const codes = [...new Set(rows.map((r) => String(r.leadFacultyCode)))];
    const faculties = await ctx.tx.faculty.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, nameTh: true },
    });
    const byCode = new Map(faculties.map((f) => [f.code, f]));

    // Negative ids, allocated once per NEW row and kept on update. The
    // connector's ids are positive, so the two can never collide on the
    // unique index. Same idea as the programmes' canonical sequence number.
    const min = await ctx.tx.researchServiceProject.aggregate({ _min: { sourceProposalId: true } });
    let nextProposalId = Math.min(min._min.sourceProposalId ?? 0, 0) - 1;

    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const code = String(row.projectCode);
      const faculty = byCode.get(String(row.leadFacultyCode));
      if (!faculty) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Faculty code "${String(row.leadFacultyCode)}" does not exist. Upload the Faculties sheet first.`,
        );
      }
      const typeRaw = String(row.type);
      const data = {
        titleTh: String(row.titleTh),
        titleEn: typeof row.titleEn === 'string' ? row.titleEn : null,
        type: TYPES[typeRaw] ?? 'OTHER',
        typeRaw,
        fiscalYearBe: toBuddhistEra(Number(row.fiscalYear)),
        budgetThb: typeof row.budgetThb === 'number' ? BigInt(Math.round(row.budgetThb)) : null,
        funderName: typeof row.funder === 'string' ? row.funder : null,
        workflowStatus: 'IMPORTED',
        leadUnitName: faculty.nameTh,
        leadFacultyName: faculty.nameTh,
        facultyId: faculty.id,
      };

      const existing = await ctx.tx.researchServiceProject.findUnique({
        where: { id: projectId(code) },
        select: { id: true, ...PROVENANCE_SELECT },
      });
      if (existing) {
        await ctx.tx.researchServiceProject.update({
          where: { id: existing.id },
          data: claimsRow(existing) ? { ...data, ingestionRunId: ctx.ingestionRunId } : data,
        });
        updated += 1;
      } else {
        await ctx.tx.researchServiceProject.create({
          data: {
            id: projectId(code),
            sourceProposalId: nextProposalId--,
            sourceProposalKey: `xlsx:${code}`,
            ...data,
            ingestionRunId: ctx.ingestionRunId,
          },
        });
        inserted += 1;
      }
    }
    return { inserted, updated, deleted: 0 };
  },

  // Only rows this dataset wrote: the table also holds the connector's.
  count: (prisma: PrismaClient): Promise<number> =>
    prisma.researchServiceProject.count({
      where: { ingestionRun: { dataSource: { slug: PROJECTS_SLUG } } },
    }),

  clear: async (tx, runIds): Promise<number> => {
    // Members of a cleared project cascade; team rows the team sheet wrote
    // are normally cleared first (it is a dependent).
    const result = await tx.researchServiceProject.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};

export const externalGrantTeamDataset: ImportDataset = {
  slug: 'external-grant-team',
  title: 'External Grant Team',
  description:
    'Which staff member sits on which external grant, and in what role. One row per person per ' +
    'project; staff are named only by their Employee Code. A project counts toward a programme’s ' +
    'grant award when any of its active teaching staff is on it.',
  tier: 2,
  sheetName: 'External Grant Team',
  columns: [
    {
      ...PROJECT_CODE_COLUMN,
      guide:
        'The project, exactly as its Project Code in the External Grants sheet. Upload that sheet ' +
        'first.',
      references: { dataset: 'external-grants', column: 'projectCode' },
    },
    {
      header: 'Employee Code',
      key: 'employeeCode',
      type: 'text',
      required: true,
      guide:
        'The staff member, exactly as their Employee Code in the Staff sheet. A code that matches ' +
        'no staff member is refused: a team row nobody can resolve counts for nothing.',
      example: 'EMP-0042',
      references: { dataset: 'faculty-members', column: 'employeeCode' },
    },
    {
      header: 'Role',
      key: 'role',
      type: 'enum',
      required: true,
      enumValues: Object.keys(ROLES),
      guide: 'Their role on the project.',
      example: 'Lead',
    },
  ],
  // The pair, not a database constraint: the table has none.
  strategy: { kind: 'upsert', match: { kind: 'manual', columns: ['projectCode', 'employeeCode'] } },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const staff = await ctx.tx.facultyMember.findMany({
      where: { employeeCode: { in: [...new Set(rows.map((r) => String(r.employeeCode)))] } },
      select: { id: true, employeeCode: true, facultyId: true, faculty: { select: { nameTh: true } } },
    });
    const byCode = new Map(staff.map((s) => [s.employeeCode, s]));

    const ids = [...new Set(rows.map((r) => projectId(String(r.projectCode))))];
    const projects = await ctx.tx.researchServiceProject.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const known = new Set(projects.map((p) => p.id));

    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const code = String(row.projectCode);
      const pid = projectId(code);
      if (!known.has(pid)) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Project code "${code}" does not exist. Upload the External Grants sheet first.`,
        );
      }
      const member = byCode.get(String(row.employeeCode));
      if (!member) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Employee code "${String(row.employeeCode)}" matches no staff member. Upload the Staff sheet first.`,
        );
      }
      const role = ROLES[String(row.role)] ?? 'CO_INVESTIGATOR';

      const existing = await ctx.tx.researchServiceProjectMember.findFirst({
        where: { projectId: pid, facultyMemberId: member.id },
        select: { id: true, ...PROVENANCE_SELECT },
      });
      if (existing) {
        await ctx.tx.researchServiceProjectMember.update({
          where: { id: existing.id },
          data: claimsRow(existing) ? { role, ingestionRunId: ctx.ingestionRunId } : { role },
        });
        updated += 1;
      } else {
        await ctx.tx.researchServiceProjectMember.create({
          data: {
            projectId: pid,
            role,
            facultyMemberId: member.id,
            facultyId: member.facultyId,
            facultyName: member.faculty.nameTh,
            ingestionRunId: ctx.ingestionRunId,
          },
        });
        inserted += 1;
      }
    }
    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> =>
    prisma.researchServiceProjectMember.count({
      where: { ingestionRun: { dataSource: { slug: TEAM_SLUG } } },
    }),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.researchServiceProjectMember.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
