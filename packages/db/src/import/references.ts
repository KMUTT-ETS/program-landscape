import { prisma } from '../index';
import type { ImportDataset } from './types';

/** Resolves the key values each referenced dataset currently holds. */
export async function loadImportReferences(dataset: ImportDataset): Promise<Map<string, Set<string>>> {
  const references = new Map<string, Set<string>>();
  const slugs = [...new Set(dataset.columns.flatMap((c) => (c.references ? [c.references.dataset] : [])))];

  for (const slug of slugs) {
    // Tier 0 references are always a `code` column; a later tier that
    // references something else adds its own branch here.
    if (slug === 'faculties') {
      const rows = await prisma.faculty.findMany({ select: { code: true } });
      references.set(slug, new Set(rows.map((r) => r.code)));
    } else if (slug === 'departments') {
      const rows = await prisma.department.findMany({ select: { code: true } });
      references.set(slug, new Set(rows.map((r) => r.code)));
    } else if (slug === 'programmes') {
      const rows = await prisma.program.findMany({ select: { code: true } });
      references.set(slug, new Set(rows.map((r) => r.code)));
    } else if (slug === 'faculty-members') {
      // The first reference that is not a `code` column: staff are named
      // by the employer-assigned code the adopter chose.
      const rows = await prisma.facultyMember.findMany({ select: { employeeCode: true } });
      references.set(slug, new Set(rows.map((r) => r.employeeCode)));
    } else if (slug === 'external-grants') {
      // Imported projects only: the connector's projects are not addressable
      // by an adopter's code. Stored as `xlsx:<code>`.
      const rows = await prisma.researchServiceProject.findMany({
        where: { sourceProposalKey: { startsWith: 'xlsx:' } },
        select: { sourceProposalKey: true },
      });
      references.set(slug, new Set(rows.map((r) => r.sourceProposalKey.slice('xlsx:'.length))));
    }
  }
  return references;
}
