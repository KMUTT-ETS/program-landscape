#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Refresh ClassOffering + ClassOfferingTeacher from the registrar's
// POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER view.
//
// One row per CLASSID = one course-section opened in a (year, semester).
// 121k rows over BE 2565–2569. The view is the registrar's authoritative
// class-offering list with the teaching staff (KKUMAIL) attached.
//
// Per-CLASSID teacher rows: KKUMAIL is comma-separated with historical
// duplicates → we take distinct lowercased emails before inserting.
//
// Faculty resolution: FACULTYNAME (Thai) exact-match against Faculty.nameTh.
// Unresolved rows still land with `facultyId = NULL` for analyst triage.
//
// Teacher → FacultyMember resolution: bulk UPDATE join against
// `FacultyMember.kkuEmail` (lowercased). Unmatched emails stay
// `facultyMemberId = NULL` (external lecturers, retired staff, HCM gaps).
//
// Garbage filtered: LEVELNAME 'ทดสอบ' / 'ไม่กำหนด',
// FACULTYNAME 'ข้อมูลเดิม', NULL COURSECODE.
//
// Idempotent — full delete-and-replace inside one transaction.
//
// Usage:
//   pnpm programs:link-class-offerings              # apply
//   pnpm programs:link-class-offerings --dry-run    # preview counts only
//   pnpm programs:link-class-offerings --since-year=2567   # bachelor/etc only
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

import { prisma, Prisma } from '@kku/db';
import { withScriptRun } from '../lib/script-run';
import {
  withConnection as oracleWithConnection,
  configFromEnv as oracleConfigFromEnv,
} from '../lib/oracle-client';
import { normaliseCourseCode, parseCourseUnit, isGeneralEd, splitKkuMail } from '../lib/course-code';

// LEVELNAME values worth ingesting. The view also carries 'ทดสอบ' (test)
// and 'ไม่กำหนด' (unspecified) which we drop at SQL level. Everything
// else — bachelor / master / doctoral / higher-grad-diploma, regular /
// special / international / English-medium — is kept. The connector
// stores LEVELNAME verbatim so the UI can render Thai labels directly.
const EXCLUDED_LEVEL_NAMES = ['ทดสอบ', 'ไม่กำหนด'];
const EXCLUDED_FACULTY_NAMES = ['ข้อมูลเดิม'];

interface ViewRow {
  ACADYEAR: number;
  SEMESTER: number;
  COURSECODE: string;
  SECTION: number;
  CLASSID: number;
  COURSENAME: string | null;
  COURSENAMEENG: string | null;
  CREDITTOTAL: number | null;
  COURSEUNIT: string | null;
  ENROLLSEAT: number;
  TOTALSEAT: number;
  LEVELNAME: string;
  FACULTYID: string | number;
  FACULTYNAME: string;
  KKUMAIL: string | null;
  // Grade-distribution columns (added to the view; default 0 in older
  // rows where the registrar hadn't reported yet).
  A: number;
  BPLUS: number;
  B: number;
  CPLUS: number;
  C: number;
  DPLUS: number;
  D: number;
  F: number;
  I: number;
  W: number;
  AU: number;
  S: number;
}

// KKU 4.0 GPA weights. Single source of truth — duplicated in
// docs/methodologies/class-gpa.md if values ever change.
const GPA_WEIGHTS = {
  A: 4.0,
  BPLUS: 3.5,
  B: 3.0,
  CPLUS: 2.5,
  C: 2.0,
  DPLUS: 1.5,
  D: 1.0,
  F: 0.0,
} as const;

interface CliArgs {
  apply: boolean;
  /** Only ingest rows with ACADYEAR >= this BE year. Speeds up dev runs. */
  sinceYear: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  const apply = !argv.includes('--dry-run');
  const sinceArg = argv.find((a) => a.startsWith('--since-year='));
  const sinceYear = sinceArg ? parseInt(sinceArg.split('=')[1] ?? '0', 10) : null;
  return { apply, sinceYear };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}${args.sinceYear ? ` · since BE ${args.sinceYear}` : ''}`);

  await withScriptRun('kku-registry', async ({ runId, setRecordsLoaded }) => {
    // ── Pre-flight: load faculty Thai-name → id lookup ─────────────
    const faculties = await prisma.faculty.findMany({
      select: { id: true, nameTh: true },
    });
    const facultyByName = new Map<string, string>();
    for (const f of faculties) facultyByName.set(f.nameTh.trim(), f.id);
    console.log(`Pre-flight: ${faculties.length} faculties loaded for name resolution.`);

    // ── Fetch from Oracle ──────────────────────────────────────────
    const yearClause = args.sinceYear ? `AND ACADYEAR >= ${args.sinceYear}` : '';
    const sql = `
      SELECT
        ACADYEAR, SEMESTER, COURSECODE, SECTION, CLASSID,
        COURSENAME, COURSENAMEENG,
        CREDITTOTAL, COURSEUNIT, ENROLLSEAT, TOTALSEAT,
        LEVELNAME, FACULTYID, FACULTYNAME, KKUMAIL,
        A, BPLUS, B, CPLUS, C, DPLUS, D, F, I, W, AU, S
      FROM POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER
      WHERE LEVELNAME NOT IN ('${EXCLUDED_LEVEL_NAMES.join("','")}')
        AND FACULTYNAME NOT IN ('${EXCLUDED_FACULTY_NAMES.join("','")}')
        AND COURSECODE IS NOT NULL
        ${yearClause}
    `;
    console.log('Fetching from Oracle (this can take 30-90s for ~122k rows)…');
    const rowsRaw = await oracleWithConnection(
      oracleConfigFromEnv('KKU_REGISTRY_DB'),
      async (conn) => {
        // Bump array-fetch size to speed up the bulk read. Memory-safe
        // since we skip the wide DESCRIPTION columns.
        const result = await conn.execute<ViewRow>(sql, [], {
          outFormat: 4002 /* OUT_FORMAT_OBJECT */,
          fetchArraySize: 5000,
          maxRows: 0, // no cap
        });
        return (result.rows ?? []) as ViewRow[];
      },
    );
    console.log(`Fetched ${rowsRaw.length.toLocaleString()} class-offering rows.`);

    // ── Transform ──────────────────────────────────────────────────
    const offerings: Prisma.ClassOfferingCreateManyInput[] = [];
    /** kkuEmail tuples to insert AFTER class_offerings are inserted. */
    const teacherTuples: Array<{ classId: bigint; emails: string[] }> = [];
    let unresolvedFaculty = 0;
    const unresolvedFacultyNames = new Set<string>();
    let nullCourseUnit = 0;
    let geCount = 0;
    const classIdsSeen = new Set<bigint>();

    for (const r of rowsRaw) {
      const classId = BigInt(r.CLASSID);
      if (classIdsSeen.has(classId)) continue; // dedupe defensively
      classIdsSeen.add(classId);

      const normCode = normaliseCourseCode(r.COURSECODE);
      const facName = String(r.FACULTYNAME).trim();
      const facId = facultyByName.get(facName) ?? null;
      if (!facId) {
        unresolvedFaculty++;
        unresolvedFacultyNames.add(facName);
      }
      const { lectureHrs, labHrs } = parseCourseUnit(r.COURSEUNIT);
      if (lectureHrs === null) nullCourseUnit++;
      const ge = isGeneralEd(normCode, facName);
      if (ge) geCount++;

      // Grade counts — Oracle returns null when no grades reported yet.
      // Coerce to 0 so the sum/division logic is straightforward.
      const gA = Number(r.A ?? 0);
      const gBp = Number(r.BPLUS ?? 0);
      const gB = Number(r.B ?? 0);
      const gCp = Number(r.CPLUS ?? 0);
      const gC = Number(r.C ?? 0);
      const gDp = Number(r.DPLUS ?? 0);
      const gD = Number(r.D ?? 0);
      const gF = Number(r.F ?? 0);
      const gradedCount = gA + gBp + gB + gCp + gC + gDp + gD + gF;
      // classGpa precomputed at ingestion. NULL when gradedCount = 0 —
      // either the section hasn't reported (term in progress) or it's
      // a pass/fail course (only S / AU populated). 0.0 stays as a
      // legitimate value when literally everyone failed.
      const classGpa =
        gradedCount > 0
          ? (gA * GPA_WEIGHTS.A +
              gBp * GPA_WEIGHTS.BPLUS +
              gB * GPA_WEIGHTS.B +
              gCp * GPA_WEIGHTS.CPLUS +
              gC * GPA_WEIGHTS.C +
              gDp * GPA_WEIGHTS.DPLUS +
              gD * GPA_WEIGHTS.D +
              gF * GPA_WEIGHTS.F) /
            gradedCount
          : null;

      offerings.push({
        acadYearBE: Number(r.ACADYEAR),
        semester: Number(r.SEMESTER),
        courseCode: normCode,
        courseCodeRaw: String(r.COURSECODE),
        courseNameTh: r.COURSENAME,
        courseNameEn: r.COURSENAMEENG,
        section: Number(r.SECTION),
        classId,
        creditTotal: r.CREDITTOTAL === null ? null : Number(r.CREDITTOTAL),
        courseUnit: r.COURSEUNIT,
        lectureHrsPerWeek: lectureHrs,
        labHrsPerWeek: labHrs,
        enrollSeat: Number(r.ENROLLSEAT),
        totalSeat: Number(r.TOTALSEAT),
        levelName: String(r.LEVELNAME),
        registryFacultyId: String(r.FACULTYID),
        registryFacultyName: facName,
        facultyId: facId,
        isGeneralEducation: ge,
        gradeA: gA,
        gradeBPlus: gBp,
        gradeB: gB,
        gradeCPlus: gCp,
        gradeC: gC,
        gradeDPlus: gDp,
        gradeD: gD,
        gradeF: gF,
        gradeI: Number(r.I ?? 0),
        gradeW: Number(r.W ?? 0),
        gradeAU: Number(r.AU ?? 0),
        gradeS: Number(r.S ?? 0),
        gradedCount,
        classGpa,
        ingestionRunId: runId,
      });

      const emails = splitKkuMail(r.KKUMAIL);
      if (emails.length > 0) teacherTuples.push({ classId, emails });
    }
    console.log(`Transformed: ${offerings.length.toLocaleString()} unique CLASSIDs.`);
    console.log(`  General-education: ${geCount.toLocaleString()}`);
    console.log(`  Faculty unresolved: ${unresolvedFaculty.toLocaleString()} rows across ${unresolvedFacultyNames.size} distinct names`);
    if (unresolvedFacultyNames.size > 0) {
      console.log('  Sample unresolved faculty names: ' + [...unresolvedFacultyNames].slice(0, 5).join(' | '));
    }
    console.log(`  COURSEUNIT unparsed: ${nullCourseUnit.toLocaleString()}`);
    console.log(`  With teachers (KKUMAIL non-empty): ${teacherTuples.length.toLocaleString()}`);

    if (!args.apply) {
      console.log('\n[DRY RUN] No writes performed.');
      setRecordsLoaded(0);
      return;
    }

    // ── Wipe + bulk-insert class_offerings ─────────────────────────
    console.log('\nWiping existing class_offerings…');
    const delCount = await prisma.classOffering.deleteMany({});
    console.log(`  deleted ${delCount.count.toLocaleString()} rows`);

    const CHUNK = 1000;
    let inserted = 0;
    for (let i = 0; i < offerings.length; i += CHUNK) {
      const chunk = offerings.slice(i, i + CHUNK);
      const res = await prisma.classOffering.createMany({ data: chunk });
      inserted += res.count;
      if ((i / CHUNK) % 10 === 0) {
        process.stdout.write(`\r  inserted ${inserted.toLocaleString()} / ${offerings.length.toLocaleString()}`);
      }
    }
    process.stdout.write(`\r  inserted ${inserted.toLocaleString()} / ${offerings.length.toLocaleString()}\n`);

    // ── Build classId → id lookup for teacher inserts ──────────────
    const idMap = new Map<string, string>();
    let mapped = 0;
    const allInserted = await prisma.classOffering.findMany({
      select: { id: true, classId: true },
    });
    for (const o of allInserted) {
      idMap.set(o.classId.toString(), o.id);
      mapped++;
    }
    console.log(`Built classId → id lookup (${mapped.toLocaleString()} rows).`);

    // ── Insert teacher rows ────────────────────────────────────────
    const teacherRows: Prisma.ClassOfferingTeacherCreateManyInput[] = [];
    for (const t of teacherTuples) {
      const cid = idMap.get(t.classId.toString());
      if (!cid) continue;
      for (const email of t.emails) {
        teacherRows.push({ classOfferingId: cid, kkuEmail: email });
      }
    }
    console.log(`Inserting ${teacherRows.length.toLocaleString()} teacher rows…`);
    let teacherInserted = 0;
    for (let i = 0; i < teacherRows.length; i += CHUNK) {
      const chunk = teacherRows.slice(i, i + CHUNK);
      const res = await prisma.classOfferingTeacher.createMany({
        data: chunk,
        skipDuplicates: true, // defensive — schema unique key handles dups
      });
      teacherInserted += res.count;
      if ((i / CHUNK) % 20 === 0) {
        process.stdout.write(`\r  inserted ${teacherInserted.toLocaleString()} / ${teacherRows.length.toLocaleString()}`);
      }
    }
    process.stdout.write(`\r  inserted ${teacherInserted.toLocaleString()} / ${teacherRows.length.toLocaleString()}\n`);

    // ── Resolve teachers → FacultyMember.id (bulk UPDATE join) ─────
    console.log('Resolving teachers → FacultyMember.kkuEmail…');
    const updateRes = await prisma.$executeRaw`
      UPDATE class_offering_teachers AS t
      SET    faculty_member_id = fm.id
      FROM   faculty_members AS fm
      WHERE  LOWER(fm.kku_email) = t.kku_email
    `;
    console.log(`  resolved ${Number(updateRes).toLocaleString()} teacher rows to FacultyMember`);

    const unresolvedTeachers = await prisma.classOfferingTeacher.count({
      where: { facultyMemberId: null },
    });
    console.log(`  unresolved teacher rows: ${unresolvedTeachers.toLocaleString()}`);

    setRecordsLoaded(inserted + teacherInserted);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Class offerings:        ${inserted.toLocaleString()}`);
    console.log(`Teacher attributions:   ${teacherInserted.toLocaleString()}`);
    console.log(`Unresolved teachers:    ${unresolvedTeachers.toLocaleString()}`);
    console.log(`Unresolved faculties:   ${unresolvedFacultyNames.size} distinct (${unresolvedFaculty.toLocaleString()} rows)`);
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
