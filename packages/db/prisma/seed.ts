import { PrismaClient, ProgramLevel, ProgramStatus, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // ── Faculties ────────────────────────────────────────────────────────
  const facEng = await prisma.faculty.upsert({
    where: { code: 'EN' },
    update: {},
    create: { code: 'EN', nameTh: 'คณะวิศวกรรมศาสตร์', nameEn: 'Faculty of Engineering' },
  });
  const facSci = await prisma.faculty.upsert({
    where: { code: 'SC' },
    update: {},
    create: { code: 'SC', nameTh: 'คณะวิทยาศาสตร์', nameEn: 'Faculty of Science' },
  });
  const facMed = await prisma.faculty.upsert({
    where: { code: 'MD' },
    update: {},
    create: { code: 'MD', nameTh: 'คณะแพทยศาสตร์', nameEn: 'Faculty of Medicine' },
  });

  // ── Departments (2 per faculty) ──────────────────────────────────────
  const deptCpe = await prisma.department.upsert({
    where: { code: 'EN-CPE' },
    update: {},
    create: {
      code: 'EN-CPE',
      nameTh: 'ภาควิชาวิศวกรรมคอมพิวเตอร์',
      nameEn: 'Department of Computer Engineering',
      facultyId: facEng.id,
    },
  });
  const deptEe = await prisma.department.upsert({
    where: { code: 'EN-EE' },
    update: {},
    create: {
      code: 'EN-EE',
      nameTh: 'ภาควิชาวิศวกรรมไฟฟ้า',
      nameEn: 'Department of Electrical Engineering',
      facultyId: facEng.id,
    },
  });
  const deptCs = await prisma.department.upsert({
    where: { code: 'SC-CS' },
    update: {},
    create: {
      code: 'SC-CS',
      nameTh: 'ภาควิชาวิทยาการคอมพิวเตอร์',
      nameEn: 'Department of Computer Science',
      facultyId: facSci.id,
    },
  });
  const deptMath = await prisma.department.upsert({
    where: { code: 'SC-MA' },
    update: {},
    create: {
      code: 'SC-MA',
      nameTh: 'ภาควิชาคณิตศาสตร์',
      nameEn: 'Department of Mathematics',
      facultyId: facSci.id,
    },
  });
  const deptInt = await prisma.department.upsert({
    where: { code: 'MD-INT' },
    update: {},
    create: {
      code: 'MD-INT',
      nameTh: 'ภาควิชาอายุรศาสตร์',
      nameEn: 'Department of Internal Medicine',
      facultyId: facMed.id,
    },
  });
  const deptPed = await prisma.department.upsert({
    where: { code: 'MD-PED' },
    update: {},
    create: {
      code: 'MD-PED',
      nameTh: 'ภาควิชากุมารเวชศาสตร์',
      nameEn: 'Department of Pediatrics',
      facultyId: facMed.id,
    },
  });

  // ── Programs (~10) ───────────────────────────────────────────────────
  const programs: Array<{
    code: string;
    nameTh: string;
    nameEn: string;
    facultyId: string;
    departmentId?: string;
    level: ProgramLevel;
    status?: ProgramStatus;
    yearEstablished?: number;
  }> = [
    {
      code: 'EN-CPE-BSC',
      nameTh: 'วิศวกรรมคอมพิวเตอร์',
      nameEn: 'Computer Engineering',
      facultyId: facEng.id,
      departmentId: deptCpe.id,
      level: ProgramLevel.BACHELOR,
      yearEstablished: 1990,
    },
    {
      code: 'EN-CPE-MSC',
      nameTh: 'วิศวกรรมคอมพิวเตอร์ (มหาบัณฑิต)',
      nameEn: 'Computer Engineering (Master)',
      facultyId: facEng.id,
      departmentId: deptCpe.id,
      level: ProgramLevel.MASTER,
      yearEstablished: 2001,
    },
    {
      code: 'EN-EE-BSC',
      nameTh: 'วิศวกรรมไฟฟ้า',
      nameEn: 'Electrical Engineering',
      facultyId: facEng.id,
      departmentId: deptEe.id,
      level: ProgramLevel.BACHELOR,
      yearEstablished: 1985,
    },
    {
      code: 'SC-CS-BSC',
      nameTh: 'วิทยาการคอมพิวเตอร์',
      nameEn: 'Computer Science',
      facultyId: facSci.id,
      departmentId: deptCs.id,
      level: ProgramLevel.BACHELOR,
      yearEstablished: 1995,
    },
    {
      code: 'SC-CS-MSC',
      nameTh: 'วิทยาการคอมพิวเตอร์ (มหาบัณฑิต)',
      nameEn: 'Computer Science (Master)',
      facultyId: facSci.id,
      departmentId: deptCs.id,
      level: ProgramLevel.MASTER,
      yearEstablished: 2005,
    },
    {
      code: 'SC-MA-BSC',
      nameTh: 'คณิตศาสตร์',
      nameEn: 'Mathematics',
      facultyId: facSci.id,
      departmentId: deptMath.id,
      level: ProgramLevel.BACHELOR,
      yearEstablished: 1978,
    },
    {
      code: 'SC-MA-PHD',
      nameTh: 'คณิตศาสตร์ (ดุษฎีบัณฑิต)',
      nameEn: 'Mathematics (Doctoral)',
      facultyId: facSci.id,
      departmentId: deptMath.id,
      level: ProgramLevel.DOCTORAL,
      status: ProgramStatus.PAUSED,
      yearEstablished: 2010,
    },
    {
      code: 'MD-MBBS',
      nameTh: 'แพทยศาสตรบัณฑิต',
      nameEn: 'Doctor of Medicine',
      facultyId: facMed.id,
      departmentId: deptInt.id,
      level: ProgramLevel.BACHELOR,
      yearEstablished: 1972,
    },
    {
      code: 'MD-INT-PHD',
      nameTh: 'อายุรศาสตร์ (ดุษฎีบัณฑิต)',
      nameEn: 'Internal Medicine (Doctoral)',
      facultyId: facMed.id,
      departmentId: deptInt.id,
      level: ProgramLevel.DOCTORAL,
      yearEstablished: 2008,
    },
    {
      code: 'MD-PED-MSC',
      nameTh: 'กุมารเวชศาสตร์ (มหาบัณฑิต)',
      nameEn: 'Pediatrics (Master)',
      facultyId: facMed.id,
      departmentId: deptPed.id,
      level: ProgramLevel.MASTER,
      yearEstablished: 2003,
    },
  ];

  for (const p of programs) {
    await prisma.program.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
  }

  // ── Users (dev-only local credentials) ───────────────────────────────
  await prisma.user.upsert({
    where: { email: 'admin@kku.ac.th' },
    update: {},
    create: {
      email: 'admin@kku.ac.th',
      name: 'Admin',
      role: UserRole.ADMIN,
    },
  });
  await prisma.user.upsert({
    where: { email: 'council@kku.ac.th' },
    update: {},
    create: {
      email: 'council@kku.ac.th',
      name: 'Council Member',
      role: UserRole.COUNCIL,
    },
  });
  await prisma.user.upsert({
    where: { email: 'dean.en@kku.ac.th' },
    update: {},
    create: {
      email: 'dean.en@kku.ac.th',
      name: 'Dean of Engineering',
      role: UserRole.DEAN,
      facultyId: facEng.id,
    },
  });
  await prisma.user.upsert({
    where: { email: 'dh.cpe@kku.ac.th' },
    update: {},
    create: {
      email: 'dh.cpe@kku.ac.th',
      name: 'Head of Computer Engineering',
      role: UserRole.DEPT_HEAD,
      facultyId: facEng.id,
      departmentId: deptCpe.id,
    },
  });

  // eslint-disable-next-line no-console
  console.log('seed complete: 3 faculties, 6 departments, 10 programs, 4 users');
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
