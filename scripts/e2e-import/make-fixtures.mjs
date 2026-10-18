// Generates mocked workbooks for the end-to-end import check.
//
// Deliberately NOT built from the app's own template writer: these stand in
// for what an adopting university would hand us, so they are written from the
// column headers alone. If the template and the validator ever disagree, a
// file built this way is what catches it.
import * as XLSX from 'xlsx';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = process.env.IMPORT_E2E_FIXTURES ?? new URL('./fixtures/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

function write(name, sheetName, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  const file = path.join(OUT, name);
  writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  console.log(`${name}  ${sheetName}  ${rows.length - 1} row(s)`);
}

// ── happy path ──────────────────────────────────────────────────────────────
write('01-faculties.xlsx', 'Faculties', [
  ['Faculty Code', 'Name (Thai)', 'Name (English)', 'Kind'],
  ['NU-ENG', 'คณะวิศวกรรมศาสตร์', 'Faculty of Engineering', 'ACADEMIC'],
  ['NU-SCI', 'คณะวิทยาศาสตร์', 'Faculty of Science', null],
  ['NU-RES', 'สถาบันวิจัย', 'Research Institute', 'RESEARCH_CENTER'],
]);

write('02-departments.xlsx', 'Departments', [
  ['Department Code', 'Name (Thai)', 'Name (English)', 'Faculty Code'],
  ['NU-ENG-CIV', 'สาขาวิชาวิศวกรรมโยธา', 'Civil Engineering', 'NU-ENG'],
  ['NU-ENG-EE', 'สาขาวิชาวิศวกรรมไฟฟ้า', 'Electrical Engineering', 'NU-ENG'],
]);

write('03-programmes.xlsx', 'Programmes', [
  ['Programme Code', 'Name (Thai)', 'Name (English)', 'Faculty Code',
   'Department Code', 'Level', 'Status', 'Year Established',
   'Duration (years)', 'Total Credits', 'Official Code'],
  ['NU-CIV-BE', 'วศ.บ. วิศวกรรมโยธา', 'B.Eng. Civil Engineering', 'NU-ENG',
   'NU-ENG-CIV', 'BACHELOR', null, 2015, 4, 140, '25501011100123'],
  ['NU-EE-BE', 'วศ.บ. วิศวกรรมไฟฟ้า', 'B.Eng. Electrical Engineering', 'NU-ENG',
   'NU-ENG-EE', 'BACHELOR', 'ACTIVE', 2016, 4, 142, null],
  ['NU-CIV-ME', 'วศ.ม. วิศวกรรมโยธา', 'M.Eng. Civil Engineering', 'NU-ENG',
   null, 'MASTER', null, 2018, 2, 36, null],
]);

// Tier 1 — the metrics the Deep-Dive is built from. Every one of these
// refers to a programme code loaded above.
write('05-enrolment.xlsx', 'Enrolment', [
  ['Programme Code', 'Academic Year', 'Applications', 'Admitted', 'Enrolled',
   'Retained to Year 2', 'Graduated on Time', 'Graduated Late', 'Dropouts'],
  ['NU-CIV-BE', 2023, 520, 180, 142, 131, 118, 9, 12],
  ['NU-CIV-BE', 2024, 486, 175, 138, null, null, null, null],
  ['NU-EE-BE', 2024, 610, 200, 171, null, null, null, null],
]);

write('06-finance.xlsx', 'Finance', [
  ['Programme Code', 'Academic Year', 'Tuition Revenue (THB)', 'Other Revenue (THB)'],
  ['NU-CIV-BE', 2023, '5,680,000', 120000],
  ['NU-CIV-BE', 2024, 5520000, null],
  ['NU-EE-BE', 2024, 6840000, 90000],
]);

write('07-outcomes.xlsx', 'Graduate Outcomes', [
  ['Programme Code', 'Graduation Year', 'Survey Year', 'Employment Rate',
   'Average Salary (THB/month)', 'Job Relevance Score', 'Further Study Rate', 'Sample Size'],
  ['NU-CIV-BE', 2022, 2023, 0.87, 24500, 0.81, 0.09, 96],
  // The same cohort surveyed a year later: a second row, not a correction.
  ['NU-CIV-BE', 2022, 2024, 0.92, 27800, 0.84, 0.06, 88],
]);

// ── files that must be REFUSED, one rule each ───────────────────────────────

// An extra column — the primary privacy defence.
write('bad-unknown-column.xlsx', 'Faculties', [
  ['Faculty Code', 'Name (Thai)', 'Name (English)', 'Kind', 'Citizen ID'],
  ['NU-BAD', 'คณะทดสอบ', 'Test Faculty', 'ACADEMIC', '1101700207366'],
]);

// A national ID in a normal column. Synthetic: an arbitrary 12-digit prefix
// with its mod-11 check digit computed.
write('bad-national-id.xlsx', 'Faculties', [
  ['Faculty Code', 'Name (Thai)', 'Name (English)', 'Kind'],
  ['NU-BAD2', '1101700207366', 'Test Faculty', 'ACADEMIC'],
]);

// A required cell left blank, plus a value outside the enum.
write('bad-cells.xlsx', 'Faculties', [
  ['Faculty Code', 'Name (Thai)', 'Name (English)', 'Kind'],
  [null, 'คณะหนึ่ง', 'One', 'ACADEMIC'],
  ['NU-OK', 'คณะสอง', 'Two', 'COLLEGE'],
]);

// A programme pointing at a faculty that does not exist.
write('bad-reference.xlsx', 'Programmes', [
  ['Programme Code', 'Name (Thai)', 'Name (English)', 'Faculty Code',
   'Department Code', 'Level', 'Status', 'Year Established',
   'Duration (years)', 'Total Credits', 'Official Code'],
  ['NU-ORPHAN', 'ทดสอบ', 'Orphan', 'NU-NOPE', null, 'BACHELOR', null, null, null, null, null],
]);

// A Buddhist-era year. It clears every "is this a plausible number" test,
// and the figures then sit on a year no surface will ever ask for.
write('bad-buddhist-year.xlsx', 'Enrolment', [
  ['Programme Code', 'Academic Year', 'Applications', 'Admitted', 'Enrolled',
   'Retained to Year 2', 'Graduated on Time', 'Graduated Late', 'Dropouts'],
  ['NU-CIV-BE', 2568, 500, 180, 140, null, null, null, null],
]);

// A rate written as a percentage. 87 and 0.87 are both plausible numbers;
// one of them reports 8700 % employment.
write('bad-percentage-rate.xlsx', 'Graduate Outcomes', [
  ['Programme Code', 'Graduation Year', 'Survey Year', 'Employment Rate',
   'Average Salary (THB/month)', 'Job Relevance Score', 'Further Study Rate', 'Sample Size'],
  ['NU-CIV-BE', 2022, 2025, 87, 24500, 0.81, 0.09, 96],
]);

// Two headers differing only by a trailing space — silently merged before.
write('bad-dup-header.xlsx', 'Faculties', [
  ['Faculty Code', 'Faculty Code ', 'Name (Thai)', 'Name (English)', 'Kind'],
  ['right', 'wrong', 'คณะ', 'Faculty', 'ACADEMIC'],
]);

// ── awkward but VALID: the Excel-ism cases ──────────────────────────────────
// Blank rows between data, a numeric code, and a trailing stray note column.
const awkward = [
  ['Faculty Code', 'Name (Thai)', 'Name (English)', 'Kind', null],
  [NaN, null, null, null, null],
  ['007', 'คณะเลขศูนย์', 'Leading Zeros', 'ACADEMIC', null],
  [null, null, null, null, null],
  [12345, 'คณะตัวเลข', 'Numeric Code', null, null],
];
awkward[1] = [null, null, null, null, null];
write('04-awkward-but-valid.xlsx', 'Faculties', awkward);
