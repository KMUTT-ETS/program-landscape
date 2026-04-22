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
// 1. Faculties (5) and Departments (12)
// ──────────────────────────────────────────────────────────────────────────

const FACULTIES = [
  { code: 'EN', nameTh: 'คณะวิศวกรรมศาสตร์', nameEn: 'Faculty of Engineering' },
  { code: 'SC', nameTh: 'คณะวิทยาศาสตร์', nameEn: 'Faculty of Science' },
  { code: 'MD', nameTh: 'คณะแพทยศาสตร์', nameEn: 'Faculty of Medicine' },
  { code: 'HU', nameTh: 'คณะมนุษยศาสตร์และสังคมศาสตร์', nameEn: 'Faculty of Humanities and Social Sciences' },
  { code: 'BS', nameTh: 'คณะบริหารธุรกิจและการบัญชี', nameEn: 'Faculty of Business Administration and Accountancy' },
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
  { email: 'viewer@kku.ac.th',    name: 'Viewer User',                  role: 'VIEWER' },
  { email: 'council@kku.ac.th',   name: 'Council Member',               role: 'COUNCIL' },
  { email: 'exec@kku.ac.th',      name: 'Executive Officer',            role: 'EXECUTIVE' },
  { email: 'dean.en@kku.ac.th',   name: 'Dean of Engineering',          role: 'DEAN',     facultyCode: 'EN' },
  { email: 'dh.cpe@kku.ac.th',    name: 'Head of Computer Engineering', role: 'DEPT_HEAD', facultyCode: 'EN', departmentCode: 'EN-CPE' },
  { email: 'analyst@kku.ac.th',   name: 'Institutional Analyst',        role: 'ANALYST' },
  { email: 'admin@kku.ac.th',     name: 'Admin',                        role: 'ADMIN' },
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

  // ── Faculties ───────────────────────────────────────────────────────────
  const facultyByCode = new Map<string, { id: string }>();
  for (const f of FACULTIES) {
    const row = await prisma.faculty.upsert({
      where: { code: f.code },
      update: {},
      create: { code: f.code, nameTh: f.nameTh, nameEn: f.nameEn },
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

  // ── Programs ────────────────────────────────────────────────────────────
  const programByCode = new Map<
    string,
    { id: string; facultyId: string; departmentId: string | null }
  >();
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
  const skills = buildSkills();
  for (const s of skills) {
    await prisma.skill.upsert({
      where: { code: s.code },
      update: {},
      create: s,
    });
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

  // ── Faculty members (5 per department) + ProgramFaculty assignments ─────
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

  // ── Enrollment + Financial + Graduate outcomes for 3 years ──────────────
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

  // ── PDF documents (5 mock) ──────────────────────────────────────────────
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

  // ── Job postings (50) ───────────────────────────────────────────────────
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

  // ── Data sources (inventory seed — real wiring in prompt 14) ────────────
  const sourceFixtures: Array<{
    name: string;
    kind: DataSourceKind;
    acceptsPdfUploads?: boolean;
  }> = [
    { name: 'KKU REG',           kind: 'API' },
    { name: 'KKU Finance',       kind: 'API' },
    { name: 'MHESI-CISA',        kind: 'API', acceptsPdfUploads: true },
    { name: 'MHESI Policies',    kind: 'PDF', acceptsPdfUploads: true },
    { name: 'NESDC Reports',     kind: 'PDF', acceptsPdfUploads: true },
    { name: 'NSO Labor Force',   kind: 'PDF', acceptsPdfUploads: true },
    { name: 'JobsDB',            kind: 'API' },
    { name: 'JobThai',           kind: 'API' },
    { name: 'OpenAlex',          kind: 'API' },
  ];
  for (const ds of sourceFixtures) {
    await prisma.dataSource.upsert({
      where: { name: ds.name },
      update: {},
      create: {
        name: ds.name,
        kind: ds.kind,
        acceptsPdfUploads: ds.acceptsPdfUploads ?? false,
        status: 'pending',
      },
    });
  }

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
    dataSources: await prisma.dataSource.count(),
  };
  // eslint-disable-next-line no-console
  console.log('seed complete:', counts);
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
