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

  // ── Trend signals (30+ across 5 types × sectors) ───────────────────────
  // Real signals land via the monitor jobs in apps/ingestion once
  // connectors are wired to real upstreams (prompt 14). These seeds
  // make /trends and the deep-dive trend-exposure section useful on
  // first boot.
  const allPrograms = await prisma.program.findMany({ select: { id: true, nameEn: true } });
  // Pick 3 target programs for targeted signals (so deep-dive surfaces).
  const targetPrograms = allPrograms.slice(0, 3).map((p) => p.id);

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  type SignalSeed = {
    signalType: 'POLICY' | 'RESEARCH' | 'MARKET' | 'TECH' | 'NEWS';
    title: string;
    summaryTh: string;
    summaryEn: string;
    sourceUrl: string;
    detectedDate: Date;
    impactScore: number;
    affectedProgramIds: string[];
    affectedSkillIds: string[];
  };

  const trendSignalSeeds: SignalSeed[] = [
    // ── POLICY ──────────────────────────────────────────────────────────
    {
      signalType: 'POLICY',
      title: 'MHESI pushes Thailand 4.0 re-skilling mandate for engineering programs',
      summaryTh: 'กระทรวงการอุดมศึกษาฯ ประกาศแนวทางการปรับหลักสูตรวิศวกรรมทั้ง 10 สาขาให้สอดคล้องกับยุทธศาสตร์ Thailand 4.0 ภายในปี 2570 — กระทบคณะวิศวะโดยตรง',
      summaryEn: 'MHESI announces curriculum alignment mandate for 10 engineering fields under Thailand 4.0 by 2027 — direct impact on engineering faculty.',
      sourceUrl: 'https://example.mhesi.go.th/announcements/2026-04-thailand-40',
      detectedDate: daysAgo(3),
      impactScore: 0.85,
      affectedProgramIds: targetPrograms.slice(0, 2),
      affectedSkillIds: [],
    },
    {
      signalType: 'POLICY',
      title: 'NESDC 13th National Plan emphasises bio-economy university investment',
      summaryTh: 'แผนพัฒนาฯ ฉบับที่ 13 จัดสรรงบประมาณเพิ่มเติมให้มหาวิทยาลัยที่มีหลักสูตรด้านเศรษฐกิจชีวภาพ',
      summaryEn: 'NESDC 13th National Plan allocates additional university funding for bio-economy programmes through 2027.',
      sourceUrl: 'https://example.nesdc.go.th/13th-plan',
      detectedDate: daysAgo(5),
      impactScore: 0.72,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'POLICY',
      title: 'NXPO raises research-publication quota for top-tier programmes',
      summaryTh: 'สำนักงานสภานโยบายฯ ปรับตัวชี้วัดการวิจัยใหม่ — หลักสูตรระดับ T5 ต้องเพิ่มจำนวน publications/faculty-year',
      summaryEn: 'NXPO raises the research-publication-per-faculty-year quota for T5-ranked programmes, effective FY2027.',
      sourceUrl: 'https://example.nxpo.or.th/strategy-2026',
      detectedDate: daysAgo(12),
      impactScore: 0.58,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'POLICY',
      title: 'BOI expands tax incentives for S-curve-aligned R&D partnerships',
      summaryTh: 'BOI ขยายสิทธิประโยชน์ทางภาษีสำหรับความร่วมมือวิจัยกับสถาบันการศึกษาในกลุ่ม S-curve — โอกาสสำหรับ มข.',
      summaryEn: 'BOI expands tax incentives for university-industry R&D partnerships in S-curve sectors — revenue opportunity for KKU.',
      sourceUrl: 'https://example.boi.go.th/s-curve-2026',
      detectedDate: daysAgo(18),
      impactScore: 0.65,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'POLICY',
      title: 'EECO workforce plan projects 120k engineering shortfall by 2030',
      summaryTh: 'สำนักงานนโยบาย EECO ประเมินว่าภาคอุตสาหกรรมจะขาดแคลนวิศวกร 120,000 คน ภายในปี 2573',
      summaryEn: 'EECO workforce plan projects a 120,000-engineer shortfall in the Eastern Economic Corridor by 2030.',
      sourceUrl: 'https://example.eeco.or.th/workforce-2030',
      detectedDate: daysAgo(22),
      impactScore: 0.68,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'POLICY',
      title: 'MHESI-CISA accreditation cycle shortened 5→3 years for tech programmes',
      summaryTh: 'CISA ประกาศย่นรอบการตรวจรับประกันคุณภาพจาก 5 เป็น 3 ปี สำหรับหลักสูตรเทคโนโลยี',
      summaryEn: 'MHESI-CISA shortens the accreditation review cycle from 5 to 3 years for technology programmes.',
      sourceUrl: 'https://example.mhesi.go.th/cisa/2026-04',
      detectedDate: daysAgo(25),
      impactScore: 0.55,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },

    // ── RESEARCH ────────────────────────────────────────────────────────
    {
      signalType: 'RESEARCH',
      title: 'Federated learning breakthrough shifts healthcare IoT landscape',
      summaryTh: 'งานวิจัยใหม่ใน Nature แสดงให้เห็นว่า federated learning สามารถนำไปใช้ในระบบ IoT ด้านสาธารณสุขได้จริง',
      summaryEn: 'A Nature paper demonstrates practical deployment of federated learning in healthcare IoT at scale.',
      sourceUrl: 'https://example.nature.com/federated-learning-2026',
      detectedDate: daysAgo(2),
      impactScore: 0.78,
      affectedProgramIds: targetPrograms.slice(0, 1),
      affectedSkillIds: [],
    },
    {
      signalType: 'RESEARCH',
      title: 'OpenAlex clusters surge in carbon-capture biotechnology papers',
      summaryTh: 'OpenAlex ตรวจพบการเพิ่มขึ้นอย่างมีนัยสำคัญของงานวิจัยด้าน carbon-capture biotech — โอกาสของ มข. ในคลัสเตอร์ bio-economy',
      summaryEn: 'OpenAlex detects surge in carbon-capture biotechnology research — opportunity in KKU bio-economy cluster.',
      sourceUrl: 'https://example.openalex.org/clusters/carbon-biotech',
      detectedDate: daysAgo(8),
      impactScore: 0.62,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'RESEARCH',
      title: 'Precision-agriculture GIS + LLM integration emerges as active research theme',
      summaryTh: 'งานวิจัยใหม่บูรณาการ GIS แม่นยำและ LLM เพื่อการเกษตรแม่นยำในเอเชียตะวันออกเฉียงใต้',
      summaryEn: 'Emerging research integrates precision-agriculture GIS with LLM-based recommendation systems across SE Asia.',
      sourceUrl: 'https://example.arxiv.org/gis-llm-agri-2026',
      detectedDate: daysAgo(14),
      impactScore: 0.55,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'RESEARCH',
      title: 'Scopus flags 40% YoY growth in Thai-language NLP publications',
      summaryTh: 'Scopus รายงานการเติบโต 40% ต่อปีของสิ่งพิมพ์ NLP ภาษาไทย — เชิงกลยุทธ์ต่อหลักสูตรคอมพิวเตอร์',
      summaryEn: 'Scopus reports 40% YoY growth in Thai-language NLP publications — strategic for computing programmes.',
      sourceUrl: 'https://example.scopus.com/thai-nlp-trends',
      detectedDate: daysAgo(21),
      impactScore: 0.60,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'RESEARCH',
      title: 'Cross-institution Mekong food-safety research consortium announced',
      summaryTh: 'มหาวิทยาลัยใน 5 ประเทศลุ่มน้ำโขงจัดตั้งกลุ่มวิจัยความปลอดภัยอาหาร — ช่องทางความร่วมมือสำหรับ มข.',
      summaryEn: 'Five Mekong-basin universities announce food-safety research consortium — collaboration channel for KKU.',
      sourceUrl: 'https://example.mekongconsortium.org/announce',
      detectedDate: daysAgo(28),
      impactScore: 0.48,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },

    // ── MARKET ──────────────────────────────────────────────────────────
    {
      signalType: 'MARKET',
      title: 'JobThai posting volume for data-engineering roles +35% in Q1',
      summaryTh: 'JobThai รายงานยอดประกาศงาน Data Engineer เพิ่มขึ้น 35% ในไตรมาส 1 — สะท้อนความต้องการที่เพิ่มขึ้น',
      summaryEn: 'JobThai reports 35% QoQ growth in data engineering job postings — strong demand signal for curriculum alignment.',
      sourceUrl: 'https://example.jobthai.com/market-report-q1',
      detectedDate: daysAgo(7),
      impactScore: 0.72,
      affectedProgramIds: targetPrograms.slice(1, 3),
      affectedSkillIds: [],
    },
    {
      signalType: 'MARKET',
      title: 'NSO labor force survey: skilled-agriculture wages outpace urban tech 3 yrs running',
      summaryTh: 'สำนักสถิติแห่งชาติรายงานว่า ค่าจ้างภาคเกษตรแบบใช้ทักษะสูง เพิ่มสูงกว่างาน tech ในเมือง 3 ปีซ้อน',
      summaryEn: 'NSO survey: skilled-agriculture wages have outpaced urban tech wages for 3 consecutive years in NE Thailand.',
      sourceUrl: 'https://example.nso.go.th/lfs-q1-2026',
      detectedDate: daysAgo(11),
      impactScore: 0.68,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'MARKET',
      title: 'Industrial-automation skills gap widens in Northeast Thailand',
      summaryTh: 'ช่องว่างทักษะด้านระบบอัตโนมัติอุตสาหกรรมในภาคตะวันออกเฉียงเหนือขยายตัว — โอกาสสำหรับหลักสูตรเมคคาทรอนิกส์',
      summaryEn: 'Industrial-automation skills gap widens in Northeast Thailand — opportunity for mechatronics curricula.',
      sourceUrl: 'https://example.jobsdb.com/regional-report',
      detectedDate: daysAgo(16),
      impactScore: 0.58,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'MARKET',
      title: 'Medical-device industry salary premium narrows vs. pharma',
      summaryTh: 'ส่วนต่างเงินเดือนระหว่างอุตสาหกรรม medical device และ pharma แคบลง — ส่งสัญญาณตลาด',
      summaryEn: 'Salary premium between medical-device and pharmaceutical industries narrows — market-signal for health programmes.',
      sourceUrl: 'https://example.jobsdb.com/med-device-pharma',
      detectedDate: daysAgo(20),
      impactScore: 0.42,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'MARKET',
      title: 'Global EV supply chain shifts create Thai manufacturing demand',
      summaryTh: 'การย้ายห่วงโซ่อุปทานรถยนต์ไฟฟ้าสร้างความต้องการด้านการผลิตในไทย',
      summaryEn: 'Global EV supply chain re-shoring creates demand for Thai mechatronics + manufacturing skills.',
      sourceUrl: 'https://example.boi.go.th/ev-supply-chain',
      detectedDate: daysAgo(24),
      impactScore: 0.76,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },

    // ── TECH ────────────────────────────────────────────────────────────
    {
      signalType: 'TECH',
      title: 'Claude Opus 4.7 extends context to 1M tokens — curriculum implications',
      summaryTh: 'Anthropic เปิดตัวโมเดล Claude 4.7 ขยายบริบทเป็น 1 ล้าน tokens — กระทบการสอนวิทยาการคอมพิวเตอร์',
      summaryEn: 'Anthropic releases Claude Opus 4.7 with 1M-token context — curriculum impact on CS / NLP programmes.',
      sourceUrl: 'https://example.anthropic.com/claude-4-7',
      detectedDate: daysAgo(4),
      impactScore: 0.65,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'TECH',
      title: 'Open-source Thai NLP toolkit reaches production-grade accuracy',
      summaryTh: 'เครื่องมือ NLP ภาษาไทยแบบ open-source พัฒนาถึงความแม่นยำระดับ production — โอกาสสอนและวิจัย',
      summaryEn: 'Open-source Thai NLP toolkit reaches production-grade accuracy — teaching and research opportunity.',
      sourceUrl: 'https://example.github.com/thai-nlp-2026',
      detectedDate: daysAgo(9),
      impactScore: 0.52,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'TECH',
      title: 'Affordable soil-sensor kits drop under $50 — precision-agri curriculum shift',
      summaryTh: 'เซ็นเซอร์ดินราคาประหยัดต่ำกว่า $50 — เอื้อต่อการเรียนการสอนเกษตรแม่นยำ',
      summaryEn: 'Affordable soil-sensor kits drop below $50 — enables hands-on precision-agriculture curricula.',
      sourceUrl: 'https://example.hackster.io/soil-sensor-2026',
      detectedDate: daysAgo(15),
      impactScore: 0.40,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'TECH',
      title: '5G-Advanced rollout accelerates edge-computing use cases',
      summaryTh: 'การเปิดตัว 5G-Advanced เร่งการใช้งาน edge computing — โอกาสสำหรับหลักสูตรเครือข่าย',
      summaryEn: '5G-Advanced rollout accelerates edge-computing use cases — opportunity for networking programmes.',
      sourceUrl: 'https://example.gsmarena.com/5g-advanced',
      detectedDate: daysAgo(19),
      impactScore: 0.45,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'TECH',
      title: 'Quantum-computing startup launches Thai-language course',
      summaryTh: 'บริษัทสตาร์ทอัพด้าน quantum computing เปิดหลักสูตรภาษาไทย — สัญญาณความพร้อมของตลาด',
      summaryEn: 'Quantum computing startup launches Thai-language course — signal of market readiness.',
      sourceUrl: 'https://example.qedtech.co.th',
      detectedDate: daysAgo(26),
      impactScore: 0.35,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },

    // ── NEWS ────────────────────────────────────────────────────────────
    {
      signalType: 'NEWS',
      title: 'Chulalongkorn launches new "Data Science + Thai Society" programme',
      summaryTh: 'จุฬาลงกรณ์ฯ เปิดตัวหลักสูตร Data Science + สังคมไทย — กระทบการแข่งขันตลาดการศึกษา',
      summaryEn: 'Chulalongkorn launches Data Science + Thai Society programme — competitive pressure on peer offerings.',
      sourceUrl: 'https://example.chula.ac.th/data-science-thai-society',
      detectedDate: daysAgo(6),
      impactScore: 0.58,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'NEWS',
      title: 'Thammasat partners with Deloitte on AI-audit curriculum',
      summaryTh: 'ธรรมศาสตร์ร่วมมือกับ Deloitte พัฒนาหลักสูตร AI audit',
      summaryEn: 'Thammasat partners with Deloitte on AI-audit curriculum — peer-program competitive signal.',
      sourceUrl: 'https://example.tu.ac.th/deloitte-ai-audit',
      detectedDate: daysAgo(13),
      impactScore: 0.45,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'NEWS',
      title: 'Mahidol expands telemedicine fellowship 30% — nursing workforce impact',
      summaryTh: 'มหิดลขยายโครงการ telemedicine 30% — กระทบการผลิตบุคลากรการพยาบาล',
      summaryEn: 'Mahidol expands telemedicine fellowship by 30% — nursing workforce implications region-wide.',
      sourceUrl: 'https://example.mahidol.ac.th/telemedicine-expansion',
      detectedDate: daysAgo(17),
      impactScore: 0.50,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'NEWS',
      title: 'KKU alumnus leads breakthrough in Thai-language language model',
      summaryTh: 'ศิษย์เก่า มข. นำความสำเร็จในการพัฒนาโมเดลภาษาไทย — โอกาสสร้างความร่วมมือ',
      summaryEn: 'KKU alumnus leads breakthrough in Thai-language LLM — alumni + research partnership opportunity.',
      sourceUrl: 'https://example.kku-news.example/thai-llm-2026',
      detectedDate: daysAgo(1),
      impactScore: 0.38,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'NEWS',
      title: 'Isaan smart-agriculture cooperative expands to 500 farms',
      summaryTh: 'สหกรณ์เกษตรอัจฉริยะภาคอีสานขยายถึง 500 ฟาร์ม — โอกาสสร้างความร่วมมือกับหลักสูตรเกษตร',
      summaryEn: 'Isaan smart-agriculture cooperative expands to 500 farms — opportunity for agriculture program partnerships.',
      sourceUrl: 'https://example.isaan-agri.co.th',
      detectedDate: daysAgo(23),
      impactScore: 0.48,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'NEWS',
      title: 'ASEAN skills mobility framework enters pilot phase',
      summaryTh: 'กรอบการเคลื่อนย้ายทักษะระหว่างประเทศอาเซียนเริ่มนำร่อง — กระทบการรับรองปริญญา',
      summaryEn: 'ASEAN skills-mobility framework enters pilot — qualifications-recognition impact for programmes.',
      sourceUrl: 'https://example.asean.org/skills-mobility-pilot',
      detectedDate: daysAgo(29),
      impactScore: 0.52,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'NEWS',
      title: 'Thai Cabinet approves new digital-economy roadmap for 2027-2032',
      summaryTh: 'ครม. อนุมัติแผนเศรษฐกิจดิจิทัล 2570-2575 — กรอบนโยบายใหญ่',
      summaryEn: 'Thai Cabinet approves digital-economy roadmap 2027-2032 — high-level policy framing for strategy work.',
      sourceUrl: 'https://example.thaigov.go.th/digital-economy-2032',
      detectedDate: daysAgo(10),
      impactScore: 0.62,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
    {
      signalType: 'NEWS',
      title: 'Khon Kaen province launches industrial corridor initiative',
      summaryTh: 'จังหวัดขอนแก่นเปิดตัวโครงการเขตอุตสาหกรรม — โอกาสเชิงกลยุทธ์สำหรับ มข.',
      summaryEn: 'Khon Kaen province launches industrial corridor initiative — strategic opportunity for KKU partnerships.',
      sourceUrl: 'https://example.khonkaen.go.th/corridor-2026',
      detectedDate: daysAgo(27),
      impactScore: 0.58,
      affectedProgramIds: [],
      affectedSkillIds: [],
    },
  ];

  // Make title unique-ish by prefix so repeated seed runs upsert.
  for (const s of trendSignalSeeds) {
    const existing = await prisma.trendSignal.findFirst({ where: { title: s.title } });
    if (existing) continue;
    await prisma.trendSignal.create({
      data: {
        signalType: s.signalType,
        title: s.title,
        summaryTh: s.summaryTh,
        summaryEn: s.summaryEn,
        sourceUrl: s.sourceUrl,
        detectedDate: s.detectedDate,
        impactScore: s.impactScore,
        affectedProgramIds: s.affectedProgramIds,
        affectedSkillIds: s.affectedSkillIds,
      },
    });
  }

  // ── Data sources (inventory seed — catalog lives in @kku/shared) ────────
  // The connector registry in apps/ingestion looks up its DataSource row
  // by slug at boot. Keep this in sync with SOURCE_CATALOG in
  // packages/shared/src/ingestion/catalog.ts — `pnpm db:seed` writes from
  // that one list, so there is no drift.
  const { SOURCE_CATALOG } = await import('@kku/shared');
  for (const entry of SOURCE_CATALOG) {
    await prisma.dataSource.upsert({
      where: { slug: entry.slug },
      update: {
        name: entry.name,
        kind: entry.kind,
        inputFormat: entry.inputFormat,
        acceptsPdfUploads: entry.acceptsPdfUploads ?? false,
        baseUrl: entry.baseUrl ?? null,
        cadenceCron: entry.cadenceCron ?? null,
        ownerContact: entry.ownerContact ?? null,
        notes: entry.notes ?? null,
      },
      create: {
        slug: entry.slug,
        name: entry.name,
        kind: entry.kind,
        inputFormat: entry.inputFormat,
        acceptsPdfUploads: entry.acceptsPdfUploads ?? false,
        baseUrl: entry.baseUrl ?? null,
        cadenceCron: entry.cadenceCron ?? null,
        scheduleEnabled: entry.scheduleEnabled ?? true,
        ownerContact: entry.ownerContact ?? null,
        notes: entry.notes ?? null,
        status: entry.mocked ? 'mocked' : 'active',
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
    kkuOrgMappings: await prisma.kkuOrgCodeMapping.count(),
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
