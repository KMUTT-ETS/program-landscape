import {
  CourseType,
  CurriculumStatus,
  DataSourceKind,
  FacultyRank,
  PdfLanguage,
  PdfProcessingStatus,
  PdfSourceCategory,
  Prisma,
  PrismaClient,
  ProgramLevel,
  ProgramStatus,
  SkillSource,
  SkillTaxonomy,
  UserRole,
} from '@prisma/client';

const prisma = new PrismaClient();

// ──────────────────────────────────────────────────────────────────────────
// Deterministic PRNG — keeps seed runs reproducible across machines/CI.
// ──────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260422);
const randInt = (min: number, max: number) =>
  Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

// ──────────────────────────────────────────────────────────────────────────
// Mock-data gate. Default: OFF — seed only real reference/structural data
// (faculties, departments, programs from sheet, skill taxonomy, sectors,
// demographic projections, data-source catalog, KKU SSO mappings).
//
// Set SEED_MOCKS=true to additionally seed sample/demo content:
//   • mock job postings + job_posting_skills
//   • 29 sample trend signals
//   • 4 scenario templates
//   • 12 peer programs + 3 peer sets + rankings
//   • 3 sample council decisions + milestones + outcome reviews
//   • 192 mock occupation_demand rows
//   • 9 synthetic forecast back-tests
//
// Production / Council-facing environments should keep this OFF so analyses
// reflect ONLY data flowing from real connectors (kku-registry, kku-hr,
// kku-finance, kku-research, kmitl-skill-mapping) + the curated workflow.
// ──────────────────────────────────────────────────────────────────────────
const SEED_MOCKS = process.env.SEED_MOCKS === 'true';

// ──────────────────────────────────────────────────────────────────────────
// 1. Faculties (24) and Departments (12)
//
// All 24 academic units of KKU. The Thai names match exactly the
// `Alias_Default` (after stripping the "BUcode - " prefix) seen in
// epm_report.dbo.Faculty during the kku-hr discovery, so the
// kku-hr seed-mappings auto-mapper resolves all 24 BU1 codes (vs
// the original 5) and the kku-finance DIVISION_NAME → facultyId
// resolution maps the 24 corresponding budget divisions.
//
// The 6 KKU central-admin units (Office of President, Library,
// Office of Digital Technology, Office of Academic Services, Office
// of the University Council, Office of Academic Administration) are
// deliberately NOT seeded as Faculties — they don't host academic
// programs, and the kku-finance connector is happy to land them as
// FacultyBudget rows with `facultyId = null` for transparency.
// Graduate School (บัณฑิตวิทยาลัย, BU1 = 10000) is seeded as a
// Faculty even though it doesn't run undergraduate programs — it
// has academic staff + a budget line, and our schema's "Faculty" is
// the natural home for any academic unit.
// ──────────────────────────────────────────────────────────────────────────

const FACULTIES = [
  // Original 5 (existed before the prompt-14 expansion)
  { code: 'EN',   nameTh: 'คณะวิศวกรรมศาสตร์',                    nameEn: 'Faculty of Engineering',                          kind: 'ACADEMIC' as const },
  { code: 'SC',   nameTh: 'คณะวิทยาศาสตร์',                       nameEn: 'Faculty of Science',                              kind: 'ACADEMIC' as const },
  { code: 'MD',   nameTh: 'คณะแพทยศาสตร์',                        nameEn: 'Faculty of Medicine',                             kind: 'ACADEMIC' as const },
  { code: 'HU',   nameTh: 'คณะมนุษยศาสตร์และสังคมศาสตร์',           nameEn: 'Faculty of Humanities and Social Sciences',       kind: 'ACADEMIC' as const },
  { code: 'BS',   nameTh: 'คณะบริหารธุรกิจและการบัญชี',             nameEn: 'Faculty of Business Administration and Accountancy', kind: 'ACADEMIC' as const },
  // 19 added 2026-04-28 to lift kku-hr / kku-finance / kku-research coverage
  { code: 'AG',   nameTh: 'คณะเกษตรศาสตร์',                        nameEn: 'Faculty of Agriculture',                          kind: 'ACADEMIC' as const },
  { code: 'ED',   nameTh: 'คณะศึกษาศาสตร์',                        nameEn: 'Faculty of Education',                            kind: 'ACADEMIC' as const },
  { code: 'NU',   nameTh: 'คณะพยาบาลศาสตร์',                       nameEn: 'Faculty of Nursing',                              kind: 'ACADEMIC' as const },
  { code: 'AMS',  nameTh: 'คณะเทคนิคการแพทย์',                     nameEn: 'Faculty of Associated Medical Sciences',          kind: 'ACADEMIC' as const },
  { code: 'GS',   nameTh: 'บัณฑิตวิทยาลัย',                         nameEn: 'Graduate School',                                 kind: 'ACADEMIC' as const },
  { code: 'PH',   nameTh: 'คณะสาธารณสุขศาสตร์',                    nameEn: 'Faculty of Public Health',                        kind: 'ACADEMIC' as const },
  { code: 'DT',   nameTh: 'คณะทันตแพทยศาสตร์',                     nameEn: 'Faculty of Dentistry',                            kind: 'ACADEMIC' as const },
  { code: 'MBA',  nameTh: 'วิทยาลัยบัณฑิตศึกษาการจัดการ',           nameEn: 'College of Graduate Study in Management',         kind: 'ACADEMIC' as const },
  { code: 'PHA',  nameTh: 'คณะเภสัชศาสตร์',                        nameEn: 'Faculty of Pharmaceutical Sciences',              kind: 'ACADEMIC' as const },
  { code: 'TC',   nameTh: 'คณะเทคโนโลยี',                          nameEn: 'Faculty of Technology',                           kind: 'ACADEMIC' as const },
  { code: 'VM',   nameTh: 'คณะสัตวแพทยศาสตร์',                     nameEn: 'Faculty of Veterinary Medicine',                  kind: 'ACADEMIC' as const },
  { code: 'AR',   nameTh: 'คณะสถาปัตยกรรมศาสตร์',                  nameEn: 'Faculty of Architecture',                         kind: 'ACADEMIC' as const },
  { code: 'FAR',  nameTh: 'คณะศิลปกรรมศาสตร์',                     nameEn: 'Faculty of Fine and Applied Arts',                kind: 'ACADEMIC' as const },
  { code: 'COLA', nameTh: 'วิทยาลัยการปกครองท้องถิ่น',               nameEn: 'College of Local Administration',                 kind: 'ACADEMIC' as const },
  { code: 'IC',   nameTh: 'วิทยาลัยนานาชาติ',                       nameEn: 'International College',                           kind: 'ACADEMIC' as const },
  { code: 'EC',   nameTh: 'คณะเศรษฐศาสตร์',                        nameEn: 'Faculty of Economics',                            kind: 'ACADEMIC' as const },
  { code: 'NK',   nameTh: 'คณะสหวิทยาการ',                         nameEn: 'Faculty of Interdisciplinary Studies',            kind: 'ACADEMIC' as const },
  { code: 'COC',  nameTh: 'วิทยาลัยการคอมพิวเตอร์',                 nameEn: 'College of Computing',                            kind: 'ACADEMIC' as const },
  { code: 'LAW',  nameTh: 'คณะนิติศาสตร์',                         nameEn: 'Faculty of Law',                                  kind: 'ACADEMIC' as const },
  // 12 added 2026-05-04 — non-academic org units that host support staff
  // surfaced via the processed-HR mart (vw_history). These appear in
  // org rollups but never own programs.
  { code: 'PRES', nameTh: 'สำนักงานอธิการบดี',                      nameEn: 'Office of the President',                         kind: 'ADMIN' as const },
  { code: 'CONS', nameTh: 'สำนักงานสภามหาวิทยาลัย',                  nameEn: 'University Council Office',                       kind: 'ADMIN' as const },
  { code: 'RAD',  nameTh: 'กองบริหารงานวิจัย',                       nameEn: 'Division of Research Administration',             kind: 'ADMIN' as const },
  { code: 'DTO',  nameTh: 'สำนักเทคโนโลยีดิจิทัล',                   nameEn: 'Office of Digital Technology',                    kind: 'ADMIN' as const },
  { code: 'LIB',  nameTh: 'สำนักหอสมุด',                            nameEn: 'KKU Library',                                     kind: 'ADMIN' as const },
  { code: 'OAA',  nameTh: 'สำนักบริหารและพัฒนาวิชาการ',              nameEn: 'Office of Academic Affairs and Development',      kind: 'ADMIN' as const },
  { code: 'OAS',  nameTh: 'สำนักบริการวิชาการ',                      nameEn: 'Academic Service Office',                         kind: 'ADMIN' as const },
  { code: 'LANG', nameTh: 'สถาบันภาษา',                            nameEn: 'Language Institute',                              kind: 'INSTITUTE' as const },
  { code: 'CONF', nameTh: 'สถาบันขงจื่อ',                          nameEn: 'Confucius Institute',                             kind: 'INSTITUTE' as const },
  { code: 'HPRI', nameTh: 'สถาบันวิจัยเพื่อพัฒนาสมรรถนะมนุษย์และการเสริมสร้างสุขภาพ', nameEn: 'Human Performance and Health Promotion Research Institute', kind: 'RESEARCH_CENTER' as const },
  { code: 'CRRI', nameTh: 'สถาบันวิจัยมะเร็งท่อน้ำดี',                 nameEn: 'Cholangiocarcinoma Research Institute',           kind: 'RESEARCH_CENTER' as const },
  { code: 'BNEF', nameTh: 'โรงงานแบตเตอรี่และพลังงานยุคใหม่',         nameEn: 'Battery and New-Energy Factory',                  kind: 'RESEARCH_CENTER' as const },
] as const;

const DEPARTMENTS = [
  // EN — 3
  { code: 'EN-CPE', nameTh: 'ภาควิชาวิศวกรรมคอมพิวเตอร์', nameEn: 'Department of Computer Engineering', facultyCode: 'EN' },
  { code: 'EN-EE',  nameTh: 'ภาควิชาวิศวกรรมไฟฟ้า',        nameEn: 'Department of Electrical Engineering', facultyCode: 'EN' },
  { code: 'EN-ME',  nameTh: 'ภาควิชาวิศวกรรมเครื่องกล',     nameEn: 'Department of Mechanical Engineering', facultyCode: 'EN' },
  // SC — 3
  { code: 'SC-CS',  nameTh: 'ภาควิชาวิทยาการคอมพิวเตอร์',   nameEn: 'Department of Computer Science', facultyCode: 'SC' },
  { code: 'SC-MA',  nameTh: 'ภาควิชาคณิตศาสตร์',           nameEn: 'Department of Mathematics', facultyCode: 'SC' },
  { code: 'SC-BI',  nameTh: 'ภาควิชาชีววิทยา',             nameEn: 'Department of Biology', facultyCode: 'SC' },
  // MD — 2
  { code: 'MD-INT', nameTh: 'ภาควิชาอายุรศาสตร์',           nameEn: 'Department of Internal Medicine', facultyCode: 'MD' },
  { code: 'MD-PED', nameTh: 'ภาควิชากุมารเวชศาสตร์',         nameEn: 'Department of Pediatrics', facultyCode: 'MD' },
  // HU — 2
  { code: 'HU-EN',  nameTh: 'ภาควิชาภาษาอังกฤษ',          nameEn: 'Department of English', facultyCode: 'HU' },
  { code: 'HU-HIS', nameTh: 'ภาควิชาประวัติศาสตร์',          nameEn: 'Department of History', facultyCode: 'HU' },
  // BS — 2
  { code: 'BS-ACC', nameTh: 'ภาควิชาการบัญชี',             nameEn: 'Department of Accounting', facultyCode: 'BS' },
  { code: 'BS-MGT', nameTh: 'ภาควิชาการจัดการ',           nameEn: 'Department of Management', facultyCode: 'BS' },
] as const;

// ──────────────────────────────────────────────────────────────────────────
// 2. Programs (30) — distributed across departments, levels, and statuses
// ──────────────────────────────────────────────────────────────────────────

const PROGRAMS: Array<{
  code: string;
  nameTh: string;
  nameEn: string;
  facultyCode: string;
  departmentCode: string;
  level: ProgramLevel;
  status?: ProgramStatus;
  yearEstablished: number;
}> = [
  // Engineering
  { code: 'EN-CPE-BSC',  nameTh: 'วิศวกรรมคอมพิวเตอร์',            nameEn: 'Computer Engineering',                   facultyCode: 'EN', departmentCode: 'EN-CPE', level: 'BACHELOR', yearEstablished: 1990 },
  { code: 'EN-CPE-MSC',  nameTh: 'วิศวกรรมคอมพิวเตอร์ (มหาบัณฑิต)', nameEn: 'Computer Engineering (Master)',          facultyCode: 'EN', departmentCode: 'EN-CPE', level: 'MASTER',   yearEstablished: 2001 },
  { code: 'EN-CPE-PHD',  nameTh: 'วิศวกรรมคอมพิวเตอร์ (ดุษฎีบัณฑิต)', nameEn: 'Computer Engineering (Doctoral)',      facultyCode: 'EN', departmentCode: 'EN-CPE', level: 'DOCTORAL', yearEstablished: 2012 },
  { code: 'EN-EE-BSC',   nameTh: 'วิศวกรรมไฟฟ้า',                   nameEn: 'Electrical Engineering',                 facultyCode: 'EN', departmentCode: 'EN-EE',  level: 'BACHELOR', yearEstablished: 1985 },
  { code: 'EN-EE-MSC',   nameTh: 'วิศวกรรมไฟฟ้า (มหาบัณฑิต)',        nameEn: 'Electrical Engineering (Master)',        facultyCode: 'EN', departmentCode: 'EN-EE',  level: 'MASTER',   yearEstablished: 2002 },
  { code: 'EN-ME-BSC',   nameTh: 'วิศวกรรมเครื่องกล',               nameEn: 'Mechanical Engineering',                 facultyCode: 'EN', departmentCode: 'EN-ME',  level: 'BACHELOR', yearEstablished: 1988 },
  { code: 'EN-ME-MSC',   nameTh: 'วิศวกรรมเครื่องกล (มหาบัณฑิต)',    nameEn: 'Mechanical Engineering (Master)',        facultyCode: 'EN', departmentCode: 'EN-ME',  level: 'MASTER',   yearEstablished: 2005 },
  // Science
  { code: 'SC-CS-BSC',   nameTh: 'วิทยาการคอมพิวเตอร์',             nameEn: 'Computer Science',                       facultyCode: 'SC', departmentCode: 'SC-CS',  level: 'BACHELOR', yearEstablished: 1995 },
  { code: 'SC-CS-MSC',   nameTh: 'วิทยาการคอมพิวเตอร์ (มหาบัณฑิต)',  nameEn: 'Computer Science (Master)',              facultyCode: 'SC', departmentCode: 'SC-CS',  level: 'MASTER',   yearEstablished: 2005 },
  { code: 'SC-CS-PHD',   nameTh: 'วิทยาการคอมพิวเตอร์ (ดุษฎีบัณฑิต)', nameEn: 'Computer Science (Doctoral)',            facultyCode: 'SC', departmentCode: 'SC-CS',  level: 'DOCTORAL', yearEstablished: 2015 },
  { code: 'SC-MA-BSC',   nameTh: 'คณิตศาสตร์',                      nameEn: 'Mathematics',                            facultyCode: 'SC', departmentCode: 'SC-MA',  level: 'BACHELOR', yearEstablished: 1978 },
  { code: 'SC-MA-MSC',   nameTh: 'คณิตศาสตร์ (มหาบัณฑิต)',           nameEn: 'Mathematics (Master)',                   facultyCode: 'SC', departmentCode: 'SC-MA',  level: 'MASTER',   yearEstablished: 1995 },
  { code: 'SC-MA-PHD',   nameTh: 'คณิตศาสตร์ (ดุษฎีบัณฑิต)',          nameEn: 'Mathematics (Doctoral)',                 facultyCode: 'SC', departmentCode: 'SC-MA',  level: 'DOCTORAL', status: 'PAUSED', yearEstablished: 2010 },
  { code: 'SC-BI-BSC',   nameTh: 'ชีววิทยา',                        nameEn: 'Biology',                                facultyCode: 'SC', departmentCode: 'SC-BI',  level: 'BACHELOR', yearEstablished: 1982 },
  { code: 'SC-BI-MSC',   nameTh: 'ชีววิทยา (มหาบัณฑิต)',             nameEn: 'Biology (Master)',                       facultyCode: 'SC', departmentCode: 'SC-BI',  level: 'MASTER',   yearEstablished: 2000 },
  // Medicine
  { code: 'MD-MBBS',     nameTh: 'แพทยศาสตรบัณฑิต',                 nameEn: 'Doctor of Medicine (M.D.)',              facultyCode: 'MD', departmentCode: 'MD-INT', level: 'BACHELOR', yearEstablished: 1972 },
  { code: 'MD-INT-MSC',  nameTh: 'อายุรศาสตร์ (มหาบัณฑิต)',           nameEn: 'Internal Medicine (Master)',             facultyCode: 'MD', departmentCode: 'MD-INT', level: 'MASTER',   yearEstablished: 1998 },
  { code: 'MD-INT-PHD',  nameTh: 'อายุรศาสตร์ (ดุษฎีบัณฑิต)',          nameEn: 'Internal Medicine (Doctoral)',           facultyCode: 'MD', departmentCode: 'MD-INT', level: 'DOCTORAL', yearEstablished: 2008 },
  { code: 'MD-PED-MSC',  nameTh: 'กุมารเวชศาสตร์ (มหาบัณฑิต)',        nameEn: 'Pediatrics (Master)',                    facultyCode: 'MD', departmentCode: 'MD-PED', level: 'MASTER',   yearEstablished: 2003 },
  { code: 'MD-PED-PHD',  nameTh: 'กุมารเวชศาสตร์ (ดุษฎีบัณฑิต)',       nameEn: 'Pediatrics (Doctoral)',                  facultyCode: 'MD', departmentCode: 'MD-PED', level: 'DOCTORAL', yearEstablished: 2011 },
  // Humanities
  { code: 'HU-EN-BA',    nameTh: 'ภาษาอังกฤษ',                     nameEn: 'English',                                facultyCode: 'HU', departmentCode: 'HU-EN',  level: 'BACHELOR', yearEstablished: 1975 },
  { code: 'HU-EN-MA',    nameTh: 'ภาษาอังกฤษ (มหาบัณฑิต)',          nameEn: 'English (Master)',                       facultyCode: 'HU', departmentCode: 'HU-EN',  level: 'MASTER',   yearEstablished: 1998 },
  { code: 'HU-HIS-BA',   nameTh: 'ประวัติศาสตร์',                   nameEn: 'History',                                facultyCode: 'HU', departmentCode: 'HU-HIS', level: 'BACHELOR', yearEstablished: 1978 },
  { code: 'HU-HIS-MA',   nameTh: 'ประวัติศาสตร์ (มหาบัณฑิต)',        nameEn: 'History (Master)',                       facultyCode: 'HU', departmentCode: 'HU-HIS', level: 'MASTER',   status: 'SUNSET', yearEstablished: 1995 },
  // Business
  { code: 'BS-ACC-BBA',  nameTh: 'การบัญชี',                        nameEn: 'Accounting',                             facultyCode: 'BS', departmentCode: 'BS-ACC', level: 'BACHELOR', yearEstablished: 1992 },
  { code: 'BS-ACC-MBA',  nameTh: 'การบัญชี (มหาบัณฑิต)',             nameEn: 'Accounting (Master)',                    facultyCode: 'BS', departmentCode: 'BS-ACC', level: 'MASTER',   yearEstablished: 2005 },
  { code: 'BS-ACC-PHD',  nameTh: 'การบัญชี (ดุษฎีบัณฑิต)',            nameEn: 'Accounting (Doctoral)',                  facultyCode: 'BS', departmentCode: 'BS-ACC', level: 'DOCTORAL', yearEstablished: 2015 },
  { code: 'BS-MGT-BBA',  nameTh: 'การจัดการ',                       nameEn: 'Management',                             facultyCode: 'BS', departmentCode: 'BS-MGT', level: 'BACHELOR', yearEstablished: 1993 },
  { code: 'BS-MGT-MBA',  nameTh: 'การจัดการ (มหาบัณฑิต)',            nameEn: 'Management (Master)',                    facultyCode: 'BS', departmentCode: 'BS-MGT', level: 'MASTER',   yearEstablished: 2004 },
  { code: 'BS-MGT-MKT',  nameTh: 'การตลาดดิจิทัล',                  nameEn: 'Digital Marketing',                      facultyCode: 'BS', departmentCode: 'BS-MGT', level: 'BACHELOR', yearEstablished: 2018 },
];

// ──────────────────────────────────────────────────────────────────────────
// 3. Skill taxonomy (~500 across 10 categories)
// ──────────────────────────────────────────────────────────────────────────

const SKILL_CATEGORIES = [
  'Software Engineering', 'Data & AI', 'Electrical Engineering',
  'Mechanical Engineering', 'Medicine', 'Biology',
  'Mathematics', 'Language', 'Business', 'Accounting',
] as const;

function buildSkills(): Array<{
  code: string;
  nameTh: string;
  nameEn: string;
  category: string;
  taxonomySource: SkillTaxonomy;
}> {
  const out: Array<{
    code: string;
    nameTh: string;
    nameEn: string;
    category: string;
    taxonomySource: SkillTaxonomy;
  }> = [];
  let n = 0;
  for (const cat of SKILL_CATEGORIES) {
    // 50 skills per category → 500 total.
    for (let i = 1; i <= 50; i++) {
      n++;
      const code = `SK-${String(n).padStart(4, '0')}`;
      out.push({
        code,
        nameEn: `${cat} skill ${i}`,
        nameTh: `ทักษะ${cat} ข้อ ${i}`,
        category: cat,
        taxonomySource: pick([
          'LIGHTCAST',
          'ESCO',
          'TPQI',
          'KKU',
        ] as const),
      });
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// 4. Users (one per role)
// ──────────────────────────────────────────────────────────────────────────

const USERS: Array<{
  email: string;
  name: string;
  role: UserRole;
  facultyCode?: string;
  departmentCode?: string;
}> = [
  // Legacy seed users mapped to v2 taxonomy (2026-05-09 — see migration
  // 20260509100000_remove_legacy_user_roles for the full mapping rationale).
  { email: 'viewer@kku.ac.th',    name: 'University User',              role: 'UNIVERSITY_USER' },
  { email: 'council@kku.ac.th',   name: 'Council Member',               role: 'UNIVERSITY_USER' },
  { email: 'exec@kku.ac.th',      name: 'Executive Officer',            role: 'SYSTEM_ADMIN' },
  { email: 'dean.en@kku.ac.th',   name: 'Dean of Engineering',          role: 'FACULTY_USER', facultyCode: 'EN' },
  { email: 'dh.cpe@kku.ac.th',    name: 'Head of Computer Engineering', role: 'FACULTY_USER', facultyCode: 'EN', departmentCode: 'EN-CPE' },
  { email: 'analyst@kku.ac.th',   name: 'Institutional Analyst',        role: 'SYSTEM_ADMIN' },
  { email: 'admin@kku.ac.th',     name: 'Admin',                        role: 'SUPER_ADMIN' },
];

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  // Cost methodology baseline
  const costMethodology = await prisma.costMethodology.upsert({
    where: { version: 'v1' },
    update: {},
    create: {
      version: 'v1',
      description:
        'Initial placeholder cost-allocation methodology. Replace in prompt 14 after consulting KKU Finance Division.',
      effectiveDate: new Date('2024-01-01'),
    },
  });

  // Academic-year rollover boundary. Seed 2026-06-16 so BE 2569 reads
  // complete + BE 2570 in-progress immediately, with a stale-warning that
  // prompts the operator to set 2027-06-16 next. See
  // docs/superpowers/specs/2026-06-28-academic-year-rollover-config-design.md
  await prisma.systemSetting.upsert({
    where: { key: 'academic_year.next_start_date' },
    update: {},                       // never clobber an operator-set value on reseed
    create: { key: 'academic_year.next_start_date', value: '2026-06-16' },
  });

  // ── Faculties ───────────────────────────────────────────────────────────
  const facultyByCode = new Map<string, { id: string }>();
  for (const f of FACULTIES) {
    const row = await prisma.faculty.upsert({
      where: { code: f.code },
      update: { kind: f.kind },
      create: { code: f.code, nameTh: f.nameTh, nameEn: f.nameEn, kind: f.kind },
    });
    facultyByCode.set(f.code, row);
  }

  // ── Departments ─────────────────────────────────────────────────────────
  const departmentByCode = new Map<string, { id: string; facultyId: string }>();
  for (const d of DEPARTMENTS) {
    const faculty = facultyByCode.get(d.facultyCode)!;
    const row = await prisma.department.upsert({
      where: { code: d.code },
      update: {},
      create: {
        code: d.code,
        nameTh: d.nameTh,
        nameEn: d.nameEn,
        facultyId: faculty.id,
      },
    });
    departmentByCode.set(d.code, { id: row.id, facultyId: faculty.id });
  }

  // ── Programs — gated (no-mock policy) ───────────────────────────────────
  // The 30 bootstrap-era mock programs (EN-CPE-BSC, …) were purged 2026-05-08
  // and must NEVER return on a plain `db:seed`: real programs came from the
  // (now-detached) master-sheet bootstrap and are managed via /admin/programs.
  // This block was ungated until 2026-07-08, silently resurrecting them on
  // every seed run. With the map left empty, the mock curricula/courses loop
  // below and the SEED_MOCKS-gated blocks that iterate it all no-op naturally.
  const programByCode = new Map<
    string,
    { id: string; facultyId: string; departmentId: string | null }
  >();
  if (SEED_MOCKS) {
    for (const p of PROGRAMS) {
      const faculty = facultyByCode.get(p.facultyCode)!;
      const department = departmentByCode.get(p.departmentCode)!;
      const row = await prisma.program.upsert({
        where: { code: p.code },
        update: {},
        create: {
          code: p.code,
          nameTh: p.nameTh,
          nameEn: p.nameEn,
          facultyId: faculty.id,
          departmentId: department.id,
          level: p.level,
          status: p.status ?? 'ACTIVE',
          yearEstablished: p.yearEstablished,
        },
      });
      programByCode.set(p.code, {
        id: row.id,
        facultyId: faculty.id,
        departmentId: department.id,
      });
    }
  } // end if (SEED_MOCKS) — mock programs

  // ── Users ───────────────────────────────────────────────────────────────
  for (const u of USERS) {
    const facultyId = u.facultyCode ? facultyByCode.get(u.facultyCode)?.id : null;
    const departmentId = u.departmentCode
      ? departmentByCode.get(u.departmentCode)?.id
      : null;
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        facultyId,
        departmentId,
      },
    });
  }
  const adminUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin@kku.ac.th' },
  });

  // ── Skills ──────────────────────────────────────────────────────────────
  // Synthetic 500-skill placeholder — kept so downstream seed code
  // (course-skill mapping) has enough breadth to pick from. Real
  // extraction in prompt 04 replaces these as it runs.
  const skills = buildSkills();
  for (const s of skills) {
    await prisma.skill.upsert({
      where: { code: s.code },
      update: {},
      create: s,
    });
  }

  // Real KKU taxonomy seed — ~60 skills with parent-child relationships
  // across the sectors modules 05-12 actually reach into. Two-pass:
  // first create every row (no parent), then wire parent_skill_id by
  // code resolution.
  const { SOURCE_CATALOG: _sourceCatalog, SKILL_TAXONOMY_SEED } = await import('@kku/shared');
  void _sourceCatalog;
  for (const entry of SKILL_TAXONOMY_SEED) {
    await prisma.skill.upsert({
      where: { code: entry.code },
      update: {
        nameEn: entry.nameEn,
        nameTh: entry.nameTh,
        category: entry.category,
        taxonomySource: entry.taxonomySource,
      },
      create: {
        code: entry.code,
        nameEn: entry.nameEn,
        nameTh: entry.nameTh,
        category: entry.category,
        taxonomySource: entry.taxonomySource,
      },
    });
  }
  // Parent resolution pass.
  const skillsByCode = new Map<string, string>(
    (
      await prisma.skill.findMany({
        where: { code: { in: SKILL_TAXONOMY_SEED.map((e) => e.code) } },
        select: { id: true, code: true },
      })
    ).map((s) => [s.code, s.id]),
  );
  for (const entry of SKILL_TAXONOMY_SEED) {
    if (!entry.parentCode) continue;
    const parentId = skillsByCode.get(entry.parentCode);
    const thisId = skillsByCode.get(entry.code);
    if (!parentId || !thisId) continue;
    await prisma.skill.update({ where: { id: thisId }, data: { parentSkillId: parentId } });
  }

  const allSkills = await prisma.skill.findMany({ select: { id: true, category: true } });

  // ── Courses (~200) + CurriculumCourse + CourseSkill ─────────────────────
  // ~7 courses per program × 30 programs ≈ 210.
  let curriculumCourseSeq = 0;
  for (const [programCode, program] of programByCode) {
    // One curriculum per program.
    const curriculum = await prisma.curriculum.upsert({
      where: { programId_version: { programId: program.id, version: 'v2024' } },
      update: {},
      create: {
        programId: program.id,
        version: 'v2024',
        effectiveYear: 2024,
        totalCredits: 132,
        status: CurriculumStatus.ACTIVE,
      },
    });
    const courseCount = 7;
    for (let i = 1; i <= courseCount; i++) {
      const code = `${programCode}-C${String(i).padStart(3, '0')}`;
      const type: CourseType =
        i <= 3 ? 'CORE' : i <= 5 ? 'ELECTIVE' : 'GENERAL';
      const course = await prisma.course.upsert({
        where: { programId_code: { programId: program.id, code } },
        update: {},
        create: {
          programId: program.id,
          code,
          nameTh: `รายวิชา ${i} ของ ${programCode}`,
          nameEn: `Course ${i} of ${programCode}`,
          credits: 3,
          type,
        },
      });
      curriculumCourseSeq++;
      await prisma.curriculumCourse.upsert({
        where: {
          curriculumId_courseId_semester: {
            curriculumId: curriculum.id,
            courseId: course.id,
            semester: ((i - 1) % 8) + 1,
          },
        },
        update: {},
        create: {
          curriculumId: curriculum.id,
          courseId: course.id,
          semester: ((i - 1) % 8) + 1,
          isRequired: type === 'CORE',
        },
      });
      // 3 skills per course (weighted)
      for (let k = 0; k < 3; k++) {
        const s = pick(allSkills);
        await prisma.courseSkill.upsert({
          where: { courseId_skillId: { courseId: course.id, skillId: s.id } },
          update: {},
          create: {
            courseId: course.id,
            skillId: s.id,
            weight: Number((rand() * 0.8 + 0.2).toFixed(2)),
            source: SkillSource.LLM_EXTRACTED,
            confidence: Number((rand() * 0.3 + 0.7).toFixed(2)),
          },
        });
      }
    }
  }

  // ── Faculty members (5 per department) + ProgramFaculty — gated ──────
  // Real faculty roster is loaded by the kku-hr connector (employee_code
  // prefix `hr_<hash>`). These synthetic rows ("Faculty Member 1 …") were
  // useful for early demo; in real-data mode they pollute the staff list.
  if (SEED_MOCKS) {
  const ranks: FacultyRank[] = ['LECTURER', 'ASST_PROF', 'ASSOC_PROF', 'PROF'];
  for (const [deptCode, dept] of departmentByCode) {
    for (let i = 1; i <= 5; i++) {
      const code = `${deptCode}-FM-${String(i).padStart(2, '0')}`;
      const member = await prisma.facultyMember.upsert({
        where: { employeeCode: code },
        update: {},
        create: {
          employeeCode: code,
          facultyId: dept.facultyId,
          departmentId: dept.id,
          nameTh: `อาจารย์ ${i} ${deptCode}`,
          nameEn: `Faculty Member ${i} (${deptCode})`,
          rank: ranks[i - 1] ?? 'LECTURER',
          hireDate: new Date(2005 + i, 0, 15),
          isActive: true,
        },
      });
      // Link member to one program in their department (if any).
      const programsInDept = Array.from(programByCode.values()).filter(
        (p) => p.departmentId === dept.id,
      );
      if (programsInDept.length > 0) {
        const prog = programsInDept[i % programsInDept.length]!;
        await prisma.programFaculty.upsert({
          where: {
            facultyMemberId_programId: {
              facultyMemberId: member.id,
              programId: prog.id,
            },
          },
          update: {},
          create: {
            facultyMemberId: member.id,
            programId: prog.id,
            role: i === 1 ? 'COORDINATOR' : 'CORE',
          },
        });
      }
    }
  }
  } // end if (SEED_MOCKS) — Faculty members + ProgramFaculty

  // ── Enrollment + Financial + Graduate outcomes ── gated ──────────────
  // Real enrollment / financial come from kku-registry + kku-finance.
  // These synthetic rows are tied to the mock 30-program seed, which gets
  // wiped + replaced by the sheet-seed workflow — they'd orphan anyway.
  if (SEED_MOCKS) {
  const years = [2022, 2023, 2024];
  for (const [, program] of programByCode) {
    for (const year of years) {
      const applications = randInt(80, 600);
      const admitted = Math.round(applications * (0.3 + rand() * 0.3));
      const enrolled = Math.round(admitted * (0.5 + rand() * 0.3));
      const retainedYear2 = Math.round(enrolled * (0.85 + rand() * 0.1));
      const graduatedOnTime = Math.round(enrolled * (0.55 + rand() * 0.25));
      const graduatedLate = Math.round(enrolled * (0.1 + rand() * 0.1));
      const dropouts = Math.max(
        0,
        enrolled - retainedYear2 - (graduatedLate > 0 ? 0 : 0),
      );

      await prisma.enrollmentMetric.upsert({
        where: { programId_academicYear: { programId: program.id, academicYear: year } },
        update: {},
        create: {
          programId: program.id,
          academicYear: year,
          applications,
          admitted,
          enrolled,
          retainedYear2,
          graduatedOnTime,
          graduatedLate,
          dropouts,
          freshnessDate: new Date(`${year}-12-31`),
          methodologyVersion: 'v1',
        },
      });

      const tuitionRevenue = new Prisma.Decimal(
        enrolled * randInt(15000, 35000),
      );
      const directCost = tuitionRevenue.mul(0.35 + rand() * 0.15);
      const allocatedFacultyCost = tuitionRevenue.mul(0.25 + rand() * 0.15);
      const allocatedFacilityCost = tuitionRevenue.mul(0.1);
      const allocatedOverhead = tuitionRevenue.mul(0.08);
      const totalCost = directCost
        .add(allocatedFacultyCost)
        .add(allocatedFacilityCost)
        .add(allocatedOverhead);
      const netContribution = tuitionRevenue.sub(totalCost);
      const costPerStudent =
        enrolled > 0 ? totalCost.div(enrolled) : new Prisma.Decimal(0);

      await prisma.financialMetric.upsert({
        where: { programId_fiscalYear: { programId: program.id, fiscalYear: year } },
        update: {},
        create: {
          programId: program.id,
          fiscalYear: year,
          tuitionRevenue,
          directCost,
          allocatedFacultyCost,
          allocatedFacilityCost,
          allocatedOverhead,
          netContribution,
          costPerStudent,
          freshnessDate: new Date(`${year}-12-31`),
          methodologyVersion: 'v1',
          costMethodologyId: costMethodology.id,
        },
      });

      // Graduate outcomes — only for years where graduates would have had
      // time to enter the workforce (skip most recent year).
      if (year <= 2023 && graduatedOnTime > 0) {
        await prisma.graduateOutcome.upsert({
          where: {
            programId_graduationYear_surveyYear: {
              programId: program.id,
              graduationYear: year,
              surveyYear: year + 1,
            },
          },
          update: {},
          create: {
            programId: program.id,
            graduationYear: year,
            surveyYear: year + 1,
            employmentRate: Number((0.6 + rand() * 0.35).toFixed(3)),
            averageSalary: new Prisma.Decimal(randInt(18000, 45000)),
            jobRelevanceScore: Number((0.55 + rand() * 0.35).toFixed(3)),
            furtherStudyRate: Number((0.1 + rand() * 0.2).toFixed(3)),
            sampleSize: Math.max(10, Math.round(graduatedOnTime * 0.6)),
            freshnessDate: new Date(`${year + 1}-12-31`),
            methodologyVersion: 'v1',
          },
        });
      }
    }
  }
  } // end if (SEED_MOCKS) — Enrollment / Financial / Outcomes

  // ── PDF documents (5 mock fixtures) ── gated ───────────────────────────
  // Real curriculum PDFs land via the seed-from-sheet workflow + the
  // smart linker. Real policy/report/peer/minutes PDFs come via /upload.
  if (SEED_MOCKS) {
  const pdfFixtures = [
    {
      filename: 'MHESI-2024-policy-brief.pdf',
      category: PdfSourceCategory.POLICY,
      org: 'MHESI',
      lang: PdfLanguage.TH,
    },
    {
      filename: 'NESDC-labor-forecast-2026.pdf',
      category: PdfSourceCategory.REPORT,
      org: 'NESDC',
      lang: PdfLanguage.TH,
    },
    {
      filename: 'KKU-CPE-curriculum-2024.pdf',
      category: PdfSourceCategory.CURRICULUM,
      org: 'KKU',
      lang: PdfLanguage.MIXED,
    },
    {
      filename: 'ASEAN-peer-program-brief.pdf',
      category: PdfSourceCategory.PEER_PROGRAM,
      org: 'External',
      lang: PdfLanguage.EN,
    },
    {
      filename: 'KKU-council-minutes-2025-01.pdf',
      category: PdfSourceCategory.COMMITTEE_MINUTES,
      org: 'KKU Council',
      lang: PdfLanguage.TH,
    },
  ];
  for (const p of pdfFixtures) {
    const hash = `sha256:${p.filename}`;
    await prisma.pdfDocument.upsert({
      where: { contentHash: hash },
      update: {},
      create: {
        originalFilename: p.filename,
        storageUrl: `s3://pdf-raw/${p.filename}`,
        fileSize: randInt(200_000, 4_000_000),
        pageCount: randInt(8, 120),
        sourceCategory: p.category,
        sourceOrg: p.org,
        language: p.lang,
        uploadedByUserId: adminUser.id,
        processingStatus: PdfProcessingStatus.COMPLETED,
        ocrApplied: p.lang !== 'EN',
        ocrConfidence: 0.9,
        contentHash: hash,
      },
    });
  }
  } // end if (SEED_MOCKS) — pdf fixtures

  // ── Job postings (50) ── gated behind SEED_MOCKS ───────────────────────
  if (SEED_MOCKS) {
  const sources = ['JobsDB', 'JobThai'];
  const provinces = ['Bangkok', 'Khon Kaen', 'Chiang Mai', 'Chon Buri'];
  for (let i = 1; i <= 50; i++) {
    const externalId = `jp-${String(i).padStart(4, '0')}`;
    const src = pick(sources);
    const posted = new Date(2025, randInt(0, 11), randInt(1, 28));
    const salaryMin = randInt(18000, 35000);
    await prisma.jobPosting.upsert({
      where: { source_externalId: { source: src, externalId } },
      update: {},
      create: {
        source: src,
        externalId,
        title: `Sample role ${i}`,
        employerName: `Employer ${i}`,
        location: 'Thailand',
        province: pick(provinces),
        salaryMin,
        salaryMax: salaryMin + randInt(5000, 25000),
        postedDate: posted,
        descriptionRaw: `Mock job description for role ${i}. Replace via ingestion connector in prompt 03.`,
        freshnessDate: posted,
      },
    });
  }
  } // end if (SEED_MOCKS) — job postings

  // ── Data sources (inventory seed — catalog lives in @kku/shared) ────────
  // The connector registry in apps/ingestion looks up its DataSource row
  // by slug at boot. Keep this in sync with SOURCE_CATALOG in
  // packages/shared/src/ingestion/catalog.ts — `pnpm db:seed` writes from
  // that one list, so there is no drift.
  const { SOURCE_CATALOG } = await import('@kku/shared');
  for (const entry of SOURCE_CATALOG) {
    const scheduleEnabled = entry.deprecated ? false : (entry.scheduleEnabled ?? true);
    await prisma.dataSource.upsert({
      where: { slug: entry.slug },
      update: {
        name: entry.name,
        kind: entry.kind,
        inputFormat: entry.inputFormat,
        acceptsPdfUploads: entry.acceptsPdfUploads ?? false,
        baseUrl: entry.baseUrl ?? null,
        cadenceCron: entry.cadenceCron ?? null,
        scheduleEnabled,
        ownerContact: entry.ownerContact ?? null,
        notes: entry.notes ?? null,
        status: entry.mocked ? 'mocked' : 'active',
        // Keep `mocked` atomic with `status` — flipping a connector real in
        // the catalog must update BOTH columns (drift-audit invariant), else
        // the connector runs real while data_sources still reads mocked=true.
        mocked: entry.mocked,
      },
      create: {
        slug: entry.slug,
        name: entry.name,
        kind: entry.kind,
        inputFormat: entry.inputFormat,
        acceptsPdfUploads: entry.acceptsPdfUploads ?? false,
        baseUrl: entry.baseUrl ?? null,
        cadenceCron: entry.cadenceCron ?? null,
        scheduleEnabled,
        ownerContact: entry.ownerContact ?? null,
        notes: entry.notes ?? null,
        status: entry.mocked ? 'mocked' : 'active',
        // Keep `mocked` atomic with `status` — flipping a connector real in
        // the catalog must update BOTH columns (drift-audit invariant), else
        // the connector runs real while data_sources still reads mocked=true.
        mocked: entry.mocked,
      },
    });
  }

  // ── KKU SSO org-code mappings (dev seed — real values from KKU IT) ──────
  // KKU SSO emits faculty/department codes in a specific taxonomy; our
  // internal Faculty/Department primary keys are cuids. This bridge lets
  // the auth callback resolve claims → internal IDs.
  const ssoMappings: Array<{
    kkuCode: string;
    kind: 'FACULTY' | 'DEPARTMENT';
    facultyCode?: string;
    departmentCode?: string;
    notes: string;
  }> = [
    { kkuCode: '01', kind: 'FACULTY',    facultyCode: 'EN', notes: 'Dev mapping — confirm with KKU IT.' },
    { kkuCode: '02', kind: 'FACULTY',    facultyCode: 'SC', notes: 'Dev mapping — confirm with KKU IT.' },
    { kkuCode: '03', kind: 'FACULTY',    facultyCode: 'MD', notes: 'Dev mapping — confirm with KKU IT.' },
    { kkuCode: '04', kind: 'FACULTY',    facultyCode: 'HU', notes: 'Dev mapping — confirm with KKU IT.' },
    { kkuCode: '05', kind: 'FACULTY',    facultyCode: 'BS', notes: 'Dev mapping — confirm with KKU IT.' },
    { kkuCode: '0101', kind: 'DEPARTMENT', departmentCode: 'EN-CPE', notes: 'Dev mapping.' },
    { kkuCode: '0102', kind: 'DEPARTMENT', departmentCode: 'EN-EE',  notes: 'Dev mapping.' },
    { kkuCode: '0103', kind: 'DEPARTMENT', departmentCode: 'EN-ME',  notes: 'Dev mapping.' },
    { kkuCode: '0201', kind: 'DEPARTMENT', departmentCode: 'SC-CS',  notes: 'Dev mapping.' },
    { kkuCode: '0202', kind: 'DEPARTMENT', departmentCode: 'SC-MA',  notes: 'Dev mapping.' },
  ];
  for (const m of ssoMappings) {
    const facultyId = m.facultyCode ? facultyByCode.get(m.facultyCode)?.id : null;
    const departmentId = m.departmentCode
      ? departmentByCode.get(m.departmentCode)?.id
      : null;
    await prisma.kkuOrgCodeMapping.upsert({
      where: { kkuCode_kind: { kkuCode: m.kkuCode, kind: m.kind } },
      update: {},
      create: {
        kkuCode: m.kkuCode,
        kind: m.kind,
        facultyId,
        departmentId,
        notes: m.notes,
      },
    });
  }

  // ── Gap Analyzer seeds (prompt 08) ──────────────────────────────────────
  // Always seeds reference data (sectors, skill_sectors, demographic
  // projections); mock subsets (occupation_demand, forecast_runs) gate
  // on SEED_MOCKS internally.
  await seedGapAnalyzerData();

  // ── Scenario Planner templates (prompt 09) — gated ─────────────────────
  if (SEED_MOCKS) await seedScenarioTemplates();

  // ── Competitive Benchmarking (prompt 10) — gated ───────────────────────
  if (SEED_MOCKS) await seedBenchmarkingData();

  // ── Decision Workspace (prompt 12) — gated ─────────────────────────────
  if (SEED_MOCKS) await seedDecisionSamples();

  // ── External AI sources (Phase 5) — always seed catalog ─────────────────
  await seedExternalAiSources();

  // ── Summary ─────────────────────────────────────────────────────────────
  const counts = {
    faculties: await prisma.faculty.count(),
    departments: await prisma.department.count(),
    programs: await prisma.program.count(),
    courses: await prisma.course.count(),
    curricula: await prisma.curriculum.count(),
    skills: await prisma.skill.count(),
    courseSkills: await prisma.courseSkill.count(),
    facultyMembers: await prisma.facultyMember.count(),
    users: await prisma.user.count(),
    enrollment: await prisma.enrollmentMetric.count(),
    financial: await prisma.financialMetric.count(),
    outcomes: await prisma.graduateOutcome.count(),
    pdfs: await prisma.pdfDocument.count(),
    jobPostings: await prisma.jobPosting.count(),
    jobPostingSkills: await prisma.jobPostingSkill.count(),
    occupationDemand: await prisma.occupationDemand.count(),
    sectors: await prisma.sector.count(),
    skillSectors: await prisma.skillSector.count(),
    demographicProjections: await prisma.demographicProjection.count(),
    forecastRuns: await prisma.forecastRun.count(),
    scenarios: await prisma.scenario.count(),
    scenarioTemplates: await prisma.scenario.count({ where: { isTemplate: true } }),
    peerPrograms: await prisma.peerProgram.count(),
    peerSets: await prisma.peerSet.count(),
    peerProgramSkills: await prisma.peerProgramSkill.count(),
    peerRankings: await prisma.peerRanking.count(),
    councilDecisions: await prisma.councilDecision.count(),
    decisionMilestones: await prisma.decisionMilestone.count(),
    decisionApprovers: await prisma.decisionApprover.count(),
    decisionOutcomeReviews: await prisma.decisionOutcomeReview.count(),
    dataSources: await prisma.dataSource.count(),
    kkuOrgMappings: await prisma.kkuOrgCodeMapping.count(),
  };
  // eslint-disable-next-line no-console
  console.log('seed complete:', counts);
}

// ──────────────────────────────────────────────────────────────────────────
// Gap Analyzer seeds (prompt 08)
//
// Populates: sectors (BCG + S-curve), skill-sector tags, JobPostingSkill
// joins, OccupationDemand rows, DemographicProjection rows, and a
// handful of ForecastRun records for the accuracy page.
// ──────────────────────────────────────────────────────────────────────────

async function seedGapAnalyzerData() {
  // ── Sectors ─────────────────────────────────────────────────────────────
  const sectors = [
    { code: 'BCG-BIO',     family: 'BCG'    as const, nameTh: 'เศรษฐกิจชีวภาพ',           nameEn: 'Bio-economy',             demandMultiplier: 1.15 },
    { code: 'BCG-CIRCULAR',family: 'BCG'    as const, nameTh: 'เศรษฐกิจหมุนเวียน',        nameEn: 'Circular economy',        demandMultiplier: 1.05 },
    { code: 'BCG-GREEN',   family: 'BCG'    as const, nameTh: 'เศรษฐกิจสีเขียว',          nameEn: 'Green economy',           demandMultiplier: 1.20 },
    { code: 'SC-AUTO',     family: 'SCURVE' as const, nameTh: 'ยานยนต์สมัยใหม่',           nameEn: 'Next-gen automotive',     demandMultiplier: 1.25 },
    { code: 'SC-SMART',    family: 'SCURVE' as const, nameTh: 'อิเล็กทรอนิกส์อัจฉริยะ',     nameEn: 'Smart electronics',       demandMultiplier: 1.20 },
    { code: 'SC-MED',      family: 'SCURVE' as const, nameTh: 'ศูนย์การแพทย์',             nameEn: 'Medical hub',             demandMultiplier: 1.30 },
    { code: 'SC-DIGITAL',  family: 'SCURVE' as const, nameTh: 'เศรษฐกิจดิจิทัล',           nameEn: 'Digital economy',         demandMultiplier: 1.35 },
    { code: 'SC-AGRI',     family: 'SCURVE' as const, nameTh: 'เกษตรและอาหารขั้นสูง',      nameEn: 'Advanced agri/food',      demandMultiplier: 1.15 },
  ];
  for (const s of sectors) {
    await prisma.sector.upsert({
      where: { code: s.code },
      update: {},
      create: s,
    });
  }

  // ── Skill-sector tagging ────────────────────────────────────────────────
  // Best-effort heuristic: look up each skill by keyword and tag.
  const sectorIdByCode = new Map(
    (await prisma.sector.findMany({ select: { id: true, code: true } })).map((s) => [s.code, s.id]),
  );
  const allSkills = await prisma.skill.findMany({ select: { id: true, code: true, nameEn: true } });

  const tagBy = (needle: RegExp, sectorCode: string, weight = 1.0) => {
    const sectorId = sectorIdByCode.get(sectorCode);
    if (!sectorId) return [];
    return allSkills
      .filter((sk) => needle.test(sk.nameEn) || needle.test(sk.code))
      .map((sk) => ({ skillId: sk.id, sectorId, weight }));
  };

  const skillSectorRows = [
    ...tagBy(/bio|genetic|microb|biotech|life-sci|biology/i, 'BCG-BIO'),
    ...tagBy(/recycl|circular|waste|reuse|sustainab/i, 'BCG-CIRCULAR'),
    ...tagBy(/green|renewable|solar|wind|clean.?energy/i, 'BCG-GREEN'),
    ...tagBy(/auto|vehicle|ev|battery|mechatronic/i, 'SC-AUTO'),
    ...tagBy(/electron|embedded|iot|sensor|semicon/i, 'SC-SMART'),
    ...tagBy(/medic|health|clinic|nurs|pharma/i, 'SC-MED'),
    ...tagBy(/data|ai|machine.?learning|software|cloud|cyber|digital|program/i, 'SC-DIGITAL'),
    ...tagBy(/agri|farm|food|crop|livestock|soil/i, 'SC-AGRI'),
  ];
  for (const r of skillSectorRows) {
    await prisma.skillSector.upsert({
      where: { skillId_sectorId: { skillId: r.skillId, sectorId: r.sectorId } },
      update: {},
      create: r,
    });
  }

  // ── JobPostingSkill joins — gated (depends on mock job postings) ─────
  if (SEED_MOCKS) {
  const postings = await prisma.jobPosting.findMany({ select: { id: true, externalId: true } });
  const skillPool = allSkills.slice(0, Math.min(40, allSkills.length));
  if (skillPool.length > 0) {
    for (let i = 0; i < postings.length; i++) {
      const posting = postings[i]!;
      const skillCount = 2 + (i % 2);
      for (let j = 0; j < skillCount; j++) {
        const skill = skillPool[(i * 3 + j) % skillPool.length]!;
        const weight = 0.5 + ((i + j) % 10) / 20;
        await prisma.jobPostingSkill.upsert({
          where: { jobPostingId_skillId: { jobPostingId: posting.id, skillId: skill.id } },
          update: {},
          create: { jobPostingId: posting.id, skillId: skill.id, weight },
        });
      }
    }
  }
  } // end if (SEED_MOCKS) — JobPostingSkill

  // ── OccupationDemand ── gated (mock seed) ──────────────────────────────
  if (SEED_MOCKS) {
  // 8 occupation codes × 4 provinces × 6 months = 192 rows.
  const occupationCodes = ['2521', '2521-01', '2529', '2521-02', '2166', '2511', '2221', '2141'];
  const demandProvinces = ['Bangkok', 'Khon Kaen', 'Chiang Mai', 'Chon Buri'];
  const demandYear = new Date().getFullYear();
  for (const code of occupationCodes) {
    for (const province of demandProvinces) {
      for (let m = 1; m <= 6; m++) {
        const base = 50 + (code.length * 7) % 80;
        const provinceBump = province === 'Bangkok' ? 80 : province === 'Khon Kaen' ? 30 : 20;
        await prisma.occupationDemand.upsert({
          where: {
            occupationCode_province_year_month: {
              occupationCode: code,
              province,
              year: demandYear,
              month: m,
            },
          },
          update: {},
          create: {
            occupationCode: code,
            province,
            year: demandYear,
            month: m,
            postingsCount: base + provinceBump + m * 4,
            medianSalary: 28000 + (code.length * 500) + provinceBump * 50,
            growthRate: 0.04 + (m % 3) * 0.01,
            freshnessDate: new Date(demandYear, m - 1, 28),
          },
        });
      }
    }
  }
  } // end if (SEED_MOCKS) — OccupationDemand

  // ── DemographicProjection ── public reference data, always seeded ─────
  // Thailand 18-22 cohort projection: ~4.5M in 2020, shrinking ~1.8%/year.
  // Northeast ~1.2M, same shrink rate.
  const baseThai = 4_500_000;
  const baseNortheast = 1_200_000;
  for (let year = 2020; year <= 2035; year++) {
    const shrink = Math.pow(0.982, year - 2020);
    await prisma.demographicProjection.upsert({
      where: { region_year_ageCohort_source: { region: 'TH', year, ageCohort: '18-22', source: 'NESDC-v1' } },
      update: {},
      create: {
        region: 'TH',
        year,
        ageCohort: '18-22',
        population: Math.round(baseThai * shrink),
        source: 'NESDC-v1',
        freshnessDate: new Date(`${year}-01-01`),
      },
    });
    await prisma.demographicProjection.upsert({
      where: { region_year_ageCohort_source: { region: 'Northeast', year, ageCohort: '18-22', source: 'NESDC-v1' } },
      update: {},
      create: {
        region: 'Northeast',
        year,
        ageCohort: '18-22',
        population: Math.round(baseNortheast * shrink),
        source: 'NESDC-v1',
        freshnessDate: new Date(`${year}-01-01`),
      },
    });
  }

  // ── ForecastRun (back-test history) ── gated (synthetic data) ────────
  if (SEED_MOCKS) {
  const past = new Date().getFullYear() - 1;
  const existingForecasts = await prisma.forecastRun.count();
  if (existingForecasts === 0) {
    const samples = [
      { kind: 'DEMAND' as const, subjectType: 'occupation', subjectId: '2521', targetYear: past, projected: 820, actual: 790 },
      { kind: 'DEMAND' as const, subjectType: 'occupation', subjectId: '2166', targetYear: past, projected: 340, actual: 410 },
      { kind: 'DEMAND' as const, subjectType: 'occupation', subjectId: '2221', targetYear: past, projected: 210, actual: 180 },
      { kind: 'DEMAND' as const, subjectType: 'skill', subjectId: 'sample-skill-1', targetYear: past, projected: 95, actual: 88 },
      { kind: 'DEMAND' as const, subjectType: 'skill', subjectId: 'sample-skill-2', targetYear: past, projected: 140, actual: 175 },
      { kind: 'SUPPLY' as const, subjectType: 'program', subjectId: 'prog-cpe', targetYear: past, projected: 60, actual: 58 },
      { kind: 'SUPPLY' as const, subjectType: 'program', subjectId: 'prog-cs',  targetYear: past, projected: 45, actual: 47 },
      { kind: 'SUPPLY' as const, subjectType: 'program', subjectId: 'prog-me',  targetYear: past, projected: 40, actual: 38 },
      { kind: 'SUPPLY' as const, subjectType: 'program', subjectId: 'prog-ee',  targetYear: past, projected: 55, actual: 52 },
    ];
    for (const s of samples) {
      const spread = Math.max(s.projected * 0.2, 5);
      const errorPct = ((s.projected - s.actual) / Math.max(Math.abs(s.actual), 1)) * 100;
      await prisma.forecastRun.create({
        data: {
          kind: s.kind,
          subjectType: s.subjectType,
          subjectId: s.subjectId,
          region: 'TH',
          targetYear: s.targetYear,
          projectedValue: s.projected,
          ci50Low: s.projected - spread * 0.34,
          ci50High: s.projected + spread * 0.34,
          ci80Low: s.projected - spread * 0.65,
          ci80High: s.projected + spread * 0.65,
          ci95Low: s.projected - spread,
          ci95High: s.projected + spread,
          actualValue: s.actual,
          errorPct,
          methodologyVersion: 'forecasting.v1',
          notes: 'Back-test sample — seeded for prompt 08 accuracy page.',
        },
      });
    }
  }
  } // end if (SEED_MOCKS) — ForecastRun
}

// ──────────────────────────────────────────────────────────────────────────
// Scenario Planner templates (prompt 09)
//
// Persists the 4 canonical templates (demographic stress, financial stress,
// AI disruption, Mekong expansion) as Scenario rows with isTemplate=true,
// owned by the first ADMIN user (system seed owner). Users "Use this
// template" which copies it into a fresh Scenario under their own userId.
// ──────────────────────────────────────────────────────────────────────────
async function seedScenarioTemplates() {
  const { SCENARIO_TEMPLATES } = await import('@kku/shared');
  const adminUser = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true },
  });
  if (!adminUser) {
    // eslint-disable-next-line no-console
    console.warn('seedScenarioTemplates: no SUPER_ADMIN user — skipping');
    return;
  }
  for (const template of SCENARIO_TEMPLATES) {
    const existing = await prisma.scenario.findFirst({
      where: { name: template.name, isTemplate: true },
    });
    if (existing) continue;
    await prisma.scenario.create({
      data: {
        userId: adminUser.id,
        name: template.name,
        descriptionTh: template.descriptionTh,
        descriptionEn: template.descriptionEn,
        scope: 'UNIVERSITY',
        scenarioType: template.scenarioType,
        horizonYears: template.horizonYears,
        assumptionsJson: template.assumptions,
        // Interventions keep their selector placeholders; the API
        // resolves them when a user copies the template.
        interventionsJson: template.interventionBlueprint,
        isTemplate: true,
        workflowStatus: 'SHARED', // visible to all via library
      },
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Competitive Benchmarking seeds (prompt 10)
//
// Creates 3 peer sets (Thai top-10, ASEAN top-20, Global subject leaders),
// ~12 peer programs across 3 subject areas, skill tags for peers, and
// ~20 PeerRanking rows spanning THE + QS + SCImago over 3 years.
// Connectors to these sources are mocked — all data is editorially
// seeded until prompt 14 wires the real APIs.
// ──────────────────────────────────────────────────────────────────────────
async function seedBenchmarkingData() {
  if ((await prisma.peerSet.count()) > 0) {
    // eslint-disable-next-line no-console
    console.log('seedBenchmarkingData: already seeded, skipping');
    return;
  }

  // 12 peer programs across CS, Engineering, Medicine.
  const peers = [
    { institution: 'Chulalongkorn University',    country: 'TH',   subject: 'Computer Science',         level: 'BACHELOR' as const, rank: 1 },
    { institution: 'Chulalongkorn University',    country: 'TH',   subject: 'Engineering',              level: 'BACHELOR' as const, rank: 1 },
    { institution: 'Mahidol University',          country: 'TH',   subject: 'Medicine',                 level: 'BACHELOR' as const, rank: 1 },
    { institution: 'Mahidol University',          country: 'TH',   subject: 'Computer Science',         level: 'BACHELOR' as const, rank: 3 },
    { institution: 'Chiang Mai University',       country: 'TH',   subject: 'Computer Science',         level: 'BACHELOR' as const, rank: 2 },
    { institution: 'Chiang Mai University',       country: 'TH',   subject: 'Medicine',                 level: 'BACHELOR' as const, rank: 4 },
    { institution: 'National University of Singapore', country: 'SG', subject: 'Computer Science',      level: 'BACHELOR' as const, rank: 11 },
    { institution: 'Nanyang Technological Univ.', country: 'SG',   subject: 'Computer Science',         level: 'BACHELOR' as const, rank: 14 },
    { institution: 'Universiti Malaya',           country: 'MY',   subject: 'Medicine',                 level: 'BACHELOR' as const, rank: 65 },
    { institution: 'ETH Zurich',                  country: 'CH',   subject: 'Computer Science',         level: 'MASTER'   as const, rank: 9 },
    { institution: 'MIT',                         country: 'US',   subject: 'Computer Science',         level: 'BACHELOR' as const, rank: 1 },
    { institution: 'Tsinghua University',         country: 'CN',   subject: 'Engineering',              level: 'BACHELOR' as const, rank: 12 },
  ];

  const peerRows: { id: string; subject: string; level: string }[] = [];
  const now = new Date();
  for (const p of peers) {
    const existing = await prisma.peerProgram.findFirst({
      where: { institution: p.institution, programName: `${p.subject} (${p.level})` },
    });
    if (existing) {
      peerRows.push({ id: existing.id, subject: p.subject, level: p.level });
      continue;
    }
    const row = await prisma.peerProgram.create({
      data: {
        institution: p.institution,
        country: p.country,
        subjectArea: p.subject,
        programName: `${p.subject} (${p.level})`,
        programLevel: p.level,
        ranking: p.rank,
        lastScraped: now,
        freshnessDate: now,
      },
    });
    peerRows.push({ id: row.id, subject: p.subject, level: p.level });
  }

  // Attach a handful of skill tags to each peer — prefer real skill ids
  // seeded earlier; fall back to first N skills if they don't match.
  const skills = await prisma.skill.findMany({ take: 40, select: { id: true, code: true, nameEn: true } });
  if (skills.length > 0) {
    for (let i = 0; i < peerRows.length; i++) {
      const peer = peerRows[i]!;
      // Each peer gets 4–6 skill tags — deterministic based on index.
      const tagCount = 4 + (i % 3);
      for (let j = 0; j < tagCount; j++) {
        const skill = skills[(i * 3 + j) % skills.length]!;
        await prisma.peerProgramSkill.upsert({
          where: { peerProgramId_skillId: { peerProgramId: peer.id, skillId: skill.id } },
          update: {},
          create: {
            peerProgramId: peer.id,
            skillId: skill.id,
            weight: 0.4 + ((i + j) % 10) / 20,
          },
        });
      }
    }
  }

  // 3 peer sets — seed + populate members.
  const thaiTop = await prisma.peerSet.create({
    data: {
      name: 'Thai Top-10',
      descriptionTh: 'มหาวิทยาลัยไทยระดับท็อป 10 ตามการจัดอันดับในประเทศ',
      descriptionEn: 'Top-10 Thai universities by domestic ranking.',
      isSystem: true,
      region: 'TH',
      members: {
        create: peerRows
          .filter((p, idx) => peers[idx]?.country === 'TH')
          .map((p) => ({ peerProgramId: p.id })),
      },
    },
  });
  const aseanTop = await prisma.peerSet.create({
    data: {
      name: 'ASEAN Top-20',
      descriptionTh: 'มหาวิทยาลัยในอาเซียนท็อป 20',
      descriptionEn: 'Top-20 ASEAN universities.',
      isSystem: true,
      region: 'ASEAN',
      members: {
        create: peerRows
          .filter((_, idx) => ['TH', 'SG', 'MY'].includes(peers[idx]?.country ?? ''))
          .map((p) => ({ peerProgramId: p.id })),
      },
    },
  });
  await prisma.peerSet.create({
    data: {
      name: 'Global Subject Leaders — CS',
      descriptionTh: 'ผู้นำด้านสาขาวิทยาการคอมพิวเตอร์ระดับโลก',
      descriptionEn: 'Global subject leaders in Computer Science.',
      isSystem: true,
      region: 'GLOBAL',
      subjectArea: 'Computer Science',
      members: {
        create: peerRows
          .filter((p) => p.subject === 'Computer Science')
          .map((p) => ({ peerProgramId: p.id })),
      },
    },
  });

  // PeerRanking: THE + QS + SCImago over 3 years for a subset of institutions.
  const rankingYears = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()];
  const rankingRows: Array<{ institution: string; source: string; subjectArea: string | null; rank: number; percentile: number }> = [
    // THE overall university
    { institution: 'Chulalongkorn University', source: 'THE', subjectArea: null, rank: 601, percentile: 60 },
    { institution: 'Mahidol University',       source: 'THE', subjectArea: null, rank: 501, percentile: 50 },
    { institution: 'KKU',                      source: 'THE', subjectArea: null, rank: 1001, percentile: 25 },
    // QS subject CS
    { institution: 'Chulalongkorn University', source: 'QS',  subjectArea: 'Computer Science', rank: 200, percentile: 80 },
    { institution: 'Mahidol University',       source: 'QS',  subjectArea: 'Computer Science', rank: 350, percentile: 65 },
    { institution: 'KKU',                      source: 'QS',  subjectArea: 'Computer Science', rank: 601, percentile: 40 },
    { institution: 'NUS',                      source: 'QS',  subjectArea: 'Computer Science', rank: 11,  percentile: 99 },
    // SCImago research
    { institution: 'Chulalongkorn University', source: 'SCImago', subjectArea: 'Computer Science', rank: 150, percentile: 85 },
    { institution: 'KKU',                      source: 'SCImago', subjectArea: 'Computer Science', rank: 700, percentile: 30 },
  ];

  for (const base of rankingRows) {
    for (let i = 0; i < rankingYears.length; i++) {
      const year = rankingYears[i]!;
      // Small yearly drift.
      const rank = base.rank + (i - 1) * 10;
      await prisma.peerRanking.upsert({
        where: {
          institution_source_subjectArea_year: {
            institution: base.institution,
            source: base.source,
            subjectArea: base.subjectArea ?? '',
            year,
          },
        },
        update: {},
        create: {
          institution: base.institution,
          source: base.source,
          subjectArea: base.subjectArea,
          year,
          rank: Math.max(1, rank),
          percentile: base.percentile,
          freshnessDate: new Date(`${year}-06-01`),
        },
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log('seedBenchmarkingData: seeded', { peers: peerRows.length, peerSets: [thaiTop.name, aseanTop.name, 'Global CS'], rankings: rankingRows.length * rankingYears.length });
}

// ──────────────────────────────────────────────────────────────────────────
// Decision Workspace samples (prompt 12)
//
// 3 sample CouncilDecisions at different statuses (APPROVED,
// IN_IMPLEMENTATION, COMPLETED) + milestones + approvers + 1 completed
// OutcomeReview. Enough for Council to see the workspace on first boot.
// ──────────────────────────────────────────────────────────────────────────
async function seedDecisionSamples() {
  if ((await prisma.councilDecision.count()) > 0) {
    // eslint-disable-next-line no-console
    console.log('seedDecisionSamples: already seeded, skipping');
    return;
  }
  // Decisions used to be authored by ADMIN/COUNCIL/EXECUTIVE seed users.
  // Post legacy-removal: SUPER_ADMIN authors, UNIVERSITY_USER acts as the
  // council reviewer, SYSTEM_ADMIN as the executive sponsor.
  const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
  const council = await prisma.user.findFirst({ where: { role: 'UNIVERSITY_USER' }, select: { id: true } });
  const executive = await prisma.user.findFirst({ where: { role: 'SYSTEM_ADMIN' }, select: { id: true } });
  if (!admin || !council || !executive) {
    // eslint-disable-next-line no-console
    console.warn('seedDecisionSamples: need SUPER_ADMIN + UNIVERSITY_USER + SYSTEM_ADMIN users — skipping');
    return;
  }
  const programs = await prisma.program.findMany({ take: 6, select: { id: true, code: true, facultyId: true } });
  if (programs.length < 3) {
    // eslint-disable-next-line no-console
    console.warn('seedDecisionSamples: fewer than 3 programs seeded — skipping');
    return;
  }

  const today = new Date();
  const sevenMonthsAgo = new Date(today); sevenMonthsAgo.setMonth(today.getMonth() - 7);
  const twoMonthsAgo = new Date(today); twoMonthsAgo.setMonth(today.getMonth() - 2);

  // 1. IN_IMPLEMENTATION — recent decision with milestones.
  const inProg = await prisma.councilDecision.create({
    data: {
      userId: executive.id,
      title: 'ปรับโครงสร้างหลักสูตร Computer Engineering (ย่อย)',
      decisionType: 'RESTRUCTURE',
      affectedProgramIds: [programs[0]!.id],
      facultyId: programs[0]!.facultyId,
      rationaleTh: 'ปรับลดหน่วยกิตและเพิ่มโมดูล AI/Data เพื่อให้สอดคล้องกับทิศทางตลาดแรงงาน',
      effectiveDate: twoMonthsAgo,
      councilSessionRef: 'Council-2568/03',
      status: 'IN_IMPLEMENTATION',
    },
  });
  // Milestones.
  await prisma.decisionMilestone.createMany({
    data: [
      { decisionId: inProg.id, title: 'เสนอโครงร่างหลักสูตรใหม่ต่อสภาวิชาการ', status: 'DONE', orderIdx: 1, completedDate: twoMonthsAgo, ownerId: executive.id },
      { decisionId: inProg.id, title: 'สรรหาคณาจารย์ใหม่ 2 ท่าน', status: 'IN_PROGRESS', orderIdx: 2, ownerId: executive.id, targetDate: new Date(today.getFullYear(), today.getMonth() + 4, 1) },
      { decisionId: inProg.id, title: 'เปิดรับนักศึกษาในปีการศึกษาใหม่', status: 'PLANNED', orderIdx: 3, targetDate: new Date(today.getFullYear() + 1, 5, 1) },
    ],
  });
  await prisma.decisionApprover.createMany({
    data: [
      { decisionId: inProg.id, userId: council.id, role: 'approver', noteTh: 'เห็นควรดำเนินการ' },
      { decisionId: inProg.id, userId: executive.id, role: 'approver' },
    ],
  });

  // 2. COMPLETED — with outcome review at 6-month horizon.
  const completed = await prisma.councilDecision.create({
    data: {
      userId: executive.id,
      title: 'ควบรวมหลักสูตร Smart Electronics กับ CPE (ตัวอย่าง)',
      decisionType: 'MERGE',
      affectedProgramIds: programs.slice(1, 3).map((p) => p.id),
      facultyId: programs[1]!.facultyId,
      rationaleTh: 'เพื่อลดความซ้ำซ้อนของหลักสูตรและสร้างฐานทรัพยากรร่วม',
      effectiveDate: sevenMonthsAgo,
      councilSessionRef: 'Council-2568/01',
      status: 'COMPLETED',
    },
  });
  await prisma.decisionMilestone.createMany({
    data: [
      { decisionId: completed.id, title: 'เสนอและอนุมัติโดยสภา', status: 'DONE', orderIdx: 1, completedDate: sevenMonthsAgo },
      { decisionId: completed.id, title: 'ย้ายนักศึกษา cohort ปัจจุบัน', status: 'DONE', orderIdx: 2, completedDate: new Date(sevenMonthsAgo.getFullYear(), sevenMonthsAgo.getMonth() + 2, 15) },
      { decisionId: completed.id, title: 'ปิดรหัสหลักสูตรเก่า', status: 'DONE', orderIdx: 3, completedDate: new Date(sevenMonthsAgo.getFullYear(), sevenMonthsAgo.getMonth() + 3, 1) },
    ],
  });
  await prisma.decisionApprover.createMany({
    data: [
      { decisionId: completed.id, userId: council.id, role: 'approver' },
      { decisionId: completed.id, userId: executive.id, role: 'approver' },
      { decisionId: completed.id, userId: admin.id, role: 'observer' },
    ],
  });
  // Sample outcome review at 6 months — pre-filled so the Council sees
  // the shape without needing an AI call.
  await prisma.decisionOutcomeReview.create({
    data: {
      decisionId: completed.id,
      horizon: 'SIX_MONTHS',
      narrativeTh:
        'ผลการควบรวมหลังจาก 6 เดือนแสดงให้เห็นประหยัดค่าใช้จ่ายประมาณ 12% ตามที่คาดการณ์ไว้ ' +
        'นักศึกษาที่ย้ายมายังหลักสูตรรวมจำนวน 94% ของ cohort เดิม ' +
        'อย่างไรก็ตาม ยังพบความยากลำบากในการผสานแผนการเรียนข้าม 2 หลักสูตรเดิมอย่างราบรื่น ' +
        'บางรายวิชามีการทับซ้อนที่ยังไม่ได้ตัดออก',
      whatWorkedJson: {
        th: [
          'การประหยัดค่าใช้จ่ายประมาณ 12% ใกล้เคียงกับที่คาดการณ์ (14%)',
          'อัตรา retention ของนักศึกษาอยู่ที่ 94% (สูงกว่า baseline 90%)',
          'การใช้ห้องปฏิบัติการร่วมช่วยลด capex',
        ],
      },
      whatDidntWorkJson: {
        th: [
          'รายวิชาที่ทับซ้อนยังไม่ได้ตัดออกครบ ทำให้นักศึกษารู้สึก workload เพิ่ม',
          'แผนที่ปรึกษาวิชาการสับสนในช่วง 3 เดือนแรก',
        ],
      },
      lessonsJson: {
        th: [
          'การควบรวมที่มี cohort ใกล้จบควรมี transition plan เพิ่มเติมอย่างน้อย 1 เทอม',
          'ควรตรวจสอบ curriculum overlap ก่อนปิดรหัสหลักสูตรเก่า ไม่ใช่หลัง',
          'การประหยัดค่าใช้จ่ายจริงมักต่ำกว่าที่คาดการณ์ ~15% ให้เผื่อไว้',
        ],
      },
      methodologyVersion: 'outcome-review.v1',
    },
  });

  // 3. APPROVED (not yet in implementation).
  await prisma.councilDecision.create({
    data: {
      userId: executive.id,
      title: 'ปิดหลักสูตร Medical Technology (ตัวอย่าง)',
      decisionType: 'CLOSE',
      affectedProgramIds: [programs[3]?.id ?? programs[0]!.id],
      facultyId: programs[3]?.facultyId ?? programs[0]!.facultyId,
      rationaleTh: 'จำนวนผู้สมัครลดลงติดต่อกัน 5 ปี และตลาดแรงงานเริ่มอิ่มตัว',
      effectiveDate: new Date(today.getFullYear(), today.getMonth() + 3, 1),
      councilSessionRef: 'Council-2568/04',
      status: 'APPROVED',
    },
  });

  // eslint-disable-next-line no-console
  console.log('seedDecisionSamples: seeded 3 decisions + milestones + 1 outcome review');
}

// ─────────────────────────────────────────────────────────────────────────
// External AI sources (Phase 5) — catalog of intelligence feeds.
// Seeded in PAUSED state so the operator activates each one explicitly
// after deciding cadence + verifying any required env keys.
// Idempotent: upserts by slug, no destructive updates.
// ─────────────────────────────────────────────────────────────────────────
async function seedExternalAiSources() {
  const seeds = [
    {
      slug: 'wef-global-risks',
      name: 'World Economic Forum',
      description: 'WEF Global Risks Report, future-of-jobs publications, and weekly insights blog.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.7,
      cadenceCron: '0 8 * * 1',
      configJson: {
        urls: [
          'https://www.weforum.org/reports/global-risks-report-2026',
          'https://www.weforum.org/agenda/archive/jobs-and-the-future-of-work/',
        ],
      },
    },
    {
      slug: 'imd-competitiveness',
      name: 'IMD World Competitiveness',
      description: 'IMD World Competitiveness Center publications + news + research.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.65,
      cadenceCron: '0 8 1 * *',
      configJson: {
        urls: [
          'https://www.imd.org/centers/wcc/world-competitiveness-center/',
          'https://www.imd.org/news/',
          'https://www.imd.org/research-knowledge/',
        ],
      },
    },
    {
      slug: 'thailand-boi',
      name: 'Thailand BOI',
      description:
        'Thailand Board of Investment — English-language news + research reports. PAUSED by default: BOI now serves an Incapsula bot challenge to non-browser clients; needs headless-browser fetcher to harvest.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.6,
      cadenceCron: '0 8 * * 2',
      configJson: {
        urls: [
          'https://www.boi.go.th/en/news_business',
          'https://www.boi.go.th/index.php?page=research_report',
        ],
      },
    },
    {
      slug: 'world-bank-thailand',
      name: 'World Bank Thailand',
      description: 'World Bank Thailand country page — overview + Thailand-specific news.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.55,
      cadenceCron: '0 9 1 * *',
      configJson: {
        urls: [
          'https://www.worldbank.org/en/country/thailand/overview',
          'https://www.worldbank.org/en/news/all?qterm=Thailand&displayconttype_exact=News',
        ],
      },
    },
    {
      slug: 'oecd-education',
      name: 'OECD Education',
      description:
        'OECD education skills, higher-education, and labour-market policy publications. PAUSED by default — OECD CDN aggressively blocks non-browser fetches (TLS fingerprinting); requires a headless-browser fetcher to harvest. Switch to ACTIVE after headless support lands.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.6,
      cadenceCron: '0 9 1 * *',
      configJson: {
        urls: [
          'https://www.oecd.org/en/topics/policy-areas/education-and-skills.html',
        ],
      },
    },
    {
      slug: 'unesco-iesalc',
      name: 'UNESCO IESALC',
      description: 'UNESCO International Institute for Higher Education — policy briefs + global reports.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.55,
      cadenceCron: '0 9 1 * *',
      configJson: {
        urls: [
          'https://www.iesalc.unesco.org/en/publications/',
          'https://en.unesco.org/news/higher-education',
        ],
      },
    },
    {
      slug: 'mhesi-news',
      name: 'MHESI announcements',
      description: 'Thai Ministry of Higher Education, Science, Research and Innovation — policy notices, regulation, funding calls.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.7,
      cadenceCron: '0 9 * * *',
      configJson: {
        urls: [
          'https://www.mhesi.go.th/index.php/news.html',
          'https://www.mhesi.go.th/',
        ],
      },
    },
    {
      slug: 'asean-he',
      name: 'ASEAN University Network',
      description: 'ASEAN University Network — secretariat news + higher-education programmes. (Switched from asean.org which returns 307 to bot fetchers.)',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.5,
      cadenceCron: '0 9 1 * *',
      configJson: {
        urls: [
          'https://aunsec.org/news',
          'https://aunsec.org/',
        ],
      },
    },
    {
      slug: 'google-news-kku',
      name: 'Google News — KKU & Thai HE',
      description: 'Web-search seeded by KKU-relevant keywords — news about KKU, peer Thai universities, Thai higher-ed policy.',
      kind: 'WEB_SEARCH' as const,
      signalType: 'NEWS' as const,
      defaultImpact: 0.45,
      cadenceCron: '0 7 * * *',
      configJson: {
        queries: [
          'มหาวิทยาลัยขอนแก่น เปิดหลักสูตร',
          'หลักสูตรใหม่ มหาวิทยาลัยขอนแก่น',
          'Khon Kaen University new program',
          'Thailand higher education policy 2026',
        ],
        provider: 'google_cse',
        maxResultsPerQuery: 5,
      },
    },
  ];

  for (const s of seeds) {
    await prisma.externalAiSource.upsert({
      where: { slug: s.slug },
      create: {
        slug: s.slug,
        name: s.name,
        description: s.description,
        kind: s.kind,
        status: 'PAUSED',
        signalType: s.signalType,
        defaultImpact: s.defaultImpact,
        cadenceCron: s.cadenceCron,
        configJson: s.configJson,
      },
      update: {
        // Only refresh purely-cosmetic fields. Don't touch operator-
        // managed fields (status, cadenceCron, configJson) on re-seed.
        name: s.name,
        description: s.description,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`seedExternalAiSources: seeded ${seeds.length} sources (PAUSED by default)`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
