#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Discovery-only capture for the kku-finance connector. Two sources:
//
//   1. Oracle (KKU Registry POWERBI schema — host from KKU_REGISTRY_DB_HOST)
//      - VIEWSTUDENTENROLLFEE has tuition (STUDENTID × ACADYEAR × SEMESTER
//        × AMOUNT — 387,940 rows seen in the kku-registry capture).
//      - Joined to VIEW_STUDENT_DETAIL_ALL on STUDENTID gives us
//        (faculty × program × level × major × ACADYEAR) tuition totals.
//      - Reuses KKU_REGISTRY_DB_* env (the powerbi read-only account).
//
//   2. MSSQL (KKU HR server, 10.101.104.192) — DB ERPPowerBI
//      - Table dbo.BudgetData. Field TOTAL_BUDGET is the per-line-item
//        budget allocation for the current fiscal year.
//      - Reuses KKU_HR_DB_* env. The HR read-only account has ERPPowerBI
//        access (confirmed via the kku-hr sibling-dbs scan 2026-04-28).
//
// All output is COUNTS / DISTINCT VALUES / AGGREGATE SUMS only — no
// per-student or per-line-item PII rows are written to disk.
//
// Usage:
//   pnpm finance:capture tuition-discover  # schema + counts on Oracle side
//   pnpm finance:capture tuition-sample    # SUM(AMOUNT) per program × year
//   pnpm finance:capture budget-discover   # schema + counts on MSSQL side
//   pnpm finance:capture budget-sample     # SUM(TOTAL_BUDGET) per faculty
//   pnpm finance:capture all               # all four in order
//
// Output JSON fixtures land in apps/ingestion/test/fixtures/kku-finance/.
// All aggregates; small-bucket suppression applied where relevant.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  configFromEnv as oracleConfigFromEnv,
  query as oracleQuery,
  withConnection as oracleWithConnection,
} from '../lib/oracle-client';
import {
  configFromEnv as mssqlConfigFromEnv,
  query as mssqlQuery,
  withConnection as mssqlWithConnection,
} from '../lib/mssql-client';

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const FIXTURE_DIR = path.resolve(
  __dirname,
  '../../test/fixtures/kku-finance',
);

async function ensureDir(): Promise<void> {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
}

async function writeFixture(name: string, data: unknown): Promise<void> {
  const target = path.join(FIXTURE_DIR, `${name}.json`);
  await fs.writeFile(target, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  → wrote ${path.relative(process.cwd(), target)}`);
}

// ─────────────────────────────────────────────────────────────────────
// 1. Tuition-side discovery (Oracle)
// ─────────────────────────────────────────────────────────────────────

async function discoverTuition(): Promise<void> {
  console.log('[tuition-discover] introspecting VIEWSTUDENTENROLLFEE on Oracle…');
  await oracleWithConnection(oracleConfigFromEnv('KKU_REGISTRY_DB'), async (conn) => {
    // Schema from ALL_TAB_COLUMNS (the POWERBI account already has read
    // access to its own metadata).
    const cols = await oracleQuery(
      conn,
      `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, NULLABLE, COLUMN_ID
       FROM ALL_TAB_COLUMNS
       WHERE OWNER = 'POWERBI' AND TABLE_NAME = 'VIEWSTUDENTENROLLFEE'
       ORDER BY COLUMN_ID`,
    );

    // Total row count.
    const totalRows = await oracleQuery<{ N: number }>(
      conn,
      `SELECT COUNT(*) AS N FROM POWERBI.VIEWSTUDENTENROLLFEE`,
    );

    // Distinct ACADYEAR + SEMESTER combinations — gives us the year
    // coverage to expect.
    const yearCoverage = await oracleQuery<{
      ACADYEAR: number;
      SEMESTER: number;
      ROW_COUNT: number;
      AMOUNT_SUM: number;
    }>(
      conn,
      `SELECT ACADYEAR, SEMESTER,
              COUNT(*) AS ROW_COUNT,
              SUM(AMOUNT) AS AMOUNT_SUM
       FROM POWERBI.VIEWSTUDENTENROLLFEE
       GROUP BY ACADYEAR, SEMESTER
       ORDER BY ACADYEAR DESC, SEMESTER`,
    );

    // Sanity check on the join key — does every fee row have a matching
    // student row in VIEW_STUDENT_DETAIL_ALL? (Limited to top 5 years
    // for speed.)
    const joinSanity = await oracleQuery<{
      ACADYEAR: number;
      FEE_ROWS: number;
      MATCHED_ROWS: number;
    }>(
      conn,
      `SELECT
         f.ACADYEAR,
         COUNT(*) AS FEE_ROWS,
         SUM(CASE WHEN s.STUDENTCODE IS NOT NULL THEN 1 ELSE 0 END) AS MATCHED_ROWS
       FROM POWERBI.VIEWSTUDENTENROLLFEE f
       LEFT JOIN (SELECT DISTINCT STUDENTCODE FROM POWERBI.VIEW_STUDENT_DETAIL_ALL) s
         ON s.STUDENTCODE = f.STUDENTCODE
       WHERE f.ACADYEAR >= (SELECT MAX(ACADYEAR) - 4 FROM POWERBI.VIEWSTUDENTENROLLFEE)
       GROUP BY f.ACADYEAR
       ORDER BY f.ACADYEAR DESC`,
    );

    const out = {
      schema: cols,
      totalRows: Number(totalRows[0]?.N ?? 0),
      yearCoverage: yearCoverage.map((r) => ({
        ACADYEAR_BE: Number(r.ACADYEAR),
        ACADYEAR_CE: Number(r.ACADYEAR) - 543,
        SEMESTER: Number(r.SEMESTER),
        ROW_COUNT: Number(r.ROW_COUNT),
        AMOUNT_SUM_THB: Number(r.AMOUNT_SUM),
      })),
      joinCoverageVsStudentDetail: joinSanity.map((r) => ({
        ACADYEAR_BE: Number(r.ACADYEAR),
        feeRows: Number(r.FEE_ROWS),
        matchedRows: Number(r.MATCHED_ROWS),
        coveragePct:
          Number(r.FEE_ROWS) === 0
            ? 0
            : Math.round((Number(r.MATCHED_ROWS) / Number(r.FEE_ROWS)) * 1000) / 10,
      })),
    };
    console.log(`  total rows: ${out.totalRows.toLocaleString()}`);
    console.log(`  year coverage (top 5):`);
    for (const y of out.yearCoverage.slice(0, 5)) {
      console.log(
        `    BE ${y.ACADYEAR_BE} sem ${y.SEMESTER}: ${y.ROW_COUNT.toLocaleString()} rows, sum ${y.AMOUNT_SUM_THB.toLocaleString()} THB`,
      );
    }
    console.log(`  STUDENTID join coverage (top 5 years):`);
    for (const j of out.joinCoverageVsStudentDetail.slice(0, 5)) {
      console.log(
        `    BE ${j.ACADYEAR_BE}: ${j.matchedRows.toLocaleString()}/${j.feeRows.toLocaleString()} (${j.coveragePct}%)`,
      );
    }
    await writeFixture('tuition-discover', out);
  });
}

// ─────────────────────────────────────────────────────────────────────
// 2. Tuition aggregate sample — SUM(AMOUNT) per (faculty × program ×
//    level × major × ACADYEAR). This is the actual Q1 shape the
//    connector will use, so it doubles as a real-world Q1 test.
// ─────────────────────────────────────────────────────────────────────

async function sampleTuition(): Promise<void> {
  console.log('[tuition-sample] aggregating tuition per program × year on Oracle…');
  await oracleWithConnection(oracleConfigFromEnv('KKU_REGISTRY_DB'), async (conn) => {
    const rows = await oracleQuery<{
      FACULTY_NAME: string;
      PROGRAM_NAME: string;
      PROGRAM_LEVEL: string | null;
      MAJOR: string | null;
      ACADYEAR: number;
      STUDENT_COUNT: number;
      ROW_COUNT: number;
      TUITION_SUM: number;
    }>(
      conn,
      `SELECT
         s.FACULTYNAME    AS FACULTY_NAME,
         s.PROGRAMNAME    AS PROGRAM_NAME,
         s.PROGRAMLEVEL   AS PROGRAM_LEVEL,
         s.MAJOR          AS MAJOR,
         f.ACADYEAR       AS ACADYEAR,
         COUNT(DISTINCT f.STUDENTCODE) AS STUDENT_COUNT,
         COUNT(*)         AS ROW_COUNT,
         SUM(f.AMOUNT)    AS TUITION_SUM
       FROM POWERBI.VIEWSTUDENTENROLLFEE f
       INNER JOIN (
         SELECT DISTINCT STUDENTCODE, FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL, MAJOR
         FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
       ) s ON s.STUDENTCODE = f.STUDENTCODE
       WHERE s.FACULTYNAME IS NOT NULL AND s.PROGRAMNAME IS NOT NULL
       GROUP BY s.FACULTYNAME, s.PROGRAMNAME, s.PROGRAMLEVEL, s.MAJOR, f.ACADYEAR
       HAVING COUNT(DISTINCT f.STUDENTCODE) >= 5`,
    );
    const totalSum = rows.reduce((s, r) => s + Number(r.TUITION_SUM), 0);
    const totalStudents = rows.reduce((s, r) => s + Number(r.STUDENT_COUNT), 0);
    console.log(`  ${rows.length.toLocaleString()} (program × year) cells`);
    console.log(`  aggregate sum across all cells: ${totalSum.toLocaleString()} THB`);
    console.log(`  aggregate distinct students: ${totalStudents.toLocaleString()}`);
    // Group by year for run summary; suppress any cell with < 5 students.
    const byYear = new Map<number, { rowCount: number; sum: number; students: number }>();
    for (const r of rows) {
      const y = Number(r.ACADYEAR);
      const cur = byYear.get(y) ?? { rowCount: 0, sum: 0, students: 0 };
      cur.rowCount += 1;
      cur.sum += Number(r.TUITION_SUM);
      cur.students += Number(r.STUDENT_COUNT);
      byYear.set(y, cur);
    }
    const summary = [...byYear.entries()]
      .sort(([a], [b]) => b - a)
      .slice(0, 10)
      .map(([y, agg]) => ({
        ACADYEAR_BE: y,
        ACADYEAR_CE: y - 543,
        cells: agg.rowCount,
        students: agg.students,
        tuitionSumThb: agg.sum,
      }));
    console.log(`  per-year summary (top 10 years):`);
    for (const s of summary) {
      console.log(
        `    BE ${s.ACADYEAR_BE}: ${s.cells} cells, ${s.students.toLocaleString()} students, ${s.tuitionSumThb.toLocaleString()} THB`,
      );
    }
    // Sample a few non-PII rows for fixture (program-aggregate rows
    // already have suppression via HAVING).
    const sampleRows = rows.slice(0, 30).map((r) => ({
      ...r,
      ACADYEAR: Number(r.ACADYEAR),
      STUDENT_COUNT: Number(r.STUDENT_COUNT),
      ROW_COUNT: Number(r.ROW_COUNT),
      TUITION_SUM: Number(r.TUITION_SUM),
    }));
    await writeFixture('tuition-sample', {
      totalCells: rows.length,
      totalAggregateSumThb: totalSum,
      totalDistinctStudents: totalStudents,
      summaryByYear: summary,
      sampleRowsTop30: sampleRows,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// 3. Budget-side discovery (MSSQL ERPPowerBI.dbo.BudgetData)
// ─────────────────────────────────────────────────────────────────────

async function discoverBudget(): Promise<void> {
  console.log('[budget-discover] introspecting ERPPowerBI.dbo.BudgetData on MSSQL…');
  await mssqlWithConnection(mssqlConfigFromEnv('KKU_HR_DB'), async (pool) => {
    const cols = await mssqlQuery(
      pool,
      `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
              NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, ORDINAL_POSITION
       FROM [ERPPowerBI].INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'BudgetData'
       ORDER BY ORDINAL_POSITION`,
    );

    const rowCount = await mssqlQuery<{ N: number }>(
      pool,
      `SELECT COUNT(*) AS N FROM [ERPPowerBI].[dbo].[BudgetData]`,
    );

    const out: Record<string, unknown> = {
      schema: cols,
      rowCount: Number(rowCount[0]?.N ?? 0),
    };
    console.log(`  ${cols.length} columns; ${out.rowCount} rows`);
    console.log(`  schema:`);
    for (const c of cols as Array<{ COLUMN_NAME: string; DATA_TYPE: string }>) {
      console.log(`    ${c.COLUMN_NAME} ${c.DATA_TYPE}`);
    }
    await writeFixture('budget-discover', out);
  });
}

// ─────────────────────────────────────────────────────────────────────
// 4. Budget aggregate sample — SUM(TOTAL_BUDGET) per faculty (and per
//    fiscal year if such a column exists). Bottom-driven by the
//    schema discovered in step 3 — pick the faculty + year columns
//    after the schema lands.
// ─────────────────────────────────────────────────────────────────────

async function sampleBudget(): Promise<void> {
  console.log('[budget-sample] aggregating TOTAL_BUDGET per faculty on MSSQL…');
  await mssqlWithConnection(mssqlConfigFromEnv('KKU_HR_DB'), async (pool) => {
    // First fetch column names so we can adapt to the table's actual
    // structure without hard-coding.
    const cols = await mssqlQuery<{ COLUMN_NAME: string }>(
      pool,
      `SELECT COLUMN_NAME
       FROM [ERPPowerBI].INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'BudgetData'
       ORDER BY ORDINAL_POSITION`,
    );
    const colNames = cols.map((c) => c.COLUMN_NAME);
    const upperColNames = colNames.map((c) => c.toUpperCase());

    function findCol(...candidates: string[]): string | null {
      for (const cand of candidates) {
        const idx = upperColNames.indexOf(cand.toUpperCase());
        if (idx !== -1) return colNames[idx] ?? null;
      }
      return null;
    }

    const facCol =
      findCol(
        'DIVISION_NAME',
        'KKU_DIVISION',
        'FACULTY',
        'FAC_NAME',
        'FACULTY_NAME',
        'BU_NAME',
        'OU',
      ) ?? null;
    // BUDGET_PERIOD holds the BE fiscal year ("2569"); BUDGET_PERIOD_NAME
    // is the snapshot month ("Jan") — NOT a year. Always prefer
    // BUDGET_PERIOD as the year column.
    const yearCol =
      findCol(
        'BUDGET_PERIOD',
        'BUDGET_PERIOD_NAME',
        'PERIOD_NAME',
        'FISCAL_YEAR',
        'FISCALYEAR',
        'YEAR',
        'BUDGET_YEAR',
      ) ?? null;
    const amountCol =
      findCol('TOTAL_BUDGET', 'BUDGET', 'AMOUNT', 'TOTAL_AMOUNT') ?? null;
    const itemCol =
      findCol(
        'ACCOUNT_NAME',
        'KKU_ACCOUNT',
        'PROJECT_NAME',
        'SERVICE_NAME',
        'ITEM_NAME',
        'BUDGET_ITEM',
        'BUDGET_LINE',
        'CATEGORY',
      ) ?? null;
    const fundCol = findCol('FUND_NAME', 'KKU_FUND') ?? null;
    const expenditureCol =
      findCol('TOTAL_EXPENDITURE', 'TOTAL_CONSUMPTION') ?? null;

    const out: Record<string, unknown> = {
      detectedColumns: { facCol, yearCol, amountCol, itemCol, fundCol, expenditureCol },
    };
    console.log(
      `  detected — faculty=${facCol} year=${yearCol} amount=${amountCol} item=${itemCol} fund=${fundCol} expenditure=${expenditureCol}`,
    );

    if (!amountCol) {
      console.warn(`  ⚠️  no amount column detected — cannot aggregate.`);
      await writeFixture('budget-sample', out);
      return;
    }

    // Aggregate SUM by (faculty, year) if both columns exist; just by
    // faculty otherwise.
    if (facCol && yearCol) {
      const rows = await mssqlQuery<{ FAC: string | null; YR: number | null; SUM: number; CNT: number }>(
        pool,
        `SELECT [${facCol}] AS FAC, [${yearCol}] AS YR,
                SUM(TRY_CAST([${amountCol}] AS decimal(18,2))) AS SUM,
                COUNT(*) AS CNT
         FROM [ERPPowerBI].[dbo].[BudgetData]
         GROUP BY [${facCol}], [${yearCol}]
         ORDER BY [${yearCol}] DESC, SUM(TRY_CAST([${amountCol}] AS decimal(18,2))) DESC`,
      );
      out.byFacultyAndYear = rows.map((r) => ({
        faculty: r.FAC,
        year: r.YR === null ? null : Number(r.YR),
        sumThb: Number(r.SUM),
        rowCount: Number(r.CNT),
      }));
      console.log(`  ${rows.length} (faculty × year) cells`);
      console.log(`  top 10 by sum (any year):`);
      for (const r of (out.byFacultyAndYear as Array<{ faculty: string | null; year: number | null; sumThb: number; rowCount: number }>).slice(0, 10)) {
        console.log(
          `    [${r.year}] ${r.faculty}: ${r.sumThb.toLocaleString()} THB (${r.rowCount} rows)`,
        );
      }
    }

    // Top-N item categories by total spend (across years).
    if (itemCol) {
      const rows = await mssqlQuery<{ ITEM: string | null; SUM: number; CNT: number }>(
        pool,
        `SELECT TOP 30 [${itemCol}] AS ITEM,
                       SUM(TRY_CAST([${amountCol}] AS decimal(18,2))) AS SUM,
                       COUNT(*) AS CNT
         FROM [ERPPowerBI].[dbo].[BudgetData]
         GROUP BY [${itemCol}]
         ORDER BY SUM(TRY_CAST([${amountCol}] AS decimal(18,2))) DESC`,
      );
      out.topItemsBySum = rows.map((r) => ({
        item: r.ITEM,
        sumThb: Number(r.SUM),
        rowCount: Number(r.CNT),
      }));
      console.log(`  top 5 items by sum:`);
      for (const r of (out.topItemsBySum as Array<{ item: string | null; sumThb: number; rowCount: number }>).slice(0, 5)) {
        console.log(`    ${r.item}: ${r.sumThb.toLocaleString()} THB (${r.rowCount} rows)`);
      }
    }

    // Per-fund total — gives us the gov-funded vs univ-revenue split.
    if (fundCol) {
      const rows = await mssqlQuery<{ FUND: string | null; SUM: number; CNT: number }>(
        pool,
        `SELECT [${fundCol}] AS FUND,
                SUM(TRY_CAST([${amountCol}] AS decimal(18,2))) AS SUM,
                COUNT(*) AS CNT
         FROM [ERPPowerBI].[dbo].[BudgetData]
         GROUP BY [${fundCol}]
         ORDER BY SUM(TRY_CAST([${amountCol}] AS decimal(18,2))) DESC`,
      );
      out.byFund = rows.map((r) => ({
        fund: r.FUND,
        sumThb: Number(r.SUM),
        rowCount: Number(r.CNT),
      }));
      console.log(`  by fund (revenue source split):`);
      for (const r of (out.byFund as Array<{ fund: string | null; sumThb: number; rowCount: number }>).slice(0, 10)) {
        console.log(`    ${r.fund}: ${r.sumThb.toLocaleString()} THB (${r.rowCount} rows)`);
      }
    }

    // Per-faculty allocation vs actual expenditure (latest year only,
    // to keep it relevant). Compares budget allocation against
    // realised spend.
    if (facCol && yearCol && expenditureCol) {
      const rows = await mssqlQuery<{
        FAC: string | null;
        BUDGET: number;
        EXPENDITURE: number;
      }>(
        pool,
        `SELECT TOP 30
                [${facCol}] AS FAC,
                SUM(TRY_CAST([${amountCol}] AS decimal(18,2))) AS BUDGET,
                SUM(TRY_CAST([${expenditureCol}] AS decimal(18,2))) AS EXPENDITURE
         FROM [ERPPowerBI].[dbo].[BudgetData]
         WHERE [${yearCol}] = (SELECT MAX([${yearCol}]) FROM [ERPPowerBI].[dbo].[BudgetData])
         GROUP BY [${facCol}]
         ORDER BY SUM(TRY_CAST([${amountCol}] AS decimal(18,2))) DESC`,
      );
      out.facultyBudgetVsActualLatestYear = rows.map((r) => ({
        faculty: r.FAC,
        budgetThb: Number(r.BUDGET),
        expenditureThb: Number(r.EXPENDITURE),
        utilisationPct:
          Number(r.BUDGET) === 0
            ? 0
            : Math.round((Number(r.EXPENDITURE) / Number(r.BUDGET)) * 1000) / 10,
      }));
      console.log(`  faculty budget vs actual (latest year, top 5):`);
      for (const r of (out.facultyBudgetVsActualLatestYear as Array<{ faculty: string | null; budgetThb: number; expenditureThb: number; utilisationPct: number }>).slice(0, 5)) {
        console.log(
          `    ${r.faculty}: budget=${r.budgetThb.toLocaleString()} actual=${r.expenditureThb.toLocaleString()} (${r.utilisationPct}% used)`,
        );
      }
    }

    // Distinct year coverage for sanity.
    if (yearCol) {
      const rows = await mssqlQuery<{ YR: number | null; CNT: number }>(
        pool,
        `SELECT [${yearCol}] AS YR, COUNT(*) AS CNT
         FROM [ERPPowerBI].[dbo].[BudgetData]
         GROUP BY [${yearCol}]
         ORDER BY [${yearCol}] DESC`,
      );
      out.yearCoverage = rows.map((r) => ({
        year: r.YR === null ? null : Number(r.YR),
        rowCount: Number(r.CNT),
      }));
    }

    await writeFixture('budget-sample', out);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────

const HELP = `
Usage: pnpm finance:capture <subcommand>

Subcommands:
  tuition-discover  schema + counts on Oracle VIEWSTUDENTENROLLFEE
  tuition-sample    SUM(AMOUNT) per program × year (HAVING >= 5 students)
  budget-discover   schema + counts on MSSQL ERPPowerBI.BudgetData
  budget-sample     SUM(TOTAL_BUDGET) per faculty × year + top items
  all               run all four in order

Reads KKU_REGISTRY_DB_* (Oracle) and KKU_HR_DB_* (MSSQL) from .env.
Writes JSON fixtures to apps/ingestion/test/fixtures/kku-finance/<name>.json

All output is aggregate; no per-student or per-line-item rows are saved.
`.trim();

async function main(): Promise<void> {
  const subcommand = process.argv[2];
  if (!subcommand) {
    console.error(HELP);
    process.exit(1);
  }
  await ensureDir();

  switch (subcommand) {
    case 'tuition-discover':
      await discoverTuition();
      break;
    case 'tuition-sample':
      await sampleTuition();
      break;
    case 'budget-discover':
      await discoverBudget();
      break;
    case 'budget-sample':
      await sampleBudget();
      break;
    case 'all':
      await discoverTuition();
      await sampleTuition();
      await discoverBudget();
      await sampleBudget();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}\n\n${HELP}`);
      process.exit(1);
  }
  console.log('[finance:capture] done');
}

void main().catch((err: unknown) => {
  console.error('[finance:capture] failed:', err);
  process.exit(1);
});
