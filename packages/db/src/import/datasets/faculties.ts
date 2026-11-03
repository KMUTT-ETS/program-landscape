import type { FacultyKind, Prisma, PrismaClient, SfrBand } from '@prisma/client';

import type { ImportDataset, ImportLoadContext, ImportLoadResult, ImportRow } from '../types';

// Tier 0. Nothing else can load until this does: departments reference a
// faculty code, programmes reference both, and every metric row hangs off a
// programme. On a fresh install there is no admin API for this table at all
// — the faculty list is a seed constant — so this declaration is the only
// way an adopting university can get started without editing code.

const KINDS = ['ACADEMIC', 'ADMIN', 'INSTITUTE', 'RESEARCH_CENTER'] as const;

// Sheet wording -> stored band. Typed text rather than the 'enum' column
// type because the sheet words ("Lab-based") are not the stored values and
// the match is case-insensitive.
const TEACHING_MODES: Readonly<Record<string, SfrBand>> = {
  clinical: 'CLINICAL',
  'lab-based': 'STEM_LAB',
  studio: 'STUDIO',
  professional: 'PROFESSIONAL',
  humanities: 'HUMANITIES',
};
const TEACHING_MODE_LABELS = 'Clinical, Lab-based, Studio, Professional, Humanities';

// ── What a start-over on this dataset would destroy ──────────────────────
//
// Faculty's children come in three flavours and all three matter:
//
//  - CASCADE (FacultySkill, CrossScopeDivergenceSnapshot, FacultyCompensation)
//    are emptied silently. Compensation is the one that hurts: aggregate
//    salary figures nobody can reconstruct from the import.
//  - RESTRICT (FacultyMember, Department, Program) turn the delete into a
//    raw foreign-key error — a 500 with nothing cleared and no sentence an
//    operator can act on.
//  - SET NULL (FacultyBudget, ClassOffering, and others) survive, but lose
//    the link that makes them roll up to anything.
//
// All three deserve a refusal naming what is in the way. The CASCADE list is
// checked against the schema by test/import-cascade-coverage.test.ts; the
// rest are here because losing them quietly is just as bad.

interface FacultyCascadeChild {
  /** Prisma model name. Matched against schema.prisma by the structural test. */
  model: string;
  label: string;
  count: (tx: Prisma.TransactionClient, runIds: readonly string[]) => Promise<number>;
}

/** Children whose rows block a start-over on faculties while any exist. */
export const FACULTY_CASCADE_CHILDREN: readonly FacultyCascadeChild[] = [
  // Cascade — silently emptied.
  { model: 'FacultyCompensation', label: 'compensation figures', count: (t, r) => t.facultyCompensation.count({ where: byFaculty(r) }) },
  { model: 'FacultySkill', label: 'faculty skill rollups', count: (t, r) => t.facultySkill.count({ where: byFaculty(r) }) },
  { model: 'CrossScopeDivergenceSnapshot', label: 'data-quality snapshots', count: (t, r) => t.crossScopeDivergenceSnapshot.count({ where: byFaculty(r) }) },
  // Restrict — a raw foreign-key error instead of a readable refusal.
  { model: 'FacultyMember', label: 'staff records', count: (t, r) => t.facultyMember.count({ where: byFaculty(r) }) },
  // SetNull — survives, but orphaned from the faculty it belongs to.
  { model: 'FacultyBudget', label: 'faculty budgets', count: (t, r) => t.facultyBudget.count({ where: byFaculty(r) }) },
];

/**
 * Faculty cascade children deliberately not counted, each with its reason.
 * Empty today; an entry here asserts that losing the table's rows is fine.
 */
export const FACULTY_CASCADE_CHILDREN_UNREACHABLE: readonly { model: string; reason: string }[] = [];

/** Rows hanging off a faculty this import created. */
function byFaculty(runIds: readonly string[]) {
  return { faculty: { ingestionRunId: { in: [...runIds] } } };
}

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
      guide:
        'The faculty name in Thai, as it should appear on screen and in reports. ' +
        'Write it exactly as the national TCAS admission data (mytcas.com) spells ' +
        'it, e.g. คณะวิศวกรรมศาสตร์ — with no campus or university suffix. The TCAS ' +
        'connector links admission figures to a programme only when this name ' +
        'matches TCAS letter for letter; otherwise the Admissions section of the ' +
        'programme page stays empty.',
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
    {
      header: 'Teaching Mode',
      key: 'sfrBand',
      type: 'text',
      required: false,
      guide:
        'How the faculty teaches, which sets the student-to-staff ratio its ' +
        'Capability score is judged against. Clinical: patient-supervised, ' +
        'the strictest ratio. Lab-based: laboratory-intensive science and ' +
        'engineering. Studio: individual instruction in design or art. ' +
        'Professional: cohort-based professional programmes (the default). ' +
        'Humanities: lecture-heavy humanities, social science and education, ' +
        'the most lenient. Leave blank to keep the current value (Professional ' +
        'for a new faculty).',
      example: 'Lab-based',
      check: (value): string | null =>
        typeof value === 'string' && TEACHING_MODES[value.trim().toLowerCase()] === undefined
          ? `"${value}" is not allowed. Use one of: ${TEACHING_MODE_LABELS}.`
          : null,
    },
  ],
  strategy: { kind: 'upsert', match: { kind: 'unique', columns: ['code'] } },
  // The last five store a denormalised facultyId with no foreign key, so
  // clearing faculties would orphan them silently instead of cascading.
  dependents: [
    'departments',
    'programmes',
    'faculty-members',
    'course-evaluations',
    'digital-competency-cohorts',
    'digital-competency-modules',
    'external-grants',
    'staff-salary-by-funding',
  ],

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const code = String(row.code);
      const data = {
        nameTh: String(row.nameTh),
        nameEn: String(row.nameEn),
        kind: (row.kind ? String(row.kind) : 'ACADEMIC') as FacultyKind,
        // Blank: untouched on update (key absent), null on insert.
        ...(row.sfrBand ? { sfrBand: TEACHING_MODES[String(row.sfrBand).trim().toLowerCase()] } : {}),
      };
      const existing = await ctx.tx.faculty.findUnique({ where: { code }, select: { id: true } });
      if (existing) {
        // Deliberately NOT stamping ingestionRunId here. Provenance marks
        // which import CREATED a row, not which one last touched it:
        // start-over deletes what it owns, and deleting a seeded or
        // connector-written faculty cascades well beyond this table.
        await ctx.tx.faculty.update({ where: { code }, data });
        updated += 1;
      } else {
        await ctx.tx.faculty.create({ data: { code, ...data, ingestionRunId: ctx.ingestionRunId } });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.faculty.count(),

  cascadeBlockers: async (tx, runIds): Promise<{ label: string; count: number }[]> => {
    const counted = await Promise.all(
      FACULTY_CASCADE_CHILDREN.map(async (child) => ({
        label: child.label,
        count: await child.count(tx, runIds),
      })),
    );
    const merged = new Map<string, number>();
    for (const row of counted) {
      if (row.count === 0) continue;
      merged.set(row.label, (merged.get(row.label) ?? 0) + row.count);
    }
    return [...merged].map(([label, count]) => ({ label, count }));
  },

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.faculty.deleteMany({ where: { ingestionRunId: { in: [...runIds] } } });
    return result.count;
  },
};
