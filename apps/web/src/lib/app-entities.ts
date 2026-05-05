import { prisma } from '@kku/db';
import type { ScopeSelectorEntities } from '@kku/ui';

// Server-only fetcher for the scope picker + command palette. Called in
// the root layout so every page inherits the same entity list.

export async function fetchScopeEntities(): Promise<ScopeSelectorEntities> {
  const [faculties, departments, programs] = await Promise.all([
    prisma.faculty.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameEn: true, nameTh: true },
    }),
    prisma.department.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameTh: true,
        faculty: { select: { code: true } },
      },
    }),
    prisma.program.findMany({
      // Scope selector + command palette show the canonical 297 only.
      // Legacy mock-seed Program rows still exist for staff/student
      // joins but should not be navigation targets.
      where: { sequenceNoFromSheet: { not: null } },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameTh: true,
        department: { select: { code: true } },
      },
    }),
  ]);

  return {
    faculties: faculties.map((f) => ({
      id: f.id,
      code: f.code,
      nameEn: f.nameEn,
      nameTh: f.nameTh,
    })),
    departments: departments.map((d) => ({
      id: d.id,
      code: d.code,
      nameEn: d.nameEn,
      nameTh: d.nameTh,
      parentCode: d.faculty.code,
    })),
    programs: programs.map((p) => ({
      id: p.id,
      code: p.code,
      nameEn: p.nameEn,
      nameTh: p.nameTh,
      parentCode: p.department?.code ?? undefined,
    })),
  };
}
