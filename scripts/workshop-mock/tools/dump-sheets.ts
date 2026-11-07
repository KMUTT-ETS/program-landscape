// Prints the SHEETS literal of scripts/workshop-mock/wsmock/datasets.py.
// Run from the repo root:
//   pnpm --filter api exec tsx ../../scripts/workshop-mock/tools/dump-sheets.ts
import { getImportDataset } from '@kku/db';

const ORDER = [
  'faculties', 'departments', 'programmes', 'faculty-members', 'program-faculty',
  'programme-courses', 'research-outputs', 'admission-campaigns', 'enrollment-metrics',
  'student-cohorts', 'alumni-cohorts', 'financial-metrics', 'faculty-budgets',
  'graduate-outcomes', 'employer-feedback', 'digital-competency-cohorts',
  'digital-competency-modules', 'course-evaluations', 'population-projections',
  'career-skill-demand',
];
const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const lines = ['SHEETS: dict[str, tuple[str, list[str]]] = {'];
for (const slug of ORDER) {
  const d = getImportDataset(slug);
  lines.push(`    ${q(slug)}: (`, `        ${q(d.sheetName)},`, '        [');
  for (const c of d.columns) lines.push(`            ${q(c.header)},`);
  lines.push('        ],', '    ),');
}
lines.push('}');
console.log(lines.join('\n'));
