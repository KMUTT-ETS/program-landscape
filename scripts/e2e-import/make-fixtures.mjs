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

// Tier 2 — staff, money, publications and the timetable.
write('08-staff.xlsx', 'Staff', [
  ['Employee Code', 'Name (Thai)', 'Name (English)', 'Faculty Code', 'Department Code',
   'Rank', 'Academic Qualification', 'Specialization', 'Hire Date', 'Retirement Date', 'Active'],
  ['NU-EMP-001', 'สมชาย ใจดี', 'Somchai Jaidee', 'NU-ENG', 'NU-ENG-CIV',
   'ASSOC_PROF', 'PhD Civil Engineering', 'Structural engineering', '2012-06-01', '2038-09-30', 'yes'],
  ['NU-EMP-002', 'สมหญิง เก่งมาก', 'Somying Kengmak', 'NU-ENG', 'NU-ENG-EE',
   'LECTURER', 'MEng Electrical', null, '2019-08-15', null, null],
]);

write('09-compensation.xlsx', 'Compensation', [
  ['Faculty Code', 'Department Code', 'Rank', 'Fiscal Year', 'Headcount',
   'Total Salary (THB)', 'Mean Salary (THB)', 'Min Salary (THB)', 'Max Salary (THB)'],
  ['NU-ENG', null, 'ASSOC_PROF', 2024, 11, 9900000, 900000, 760000, 1150000],
  ['NU-ENG', 'NU-ENG-CIV', 'LECTURER', 2024, 7, 4550000, 650000, 540000, 790000],
]);

write('10-budgets.xlsx', 'Budgets', [
  ['Division Name', 'Faculty Code', 'Fund Category', 'Fiscal Year', 'Total Budget (THB)',
   'Total Commitment (THB)', 'Total Obligation (THB)', 'Total Expenditure (THB)', 'Funds Available (THB)'],
  ['Faculty of Engineering', 'NU-ENG', 'University revenue', 2024, 42000000, null, null, 31000000, null],
  // A division that is not a faculty at all — the faculty link is optional.
  ["President's Office", null, 'Government subsidy', 2024, 18000000, null, null, null, null],
]);

write('11-publications.xlsx', 'Publications', [
  ['Employee Code', 'Year', 'Type', 'Title', 'Venue', 'Citations', 'DOI'],
  ['NU-EMP-001', 2023, 'JOURNAL', 'Fatigue in welded steel connections',
   'Journal of Structural Engineering', 19, '10.1234/jse.2023.0042'],
  // Same paper, second author: two rows, not one.
  ['NU-EMP-002', 2023, 'JOURNAL', 'Fatigue in welded steel connections',
   'Journal of Structural Engineering', 19, '10.1234/jse.2023.0042'],
  ['NU-EMP-002', 2022, 'CONFERENCE', 'Grid stability under high solar penetration', null, null, null],
]);

write('12-campaigns.xlsx', 'Admission Campaigns', [
  ['Programme Code', 'Academic Year', 'Round', 'Campaign Name',
   'Planned Seats', 'Total Applicants', 'Total Passed', 'Confirmed', 'Reported'],
  ['NU-CIV-BE', 2024, 'Round 1 — Portfolio', 'Civil Engineering, regular', 60, 480, 95, 70, 62],
  ['NU-CIV-BE', 2024, 'Round 3 — Admission', 'Civil Engineering, regular', 40, 820, 120, 55, 48],
]);

// Two sections of one course. The drive uploads this, then a shorter file
// for the same term, to prove the term is replaced rather than merged.
write('13-classes-term1.xlsx', 'Class Offerings', [
  ['Academic Year', 'Semester', 'Faculty Code', 'Level', 'Course Code', 'Section', 'Class Id',
   'Course Name (Thai)', 'Course Name (English)', 'Credits', 'Lecture Hours/Week', 'Lab Hours/Week',
   'Enrolled', 'Total Seats', 'Grade A', 'Grade B+', 'Grade B', 'Grade C+', 'Grade C',
   'Grade D+', 'Grade D', 'Grade F', 'Incomplete', 'Withdrawn', 'Audit', 'Satisfactory'],
  [2024, 1, 'NU-ENG', 'Bachelor', 'NU-EN101', 1, null, 'กลศาสตร์', 'Mechanics', 3, 3, 0,
   48, 60, 12, 9, 10, 6, 5, 3, 2, 1, 0, 0, 0, 0],
  [2024, 1, 'NU-ENG', 'Bachelor', 'NU-EN101', 2, null, 'กลศาสตร์', 'Mechanics', 3, 3, 0,
   41, 60, 8, 7, 11, 7, 4, 2, 1, 1, 0, 0, 0, 0],
]);

write('14-classes-term1-cancelled.xlsx', 'Class Offerings', [
  ['Academic Year', 'Semester', 'Faculty Code', 'Level', 'Course Code', 'Section', 'Class Id',
   'Course Name (Thai)', 'Course Name (English)', 'Credits', 'Lecture Hours/Week', 'Lab Hours/Week',
   'Enrolled', 'Total Seats', 'Grade A', 'Grade B+', 'Grade B', 'Grade C+', 'Grade C',
   'Grade D+', 'Grade D', 'Grade F', 'Incomplete', 'Withdrawn', 'Audit', 'Satisfactory'],
  [2024, 1, 'NU-ENG', 'Bachelor', 'NU-EN101', 1, null, 'กลศาสตร์', 'Mechanics', 3, 3, 0,
   49, 60, 13, 9, 10, 6, 5, 3, 2, 1, 0, 0, 0, 0],
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

// A compensation row covering three people. The group-size floor exists
// because an average over three is close enough to an individual salary.
write('bad-small-group.xlsx', 'Compensation', [
  ['Faculty Code', 'Department Code', 'Rank', 'Fiscal Year', 'Headcount',
   'Total Salary (THB)', 'Mean Salary (THB)', 'Min Salary (THB)', 'Max Salary (THB)'],
  ['NU-ENG', null, 'PROF', 2024, 3, 3600000, 1200000, 1100000, 1300000],
]);

// A class-offerings file covering two terms. Loading it would delete one
// term and insert both.
write('bad-mixed-term.xlsx', 'Class Offerings', [
  ['Academic Year', 'Semester', 'Faculty Code', 'Level', 'Course Code', 'Section', 'Class Id',
   'Course Name (Thai)', 'Course Name (English)', 'Credits', 'Lecture Hours/Week', 'Lab Hours/Week',
   'Enrolled', 'Total Seats', 'Grade A', 'Grade B+', 'Grade B', 'Grade C+', 'Grade C',
   'Grade D+', 'Grade D', 'Grade F', 'Incomplete', 'Withdrawn', 'Audit', 'Satisfactory'],
  [2024, 1, 'NU-ENG', 'Bachelor', 'NU-EN202', 1, null, null, 'Thermo', 3, 3, 0,
   30, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2024, 2, 'NU-ENG', 'Bachelor', 'NU-EN202', 1, null, null, 'Thermo', 3, 3, 0,
   28, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
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
