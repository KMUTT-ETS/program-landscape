// Which nodes sit under a scope: the rows a scope's health table lists
// (resolveChildren) and the programmes a scope score aggregates
// (collectProgramIdsForScope). Both use the same canonical + ACTIVE population.

import type { ScopeLevel } from '../scope';
import { prisma } from '../index';

// ──────────────────────────────────────────────────────────────────────────
// Child resolution
// ──────────────────────────────────────────────────────────────────────────


export interface ChildNode {
  id: string;
  label: string; // legacy single-line "EN · TH" form, retained for any
                 //  surface that renders one string (logs, AI prompts).
  labelTh: string;
  labelEn: string;
  parentId: string | null;
}

export interface ChildResolution {
  /** Effective scope of the returned nodes — usually the natural child
   *  scope (university → faculty → department → program), but may
   *  collapse one level when an intermediate org tier is empty. */
  scope: ScopeLevel;
  nodes: ChildNode[];
}

export async function resolveChildren(scope: ScopeLevel, scopeId: string | null): Promise<ChildResolution> {
  if (scope === 'university') {
    // Curriculum landscape = academic faculties that host at least one
    // canonical-297 program. Excludes:
    //   - non-academic units (kind != ACADEMIC: ADMIN / RESEARCH_CENTER /
    //     INSTITUTE) — they hold staff but no curriculum
    //   - academic faculties with zero canonical programs — cockpit
    //     can't compute meaningful health scores for them anyway
    const rows = await prisma.faculty.findMany({
      where: {
        kind: 'ACADEMIC',
        programs: {
          some: {
            status: 'ACTIVE',
            sequenceNoFromSheet: { not: null },
          },
        },
      },
      select: { id: true, nameEn: true, nameTh: true },
      // Thai-dictionary order. Postgres en_US.utf8 honours libc's Thai
      // collation rules including leading-vowel reorder — verified
      // against the canonical 26 academic faculties on 2026-05-07.
      orderBy: { nameTh: 'asc' },
    });
    return {
      scope: 'faculty',
      nodes: rows.map((r) => ({
        id: r.id,
        label: `${r.nameEn} · ${r.nameTh}`,
        labelTh: r.nameTh ?? '',
        labelEn: r.nameEn ?? '',
        parentId: null,
      })),
    };
  }
  if (scope === 'faculty') {
    if (!scopeId) return { scope: 'program', nodes: [] };
    // Two-level drill (university → faculty → program) — the
    // department middle tier was removed 2026-05-07. Departments
    // didn't add useful aggregation in many faculties (some had every
    // program with departmentId=NULL anyway, e.g., Engineering's 19/19),
    // and the extra click without much information confused users.
    // The department scope still works if hit by direct URL (the
    // 'department' branch below stays intact), but the cockpit no
    // longer auto-navigates through it.
    const progRows = await prisma.program.findMany({
      where: {
        facultyId: scopeId,
        status: 'ACTIVE',
        sequenceNoFromSheet: { not: null },
      },
      select: { id: true, nameEn: true, nameTh: true, facultyId: true },
      orderBy: { code: 'asc' },
    });
    return {
      scope: 'program',
      nodes: progRows.map((r) => ({
        id: r.id,
        label: `${r.nameEn} · ${r.nameTh}`,
        labelTh: r.nameTh ?? '',
        labelEn: r.nameEn ?? '',
        parentId: r.facultyId,
      })),
    };
  }
  if (scope === 'department') {
    if (!scopeId) return { scope: 'program', nodes: [] };
    const rows = await prisma.program.findMany({
      where: {
        departmentId: scopeId,
        status: 'ACTIVE',
        sequenceNoFromSheet: { not: null },
      },
      select: { id: true, nameEn: true, nameTh: true, departmentId: true },
      orderBy: { code: 'asc' },
    });
    return {
      scope: 'program',
      nodes: rows.map((r) => ({
        id: r.id,
        label: `${r.nameEn} · ${r.nameTh}`,
        labelTh: r.nameTh ?? '',
        labelEn: r.nameEn ?? '',
        parentId: r.departmentId,
      })),
    };
  }
  if (!scopeId) return { scope: 'program', nodes: [] };
  const row = await prisma.program.findUnique({
    where: { id: scopeId },
    select: { id: true, nameEn: true, nameTh: true, departmentId: true },
  });
  return {
    scope: 'program',
    nodes: row
      ? [{
          id: row.id,
          label: `${row.nameEn} · ${row.nameTh}`,
          labelTh: row.nameTh ?? '',
          labelEn: row.nameEn ?? '',
          parentId: row.departmentId,
        }]
      : [],
  };
}

export async function collectProgramIdsForScope(scopeId: string, scope: ScopeLevel): Promise<string[]> {
  if (scope === 'program') return [scopeId];
  // Canonical+ACTIVE only, matching resolveChildren — so a scope score
  // aggregates exactly the programs listed beneath it. Before v5.0 this
  // helper counted retired and non-canonical rows that the heatmap never
  // showed, so the relevance and capability scope drivers averaged a
  // different population than the row they appeared on.
  const canonical = { status: 'ACTIVE' as const, sequenceNoFromSheet: { not: null } };
  if (scope === 'department') {
    const ps = await prisma.program.findMany({
      where: { departmentId: scopeId, ...canonical },
      select: { id: true },
    });
    return ps.map((p) => p.id);
  }
  if (scope === 'faculty') {
    const ps = await prisma.program.findMany({
      where: {
        OR: [{ facultyId: scopeId }, { department: { facultyId: scopeId } }],
        ...canonical,
      },
      select: { id: true },
    });
    return ps.map((p) => p.id);
  }
  // university
  const ps = await prisma.program.findMany({ where: canonical, select: { id: true } });
  return ps.map((p) => p.id);
}
