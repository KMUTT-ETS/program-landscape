// Removes everything the e2e drive creates, so a run always starts clean.
// Scoped to the NU-* codes the fixtures use plus the import batches for the
// datasets the drive touches — nothing else is touched.
//
// The metric rows are not deleted by code here: every foreign key into
// `programs` cascades, so deleting the programmes above takes them with it.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const SLUGS = [
  'faculties',
  'departments',
  'programmes',
  'enrollment-metrics',
  'financial-metrics',
  'graduate-outcomes',
];
const PROGRAMME_CODES = ['NU-CIV-BE', 'NU-EE-BE', 'NU-CIV-ME'];
const DEPARTMENT_CODES = ['NU-ENG-CIV', 'NU-ENG-EE'];
const FACULTY_CODES = ['NU-ENG', 'NU-SCI', 'NU-RES', '007', '12345'];

const removed = {
  programmes: (await prisma.program.deleteMany({ where: { code: { in: PROGRAMME_CODES } } })).count,
  departments: (await prisma.department.deleteMany({ where: { code: { in: DEPARTMENT_CODES } } })).count,
  faculties: (await prisma.faculty.deleteMany({ where: { code: { in: FACULTY_CODES } } })).count,
  batches: (await prisma.importBatch.deleteMany({ where: { datasetSlug: { in: SLUGS } } })).count,
};

// The runs are what start-over scopes by; leaving them would make the next
// clear report rows it did not write.
removed.runs = (
  await prisma.ingestionRun.deleteMany({
    where: { dataSource: { slug: { in: SLUGS.map((s) => `xlsx-${s}`) } } },
  })
).count;

console.log(JSON.stringify(removed));
await prisma.$disconnect();
