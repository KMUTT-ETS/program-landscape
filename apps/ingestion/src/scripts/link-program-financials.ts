#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Per-program financial link — focused per-pilot variant of kku-finance.
//
// 1. Tuition (Oracle / KKU registry):
//      SELECT FROM VIEWSTUDENTENROLLFEE f
//      JOIN VIEW_STUDENT_DETAIL_ALL s ON STUDENTCODE
//      WHERE MAJOR LIKE '%<program major>%' AND PROGRAMLEVEL LIKE '%<level Thai>%'
//      GROUP BY ACADYEAR, sum AMOUNT
//
// 2. Faculty salary (MSSQL / KKU HR):
//      SELECT SUM(SALARY) FROM EmployeeDetail
//      WHERE EMPLOYEEID IN (<program's ProgramFaculty staff employee_ids>)
//
// 3. Persists into FinancialMetric per (programId, fiscalYear) — populates
//    `tuitionRevenue` and `allocatedFacultyCost`. Other cost columns
//    (facility, overhead, costPerStudent) are left null pending the
//    cost-allocation methodology v1.0 sign-off.
//
// Idempotent: upserts on (programId, fiscalYear). Safe to re-run.
//
// Usage:
//   pnpm programs:link-financials <code|mhesi|sequenceNo|id>
// ─────────────────────────────────────────────────────────────────────────────

import { scriptExitCode } from '../lib/organization-exit';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import { loadOrganization, prisma, refreshMetricViews, type ProgramLevel, Prisma } from '@kku/db';
import { withScriptRun } from '../lib/script-run';
import {
  withConnection as oracleWithConnection,
  configFromEnv as oracleConfigFromEnv,
} from '../lib/oracle-client';
import {
  withConnection as mssqlWithConnection,
  configFromEnv as mssqlConfigFromEnv,
} from '../lib/mssql-client';

const LEVEL_TO_THAI: Record<ProgramLevel, string> = {
  BACHELOR: 'ปริญญาตรี',
  MASTER: 'ปริญญาโท',
  DOCTORAL: 'ปริญญาเอก',
  HIGHER_GRAD_DIPLOMA: 'ประกาศนียบัตรบัณฑิตชั้นสูง',
};

interface CliArgs {
  programArg: string;
  apply: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.find((a) => !a.startsWith('--'));
  if (!positional) {
    console.error('Usage: pnpm programs:link-financials <code|mhesi|sequenceNo|id> [--dry-run]');
    process.exit(1);
  }
  return {
    programArg: positional,
    apply: !argv.includes('--dry-run'),
  };
}

async function resolveProgram(arg: string) {
  const seqNo = Number(arg);
  const program = await prisma.program.findFirst({
    where: {
      OR: [
        { id: arg },
        { code: arg },
        { mhesiCode: arg },
        ...(Number.isInteger(seqNo) ? [{ sequenceNoFromSheet: seqNo }] : []),
      ],
    },
    select: {
      id: true,
      code: true,
      nameTh: true,
      level: true,
      majors: true,
      faculty: { select: { nameTh: true } },
    },
  });
  if (!program) throw new Error(`Program not found for arg "${arg}"`);
  return program;
}

// ─── 1. Oracle — tuition by ACADYEAR ─────────────────────────────────────────

interface TuitionRow {
  COHORT_YEAR_BE: number;
  STUDENT_COUNT: number;
  TUITION_SUM: number;
}

async function fetchTuitionByYear(
  facultyNameTh: string,
  majorPattern: string,
  levelPattern: string,
): Promise<TuitionRow[]> {
  // Server-side GROUP BY + HAVING >= 5 — connector never sees per-student rows.
  const sql = `
    SELECT
      f.ACADYEAR                     AS COHORT_YEAR_BE,
      COUNT(DISTINCT f.STUDENTCODE)  AS STUDENT_COUNT,
      SUM(f.AMOUNT)                  AS TUITION_SUM
    FROM POWERBI.VIEWSTUDENTENROLLFEE f
    INNER JOIN (
      SELECT DISTINCT STUDENTCODE, FACULTYNAME, PROGRAMLEVEL, MAJOR
      FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
      WHERE MAJOR        LIKE :majorPattern
        AND PROGRAMLEVEL LIKE :levelPattern
        AND FACULTYNAME  = :facultyName
    ) s ON s.STUDENTCODE = f.STUDENTCODE
    GROUP BY f.ACADYEAR
    HAVING COUNT(DISTINCT f.STUDENTCODE) >= 5
    ORDER BY f.ACADYEAR
  `;
  return oracleWithConnection(oracleConfigFromEnv('KKU_REGISTRY_DB'), async (conn) => {
    const result = await conn.execute<TuitionRow>(
      sql,
      {
        majorPattern: `%${majorPattern}%`,
        levelPattern: `%${levelPattern}%`,
        facultyName: facultyNameTh,
      },
      { outFormat: 4002 /* OUT_FORMAT_OBJECT */ },
    );
    return (result.rows ?? []) as TuitionRow[];
  });
}

// ─── 2. MSSQL — per-staff salary (transient, in-memory only) ──────────────────
//
// Per-staff salaries are NOT persisted to our DB (PDPA: aggregate-only
// posture stays). They're fetched ephemerally to compute the student-
// weighted allocation in TS, then the only thing written back is the
// program-level SUM.

interface PerStaffSalaryRow {
  EMPLOYEEID: string;
  SALARY_MONTHLY: number;
}

async function fetchPerStaffSalaries(
  employeeIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (employeeIds.length === 0) return out;
  await mssqlWithConnection(mssqlConfigFromEnv('KKU_HR_DB'), async (pool) => {
    const request = pool.request();
    const placeholders = employeeIds.map((id, i) => {
      request.input(`emp${i}`, id);
      return `@emp${i}`;
    });
    const sql = `
      SELECT
        EMPLOYEEID                                AS EMPLOYEEID,
        TRY_CAST(SALARY AS decimal(14,2))         AS SALARY_MONTHLY
      FROM dbo.EmployeeDetail
      WHERE EMPLOYEEID IN (${placeholders.join(',')})
        AND SALARY IS NOT NULL
        AND TRY_CAST(SALARY AS decimal(14,2)) > 0
    `;
    const result = await request.query<PerStaffSalaryRow>(sql);
    for (const r of result.recordset ?? []) {
      if (r.EMPLOYEEID) out.set(r.EMPLOYEEID, Number(r.SALARY_MONTHLY));
    }
  });
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function mainInner(args: ReturnType<typeof parseArgs>, runId: string): Promise<number> {
  console.log(`Mode: ${args.apply ? 'APPLY (writes FinancialMetric)' : 'DRY RUN'}`);

  const program = await resolveProgram(args.programArg);
  const major = program.majors[0] ?? '';
  if (!major) throw new Error(`Program ${program.code} has no major[0] — re-run programs:seed-from-sheet`);
  const levelTh = LEVEL_TO_THAI[program.level];
  console.log(`Program: ${program.code} · ${program.nameTh}`);
  console.log(`Faculty: ${program.faculty.nameTh}`);
  console.log(`Filter:  MAJOR LIKE '%${major}%' AND PROGRAMLEVEL LIKE '%${levelTh}%'`);

  // ── Tuition ────────────────────────────────────────────────────────────────
  console.log('\n[1/2] Querying Oracle for tuition by ACADYEAR…');
  const tuitionRows = await fetchTuitionByYear(program.faculty.nameTh, major, levelTh);
  console.log(`  Returned ${tuitionRows.length} year-cells`);
  for (const r of tuitionRows) {
    console.log(`    BE ${r.COHORT_YEAR_BE}: ${r.STUDENT_COUNT} students · ${Number(r.TUITION_SUM).toLocaleString()} THB`);
  }

  // ── Staff salary — student-weighted allocation ───────────────────────────
  // A single FacultyMember may teach in MULTIPLE programs. To avoid
  // double-counting their salary, allocate each staff's annual salary
  // PROPORTIONALLY across the programs they teach in, weighted by
  // student enrollment per program.
  //
  //   weight(staff, prog) = students(prog) / Σ students(prog' staff teaches)
  //   contribution(staff, prog) = staff.annual_salary × weight
  //   program faculty cost = Σ over staff in prog of contribution
  //
  // For staff whose programs have no enrollment data, fall back to
  // equal split (1 / N programs).
  console.log('\n[2/2] Querying MSSQL for per-staff salaries (weighted allocation)…');
  const programFaculty = await prisma.programFaculty.findMany({
    where: { programId: program.id },
    include: { facultyMember: { select: { id: true, employeeId: true, nameEn: true } } },
  });
  const targetStaffPostgresIds = programFaculty.map((pf) => pf.facultyMember.id);
  const targetStaffEmployeeIds = programFaculty
    .map((pf) => pf.facultyMember.employeeId)
    .filter((id): id is string => Boolean(id));
  console.log(`  ProgramFaculty rows: ${programFaculty.length} (with employeeId: ${targetStaffEmployeeIds.length})`);
  if (targetStaffEmployeeIds.length === 0) {
    console.log('  ⚠ No staff with employeeId — run programs:extract-faculty + ensure kku-hr connector ran');
  }

  // 2a. Find ALL programs each of those staff teach in (across the portfolio).
  const allLinks = await prisma.programFaculty.findMany({
    where: { facultyMemberId: { in: targetStaffPostgresIds } },
    select: { facultyMemberId: true, programId: true },
  });
  const programsByStaff = new Map<string, string[]>();
  for (const link of allLinks) {
    const arr = programsByStaff.get(link.facultyMemberId) ?? [];
    arr.push(link.programId);
    programsByStaff.set(link.facultyMemberId, arr);
  }
  const allTaughtProgramIds = [...new Set(allLinks.map((l) => l.programId))];

  // 2b. Latest-year enrollment per program (Postgres EnrollmentMetric,
  // populated by the kku-registry connector).
  const enrollmentRowsRaw = await prisma.enrollmentMetric.findMany({
    where: { programId: { in: allTaughtProgramIds } },
    orderBy: [{ programId: 'asc' }, { academicYear: 'desc' }],
    select: { programId: true, enrolled: true, academicYear: true },
  });
  const enrollmentByProgram = new Map<string, number>();
  for (const e of enrollmentRowsRaw) {
    if (!enrollmentByProgram.has(e.programId)) {
      enrollmentByProgram.set(e.programId, e.enrolled);
    }
  }
  const targetEnrollment = enrollmentByProgram.get(program.id) ?? 0;
  console.log(`  Target program enrollment (latest year): ${targetEnrollment}`);
  console.log(`  Other programs taught by this program's staff: ${allTaughtProgramIds.length - 1}`);

  // 2c. Per-staff salary (transient — not persisted).
  const salaryByEmployeeId = await fetchPerStaffSalaries(targetStaffEmployeeIds);
  console.log(`  Per-staff salaries fetched: ${salaryByEmployeeId.size} of ${targetStaffEmployeeIds.length}`);

  // 2d. Compute weighted aggregate.
  let weightedAnnualCost = 0;
  let staffWithFullWeight = 0;
  let staffWithSplitWeight = 0;
  let staffWithEqualSplitFallback = 0;
  for (const pf of programFaculty) {
    const employeeId = pf.facultyMember.employeeId;
    if (!employeeId) continue;
    const monthly = salaryByEmployeeId.get(employeeId);
    if (monthly === undefined) continue;
    const annual = monthly * 12;
    const programs = programsByStaff.get(pf.facultyMember.id) ?? [program.id];
    const totalStaffEnrollment = programs.reduce(
      (sum, pid) => sum + (enrollmentByProgram.get(pid) ?? 0),
      0,
    );
    let weight: number;
    if (totalStaffEnrollment > 0 && targetEnrollment > 0) {
      weight = targetEnrollment / totalStaffEnrollment;
      if (programs.length === 1) staffWithFullWeight++;
      else staffWithSplitWeight++;
    } else {
      // Fallback: equal split when enrollment data is missing for any
      // program in this staff's set. Avoids 0× allocation when data is
      // sparse.
      weight = 1 / programs.length;
      staffWithEqualSplitFallback++;
    }
    weightedAnnualCost += annual * weight;
  }
  console.log(`  Allocation breakdown:`);
  console.log(`    Single-program (full salary): ${staffWithFullWeight}`);
  console.log(`    Multi-program (enrollment-weighted): ${staffWithSplitWeight}`);
  console.log(`    Equal-split fallback (no enrollment data): ${staffWithEqualSplitFallback}`);
  console.log(`  Weighted annual faculty cost: ${weightedAnnualCost.toLocaleString()} THB/yr`);

  if (!args.apply) {
    console.log('\n(dry-run; pass without --dry-run to write FinancialMetric)');
    return 0;
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  console.log('\n[Writing FinancialMetric rows]');
  let written = 0;
  // FinancialMetric.fiscalYear is stored as Christian Era to match the
  // existing kku-finance connector's convention (BE 2566 → CE 2023).
  // Oracle ACADYEAR returns BE; subtract 543.
  for (const r of tuitionRows) {
    const fy = r.COHORT_YEAR_BE - 543;
    const tuition = new Prisma.Decimal(r.TUITION_SUM);
    const facultyCost = weightedAnnualCost > 0
      ? new Prisma.Decimal(weightedAnnualCost.toFixed(2))
      : null;

    // Net contribution model — salary is NOT subtracted:
    //   tuitionRevenue + otherRevenue − directCost = netContribution
    //
    // Faculty salary (allocatedFacultyCost) is funded directly by the
    // Thai government's block grant to KKU (งบประมาณเงินอุดหนุนจากรัฐ),
    // NOT from tuition. We surface it as an informational line so
    // analysts can see the government's investment in this program, but
    // it doesn't depress the program's net contribution from tuition.
    const directCost = new Prisma.Decimal(0); // pending cost-methodology v1.0
    const netContribution = tuition.minus(directCost);

    await prisma.financialMetric.upsert({
      where: { programId_fiscalYear: { programId: program.id, fiscalYear: fy } },
      create: {
        programId: program.id,
        fiscalYear: fy,
        tuitionRevenue: tuition,
        otherRevenue: new Prisma.Decimal(0),
        directCost,
        allocatedFacultyCost: facultyCost ?? new Prisma.Decimal(0),
        allocatedFacilityCost: new Prisma.Decimal(0),
        allocatedOverhead: new Prisma.Decimal(0),
        netContribution,
        // Cost per student (government subsidy + program direct cost) per
        // enrolled head — informational metric reflecting the actual
        // public investment per student.
        costPerStudent: r.STUDENT_COUNT > 0 && facultyCost
          ? facultyCost.div(r.STUDENT_COUNT)
          : null,
        freshnessDate: new Date(),
        methodologyVersion: 'per-program-link.v1',
        ingestionRunId: runId,
      },
      update: {
        tuitionRevenue: tuition,
        directCost,
        ...(facultyCost ? { allocatedFacultyCost: facultyCost } : {}),
        netContribution,
        ...(r.STUDENT_COUNT > 0 && facultyCost
          ? { costPerStudent: facultyCost.div(r.STUDENT_COUNT) }
          : {}),
        freshnessDate: new Date(),
        methodologyVersion: 'per-program-link.v1',
        ingestionRunId: runId,
      },
    });
    written++;
  }
  console.log(`  Wrote/updated ${written} FinancialMetric rows`);

  // Refresh the materialized views the deep-dive reads from.
  console.log('  Refreshing metric materialized views…');
  await refreshMetricViews();
  console.log('  Done.');

  // Final state
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const finals = await prisma.financialMetric.findMany({
    where: { programId: program.id },
    orderBy: { fiscalYear: 'asc' },
  });
  console.log('Final FinancialMetric rows:');
  for (const f of finals) {
    console.log(
      `  FY ${f.fiscalYear}: tuition ${Number(f.tuitionRevenue).toLocaleString()} · faculty cost ${Number(f.allocatedFacultyCost).toLocaleString()}`,
    );
  }
  return written;
}

async function main(): Promise<void> {
  await loadOrganization();
  const args = parseArgs(process.argv.slice(2));
  // Per-program financials derive from kku-finance (tuition Oracle view) +
  // kku-hr (per-staff salary MSSQL view). Attribute the synthetic run to
  // kku-finance — financials is the primary destination.
  await withScriptRun('kku-finance', async ({ runId, setRecordsLoaded }) => {
    const written = await mainInner(args, runId);
    setRecordsLoaded(written);
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(scriptExitCode(err));
  })
  .finally(() => prisma.$disconnect());
