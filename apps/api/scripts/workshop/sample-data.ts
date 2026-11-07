// ─────────────────────────────────────────────────────────────────────────────
// Workshop sample dataset: the institution-specific files of an invented
// university, "Workshop Demo University", used by the workshop's sample track
// (docs/workshop/03-university-data.md).
//
// Everything here is made up. People are tokens ("Lecturer 001"), never
// names. No AI output and no public-connector data: participants compute
// those with the real pipeline and their own key.
//
// Rows are built by column KEY and mapped to headers through the import
// declarations, so a header renamed in a declaration flows through on the
// next `pnpm workshop:sample-data` instead of producing a file the importer
// refuses. Not part of the production build (apps/api/scripts is outside
// tsconfig.build's src tree).
// ─────────────────────────────────────────────────────────────────────────────

import { getImportDataset } from '@kku/db';
import * as XLSX from 'xlsx';

export type SampleCell = string | number | null;
export type SampleRow = Record<string, SampleCell>;

export const SAMPLE_UPLOAD_ORDER: readonly string[] = [
  'faculties',
  'departments',
  'programmes',
  'faculty-members',
  'program-faculty',
  'enrollment-metrics',
  'financial-metrics',
  'graduate-outcomes',
  'student-cohorts',
  'alumni-cohorts',
  'admission-campaigns',
  'research-outputs',
  'programme-courses',
];

/** The programme the workshop takes through the pipeline. */
export const WORKSHOP_PROGRAMME_CODE = 'WDU-CPE-BE';

export const UNIVERSITY = {
  nameEn: 'Workshop Demo University',
  nameTh: 'มหาวิทยาลัยสาธิตเวิร์กช็อป',
} as const;

const YEARS = [2021, 2022, 2023, 2024, 2025] as const;
const LAST_YEAR = 2025;

// ── deterministic noise ─────────────────────────────────────────────────────

/** Mulberry32 seeded from a string, so every dataset's numbers are stable. */
function rng(seed: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(r: () => number, lo: number, hi: number): number {
  return Math.round(lo + r() * (hi - lo));
}

// ── the organisation ────────────────────────────────────────────────────────

interface Programme {
  code: string;
  nameTh: string;
  nameEn: string;
  facultyCode: string;
  departmentCode: string;
  /** Size of an entering cohort, before noise. */
  intake: number;
  totalCredits: number;
  yearEstablished: number;
  tuitionPerStudent: number;
}

const FACULTIES = [
  { code: 'WDU-ENG', nameTh: 'คณะวิศวกรรมศาสตร์', nameEn: 'Faculty of Engineering' },
  { code: 'WDU-SCI', nameTh: 'คณะวิทยาศาสตร์', nameEn: 'Faculty of Science' },
] as const;

const DEPARTMENTS = [
  { code: 'WDU-ENG-CPE', nameTh: 'ภาควิชาวิศวกรรมคอมพิวเตอร์', nameEn: 'Department of Computer Engineering', facultyCode: 'WDU-ENG' },
  { code: 'WDU-ENG-ME', nameTh: 'ภาควิชาวิศวกรรมเครื่องกล', nameEn: 'Department of Mechanical Engineering', facultyCode: 'WDU-ENG' },
  { code: 'WDU-SCI-DS', nameTh: 'ภาควิชาวิทยาการข้อมูล', nameEn: 'Department of Data Science', facultyCode: 'WDU-SCI' },
] as const;

const PROGRAMMES: readonly Programme[] = [
  {
    code: WORKSHOP_PROGRAMME_CODE,
    nameTh: 'วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์',
    nameEn: 'Bachelor of Engineering in Computer Engineering',
    facultyCode: 'WDU-ENG',
    departmentCode: 'WDU-ENG-CPE',
    intake: 120,
    totalCredits: 141,
    yearEstablished: 2004,
    tuitionPerStudent: 42000,
  },
  {
    code: 'WDU-ME-BE',
    nameTh: 'วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเครื่องกล',
    nameEn: 'Bachelor of Engineering in Mechanical Engineering',
    facultyCode: 'WDU-ENG',
    departmentCode: 'WDU-ENG-ME',
    intake: 90,
    totalCredits: 144,
    yearEstablished: 1998,
    tuitionPerStudent: 42000,
  },
  {
    code: 'WDU-DS-BS',
    nameTh: 'วิทยาศาสตรบัณฑิต สาขาวิชาวิทยาการข้อมูล',
    nameEn: 'Bachelor of Science in Data Science',
    facultyCode: 'WDU-SCI',
    departmentCode: 'WDU-SCI-DS',
    intake: 60,
    totalCredits: 128,
    yearEstablished: 2019,
    tuitionPerStudent: 36000,
  },
];

const STAFF_PER_PROGRAMME = 12;
const RANKS = ['PROF', 'ASSOC_PROF', 'ASSOC_PROF', 'ASST_PROF', 'ASST_PROF', 'ASST_PROF'] as const;

interface StaffMember {
  employeeCode: string;
  n: number;
  programme: Programme;
  /** Position within the programme's team, 0-based. */
  slot: number;
}

function staff(): StaffMember[] {
  return PROGRAMMES.flatMap((programme, p) =>
    Array.from({ length: STAFF_PER_PROGRAMME }, (_, slot) => {
      const n = p * STAFF_PER_PROGRAMME + slot + 1;
      return { employeeCode: `WDU-S${String(n).padStart(3, '0')}`, n, programme, slot };
    }),
  );
}

// ── the workshop programme's course list ────────────────────────────────────

/** [code, Thai name, English name, credits, category label]. */
type Course = readonly [string, string, string, number, string];

const GE = 'General education';
const CORE = 'Core';
const REQ = 'Major required';
const ELEC = 'Major elective';
const PROJ = 'Thesis / project';

export const WORKSHOP_COURSES: readonly Course[] = [
  ['GEN 101', 'ภาษาไทยเพื่อการสื่อสาร', 'Thai for Communication', 3, GE],
  ['GEN 102', 'ภาษาอังกฤษเพื่อการสื่อสาร 1', 'English for Communication I', 3, GE],
  ['GEN 103', 'ภาษาอังกฤษเพื่อการสื่อสาร 2', 'English for Communication II', 3, GE],
  ['GEN 111', 'พลเมืองกับสังคม', 'Citizenship and Society', 3, GE],
  ['GEN 121', 'การคิดเชิงวิพากษ์', 'Critical Thinking', 3, GE],
  ['GEN 131', 'สุขภาวะและการใช้ชีวิต', 'Wellbeing and Living', 3, GE],
  ['GEN 141', 'ผู้ประกอบการและนวัตกรรม', 'Entrepreneurship and Innovation', 3, GE],
  ['MTH 101', 'แคลคูลัส 1', 'Calculus I', 3, CORE],
  ['MTH 102', 'แคลคูลัส 2', 'Calculus II', 3, CORE],
  ['MTH 201', 'คณิตศาสตร์ไม่ต่อเนื่อง', 'Discrete Mathematics', 3, CORE],
  ['MTH 202', 'ความน่าจะเป็นและสถิติ', 'Probability and Statistics', 3, CORE],
  ['PHY 101', 'ฟิสิกส์ทั่วไป 1', 'General Physics I', 3, CORE],
  ['PHY 102', 'ฟิสิกส์ทั่วไป 2', 'General Physics II', 3, CORE],
  ['ENG 101', 'การเขียนแบบวิศวกรรม', 'Engineering Drawing', 3, CORE],
  ['CPE 101', 'การเขียนโปรแกรมคอมพิวเตอร์', 'Computer Programming', 3, REQ],
  ['CPE 102', 'การเขียนโปรแกรมเชิงวัตถุ', 'Object-Oriented Programming', 3, REQ],
  ['CPE 201', 'โครงสร้างข้อมูลและอัลกอริทึม', 'Data Structures and Algorithms', 3, REQ],
  ['CPE 202', 'วงจรดิจิทัลและการออกแบบลอจิก', 'Digital Circuits and Logic Design', 3, REQ],
  ['CPE 203', 'สถาปัตยกรรมคอมพิวเตอร์', 'Computer Architecture', 3, REQ],
  ['CPE 204', 'ระบบฐานข้อมูล', 'Database Systems', 3, REQ],
  ['CPE 301', 'ระบบปฏิบัติการ', 'Operating Systems', 3, REQ],
  ['CPE 302', 'เครือข่ายคอมพิวเตอร์', 'Computer Networks', 3, REQ],
  ['CPE 303', 'วิศวกรรมซอฟต์แวร์', 'Software Engineering', 3, REQ],
  ['CPE 304', 'ระบบสมองกลฝังตัว', 'Embedded Systems', 3, REQ],
  ['CPE 305', 'ปัญญาประดิษฐ์เบื้องต้น', 'Introduction to Artificial Intelligence', 3, REQ],
  ['CPE 306', 'ความมั่นคงปลอดภัยของระบบคอมพิวเตอร์', 'Computer Security', 3, REQ],
  ['CPE 401', 'สหกิจศึกษา', 'Cooperative Education', 6, REQ],
  ['CPE 411', 'การเรียนรู้ของเครื่อง', 'Machine Learning', 3, ELEC],
  ['CPE 412', 'การประมวลผลภาพดิจิทัล', 'Digital Image Processing', 3, ELEC],
  ['CPE 413', 'การพัฒนาเว็บแอปพลิเคชัน', 'Web Application Development', 3, ELEC],
  ['CPE 414', 'การพัฒนาแอปพลิเคชันบนอุปกรณ์เคลื่อนที่', 'Mobile Application Development', 3, ELEC],
  ['CPE 415', 'การประมวลผลแบบคลาวด์', 'Cloud Computing', 3, ELEC],
  ['CPE 416', 'อินเทอร์เน็ตของสรรพสิ่ง', 'Internet of Things', 3, ELEC],
  ['CPE 417', 'การประมวลผลภาษาธรรมชาติ', 'Natural Language Processing', 3, ELEC],
  ['CPE 418', 'วิทยาการหุ่นยนต์', 'Robotics', 3, ELEC],
  ['CPE 419', 'การวิเคราะห์ข้อมูลขนาดใหญ่', 'Big Data Analytics', 3, ELEC],
  ['CPE 491', 'โครงงานวิศวกรรมคอมพิวเตอร์ 1', 'Computer Engineering Project I', 1, PROJ],
  ['CPE 492', 'โครงงานวิศวกรรมคอมพิวเตอร์ 2', 'Computer Engineering Project II', 3, PROJ],
];

// ── row builders, by column key ─────────────────────────────────────────────

type KeyedRow = Record<string, SampleCell>;

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function enrolment(p: Programme, year: number) {
  const r = rng(`enrol:${p.code}:${year}`);
  const enrolled = p.intake + between(r, -12, 10);
  const admitted = enrolled + between(r, 5, 25);
  const applications = admitted * between(r, 3, 6);
  return { applications, admitted, enrolled };
}

const BUILDERS: Record<string, () => KeyedRow[]> = {
  faculties: () => FACULTIES.map((f) => ({ ...f, kind: 'ACADEMIC', sfrBand: 'Lab-based' })),

  departments: () => DEPARTMENTS.map((d) => ({ ...d })),

  programmes: () =>
    PROGRAMMES.map((p) => ({
      code: p.code,
      nameTh: p.nameTh,
      nameEn: p.nameEn,
      facultyCode: p.facultyCode,
      departmentCode: p.departmentCode,
      level: 'BACHELOR',
      status: 'ACTIVE',
      yearEstablished: p.yearEstablished,
      durationYears: 4,
      totalCredits: p.totalCredits,
      mhesiCode: null,
    })),

  'faculty-members': () =>
    staff().map((s) => {
      const r = rng(`staff:${s.employeeCode}`);
      const hireYear = 2026 - between(r, 3, 30);
      const retireYear = s.slot < 2 ? LAST_YEAR + between(r, 1, 4) : LAST_YEAR + between(r, 6, 28);
      return {
        employeeCode: s.employeeCode,
        nameTh: `อาจารย์ ${String(s.n).padStart(3, '0')}`,
        nameEn: `Lecturer ${String(s.n).padStart(3, '0')}`,
        facultyCode: s.programme.facultyCode,
        departmentCode: s.programme.departmentCode,
        rank: RANKS[s.slot] ?? 'LECTURER',
        academicQualification: s.slot < 10 ? 'PhD' : 'Master',
        specialization: null,
        hireDate: iso(hireYear, 6, 1),
        retirementDate: iso(retireYear, 9, 30),
        isActive: 'yes',
      };
    }),

  'program-faculty': () =>
    staff().map((s) => ({
      programmeCode: s.programme.code,
      employeeCode: s.employeeCode,
      role: s.slot === 0 ? 'COORDINATOR' : s.slot < 5 ? 'CORE' : 'SUPPORT',
      curriculumYear: 2023,
    })),

  'enrollment-metrics': () =>
    PROGRAMMES.flatMap((p) =>
      YEARS.map((year) => {
        const r = rng(`enrol-detail:${p.code}:${year}`);
        const { applications, admitted, enrolled } = enrolment(p, year);
        // Cohorts that entered four or more years before LAST_YEAR have graduated.
        const graduated = year + 4 <= LAST_YEAR;
        return {
          programmeCode: p.code,
          academicYear: year,
          applications,
          admitted,
          enrolled,
          retainedYear2: year < LAST_YEAR ? Math.round(enrolled * (0.86 + r() * 0.08)) : null,
          graduatedOnTime: graduated ? Math.round(enrolled * (0.62 + r() * 0.12)) : null,
          graduatedLate: graduated ? Math.round(enrolled * (0.08 + r() * 0.06)) : null,
          dropouts: Math.round(enrolled * (0.04 + r() * 0.08)),
        };
      }),
    ),

  'financial-metrics': () =>
    PROGRAMMES.flatMap((p) =>
      YEARS.map((year) => {
        const r = rng(`finance:${p.code}:${year}`);
        const students = p.intake * 4 + between(r, -30, 30);
        return {
          programmeCode: p.code,
          academicYear: year,
          tuitionRevenue: students * p.tuitionPerStudent,
          otherRevenue: between(r, 400, 2400) * 1000,
        };
      }),
    ),

  'graduate-outcomes': () =>
    PROGRAMMES.flatMap((p) =>
      [2021, 2022, 2023, 2024].map((year) => {
        const r = rng(`outcomes:${p.code}:${year}`);
        return {
          programmeCode: p.code,
          graduationYear: year,
          surveyYear: year + 1,
          employmentRate: Number((0.78 + r() * 0.17).toFixed(2)),
          averageSalary: between(r, 20, 32) * 1000,
          jobRelevanceScore: Number((0.65 + r() * 0.25).toFixed(2)),
          furtherStudyRate: Number((0.03 + r() * 0.09).toFixed(2)),
          sampleSize: between(r, 35, 90),
        };
      }),
    ),

  'student-cohorts': () =>
    PROGRAMMES.flatMap((p) =>
      [2022, 2023, 2024, 2025].map((year) => {
        const r = rng(`cohort:${p.code}:${year}`);
        const { enrolled } = enrolment(p, year);
        const yearsIn = LAST_YEAR - year;
        return {
          programmeCode: p.code,
          entryYear: year,
          studentCount: Math.round(enrolled * (1 - yearsIn * (0.04 + r() * 0.02))),
        };
      }),
    ),

  'alumni-cohorts': () =>
    PROGRAMMES.flatMap((p) =>
      [2017, 2018, 2019, 2020, 2021].flatMap((year) => {
        const r = rng(`alumni:${p.code}:${year}`);
        const size = p.intake + between(r, -10, 10);
        const academic = between(r, 4, 12);
        const voluntary = between(r, 2, 8);
        const transferred = between(r, 1, 5);
        return [
          { statusBucket: 'GRADUATED', count: size - academic - voluntary - transferred },
          { statusBucket: 'DROPPED_ACADEMIC', count: academic },
          { statusBucket: 'DROPPED_VOLUNTARY', count: voluntary },
          { statusBucket: 'TRANSFERRED', count: transferred },
        ].map((b) => ({ programmeCode: p.code, entryYear: year, ...b }));
      }),
    ),

  'admission-campaigns': () =>
    PROGRAMMES.flatMap((p) =>
      YEARS.flatMap((year) => {
        const { applications, enrolled } = enrolment(p, year);
        const rounds = [
          { round: 'Round 1 — Portfolio', share: 0.4 },
          { round: 'Round 3 — Admission', share: 0.6 },
        ];
        return rounds.map(({ round, share }) => {
          const r = rng(`campaign:${p.code}:${year}:${round}`);
          const plan = Math.round(p.intake * share);
          const reported = Math.round(enrolled * share);
          const passed = reported + between(r, 10, 40);
          return {
            programmeCode: p.code,
            academicYear: year,
            round,
            campaignName: `${p.nameEn}, regular programme`,
            planPerYear: plan,
            totalApplicants: Math.round(applications * share),
            totalPassed: passed,
            confirmClearinghouse: reported + between(r, 0, 8),
            regReported: reported,
          };
        });
      }),
    ),

  'research-outputs': () => {
    const topics = [
      'Lightweight intrusion detection for campus networks',
      'Energy-aware scheduling on edge devices',
      'A dataset of Thai-language course descriptions',
      'Low-cost sensors for air-quality monitoring',
      'Graph methods for timetable conflicts',
      'Teaching programming with automated feedback',
      'Fatigue prediction in welded joints',
      'Thermal comfort in naturally ventilated classrooms',
      'Forecasting student demand from admission records',
      'Explainable models for dropout risk',
    ];
    const venues = ['Journal of Applied Computing', 'Engineering Letters', 'Proceedings of the Regional Computing Conference'];
    return staff()
      .filter((s) => s.slot < 7)
      .flatMap((s) => {
        const r = rng(`research:${s.employeeCode}`);
        const count = between(r, 1, 3);
        return Array.from({ length: count }, (_, i) => {
          const conference = r() < 0.35;
          return {
            employeeCode: s.employeeCode,
            year: between(r, 2020, LAST_YEAR),
            type: conference ? 'CONFERENCE' : 'JOURNAL',
            title: `${topics[(s.n + i * 3) % topics.length] ?? 'Untitled'} (study ${s.n}.${i + 1})`,
            venue: venues[conference ? 2 : (s.n + i) % 2] ?? null,
            citations: between(r, 0, 40),
            doi: null,
          };
        });
      });
  },

  'programme-courses': () =>
    WORKSHOP_COURSES.map(([courseCode, courseNameTh, courseNameEn, credits, category]) => ({
      programmeCode: WORKSHOP_PROGRAMME_CODE,
      courseCode,
      courseNameTh,
      courseNameEn,
      credits,
      category,
    })),
};

// ── public surface ──────────────────────────────────────────────────────────

/** The sample rows for one dataset, keyed by the declaration's header text. */
export function buildSampleRows(slug: string): readonly SampleRow[] {
  const build = BUILDERS[slug];
  if (!build) throw new Error(`No workshop sample data for dataset "${slug}"`);
  const dataset = getImportDataset(slug);
  return build().map((row) => {
    const out: SampleRow = {};
    for (const col of dataset.columns) {
      const value = row[col.key];
      if (value === undefined) throw new Error(`${slug}: sample row has no value for column "${col.key}"`);
      out[col.header] = value;
    }
    for (const key of Object.keys(row)) {
      if (!dataset.columns.some((c) => c.key === key)) {
        throw new Error(`${slug}: sample row has "${key}", which the declaration does not have`);
      }
    }
    return out;
  });
}

export function sampleFilename(slug: string): string {
  const index = SAMPLE_UPLOAD_ORDER.indexOf(slug);
  if (index < 0) throw new Error(`"${slug}" is not in the workshop upload order`);
  return `${String(index + 1).padStart(2, '0')}-${slug}.xlsx`;
}

/** One sheet named as the importer expects, header row then data rows. */
export function buildSampleWorkbook(slug: string): Buffer {
  const dataset = getImportDataset(slug);
  const headers = dataset.columns.map((c) => c.header);
  const rows = buildSampleRows(slug).map((row) => headers.map((h) => row[h] ?? null));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), dataset.sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
