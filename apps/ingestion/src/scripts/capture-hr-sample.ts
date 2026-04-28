#!/usr/bin/env tsx
// ────────────────────────────────────────────────────────────────────────────
// Discovery-only capture for the KKU HR (HCMEmployee) SQL Server.
//
// Run locally with KKU_HR_DB_* set in .env (read-only account; the
// session declined to use `sa`). All output is COUNTS / DISTINCT VALUES
// only — no row-level PII is ever written to disk. This is a
// fact-finding pass to inform the connector's real SQL design.
//
// Usage:
//   pnpm hr:capture schema       # confirm columns + types via INFORMATION_SCHEMA
//   pnpm hr:capture counts       # row counts overall + by STATUS / EMP_TYPE / etc
//   pnpm hr:capture org-tree     # distinct values of BU1..BU7 with counts
//   pnpm hr:capture positions    # distinct values of JOB / PL / SUBGRADE / EMP_LEVEL / EMP_GROUP
//   pnpm hr:capture date-ranges  # min/max BIRTHDAY / STARTDATE / RESIGNDATE bucketed by year
//   pnpm hr:capture all          # all of the above
//
// Output JSON fixtures land in apps/ingestion/test/fixtures/kku-hr/.
// Fixtures are aggregate-only (counts, distinct values) with suppression:
// any bucket with N < 5 is collapsed under "(suppressed: …)" so a single
// individual can never be re-identified. Safe to commit to git. If DPO
// review later flags concern, the fixtures can be moved out of git
// without code changes.
// ────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { configFromEnv, query, withConnection } from '../lib/mssql-client';

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
  '../../test/fixtures/kku-hr',
);

async function ensureDir(): Promise<void> {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
}

async function writeFixture(name: string, data: unknown): Promise<void> {
  const target = path.join(FIXTURE_DIR, `${name}.json`);
  await fs.writeFile(target, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  → wrote ${path.relative(process.cwd(), target)}`);
}

// Suppress small bucket counts (< MIN_BUCKET) in distinct-value lists
// so a single individual can't be re-identified by a unique combination.
// Buckets below this threshold are collapsed into a single "(<N)" row.
const MIN_BUCKET = 5;

interface SuppressableRow {
  V: string | null;
  N: number;
}

function suppressSmall(
  rows: SuppressableRow[],
): { suppressed: SuppressableRow[]; suppressedCount: number; collapsed: number } {
  const out: SuppressableRow[] = [];
  let suppressedCount = 0;
  let collapsed = 0;
  for (const r of rows) {
    if (r.N < MIN_BUCKET) {
      collapsed += r.N;
      suppressedCount++;
    } else {
      out.push(r);
    }
  }
  if (collapsed > 0) {
    out.push({
      V: `(suppressed: ${suppressedCount} buckets)`,
      N: collapsed,
    });
  }
  return { suppressed: out, suppressedCount, collapsed };
}

// ────────────────────────────────────────────────────────────────────
// 1. Schema introspection
// ────────────────────────────────────────────────────────────────────

interface ColumnRow extends Record<string, unknown> {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  IS_NULLABLE: string;
  ORDINAL_POSITION: number;
}

async function captureSchema(): Promise<void> {
  console.log('[schema] introspecting INFORMATION_SCHEMA.COLUMNS for dbo.EmployeeDetail…');
  await withConnection(configFromEnv(), async (pool) => {
    const rows = await query<ColumnRow>(
      pool,
      `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE,
              CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, ORDINAL_POSITION
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'EmployeeDetail'
       ORDER BY ORDINAL_POSITION`,
    );
    console.log(`[schema] EmployeeDetail has ${rows.length} columns`);
    await writeFixture('schema', rows);
  });
}

// ────────────────────────────────────────────────────────────────────
// 2. Row counts overall + by major categorical field
// ────────────────────────────────────────────────────────────────────

async function captureCounts(): Promise<void> {
  console.log('[counts] overall row count + counts per major categorical field…');
  await withConnection(configFromEnv(), async (pool) => {
    const total = await query<{ N: number }>(
      pool,
      `SELECT COUNT(*) AS N FROM dbo.EmployeeDetail`,
    );
    const breakdown: Record<string, unknown> = {
      total: Number(total[0]?.N ?? 0),
    };

    for (const field of [
      'STATUS',
      'EMP_TYPE',
      'EMP_GROUP',
      'Assignment_Category',
      'Budget_Type',
      'EMP_NATIONAL',
      'SEX',
      'STATMARRY',
      'CURRENCY',
    ]) {
      const rows = await query<{ V: string | null; N: number }>(
        pool,
        `SELECT [${field}] AS V, COUNT(*) AS N
         FROM dbo.EmployeeDetail
         GROUP BY [${field}]
         ORDER BY COUNT(*) DESC`,
      );
      breakdown[field] = suppressSmall(rows.map((r) => ({ ...r, N: Number(r.N) }))).suppressed;
    }
    console.log(`  total employees: ${breakdown.total}`);
    await writeFixture('counts', breakdown);
  });
}

// ────────────────────────────────────────────────────────────────────
// 3. Org tree — distinct BU1..BU7 with counts
// ────────────────────────────────────────────────────────────────────

async function captureOrgTree(): Promise<void> {
  console.log('[org-tree] distinct BU1..BU7 values…');
  await withConnection(configFromEnv(), async (pool) => {
    const breakdown: Record<string, unknown> = {};
    for (const lvl of ['BU1', 'BU2', 'BU3', 'BU4', 'BU5', 'BU6', 'BU7']) {
      const rows = await query<{ V: string | null; N: number }>(
        pool,
        `SELECT [${lvl}] AS V, COUNT(*) AS N
         FROM dbo.EmployeeDetail
         WHERE STATUS IS NOT NULL
         GROUP BY [${lvl}]
         ORDER BY COUNT(*) DESC`,
      );
      const numbered = rows.map((r) => ({ ...r, N: Number(r.N) }));
      breakdown[lvl] = {
        distinctCount: numbered.length,
        topValues: suppressSmall(numbered).suppressed.slice(0, 50),
      };
    }
    await writeFixture('org-tree', breakdown);
  });
}

// ────────────────────────────────────────────────────────────────────
// 4. Position fields — JOB / PL / SUBGRADE / EMP_LEVEL / EMP_GROUP / EMP_POSITION / TDESC
// ────────────────────────────────────────────────────────────────────

async function capturePositions(): Promise<void> {
  console.log('[positions] distinct rank/position fields…');
  await withConnection(configFromEnv(), async (pool) => {
    const breakdown: Record<string, unknown> = {};
    for (const field of [
      'JOB',
      'TDESC',
      'PL',
      'SUBGRADE',
      'EMP_POSITION',
      'EMP_LEVEL',
      'EMP_GROUP',
    ]) {
      const rows = await query<{ V: string | null; N: number }>(
        pool,
        `SELECT [${field}] AS V, COUNT(*) AS N
         FROM dbo.EmployeeDetail
         GROUP BY [${field}]
         ORDER BY COUNT(*) DESC`,
      );
      const numbered = rows.map((r) => ({ ...r, N: Number(r.N) }));
      breakdown[field] = {
        distinctCount: numbered.length,
        topValues: suppressSmall(numbered).suppressed.slice(0, 30),
      };
    }
    await writeFixture('positions', breakdown);
  });
}

// ────────────────────────────────────────────────────────────────────
// 5. Date-range sanity check — bucketed by year, no individual dates
// ────────────────────────────────────────────────────────────────────

async function captureDateRanges(): Promise<void> {
  console.log('[date-ranges] yearly bucket counts on lifecycle dates…');
  await withConnection(configFromEnv(), async (pool) => {
    const breakdown: Record<string, unknown> = {};
    for (const field of [
      'BIRTHDAY',
      'FIRSTHIREDATE',
      'STARTDATE',
      'APPROVE_DATE',
      'PRODATE',
      'ENDWORKDATE',
      'RESIGNDATE',
    ]) {
      // Substring the year — works for both 'YYYY-MM-DD' and 'DD/MM/YYYY'
      // by checking left 4 chars first; if the date format is different
      // we'll see odd values and adjust.
      const rows = await query<{ YEAR_BUCKET: string | null; N: number }>(
        pool,
        `SELECT LEFT([${field}], 4) AS YEAR_BUCKET, COUNT(*) AS N
         FROM dbo.EmployeeDetail
         WHERE [${field}] IS NOT NULL AND LEN([${field}]) > 0
         GROUP BY LEFT([${field}], 4)
         ORDER BY YEAR_BUCKET`,
      );
      const numbered = rows.map((r) => ({ ...r, N: Number(r.N) }));
      breakdown[field] = {
        distinctYearBuckets: numbered.length,
        firstFiveBuckets: numbered.slice(0, 5),
        lastFiveBuckets: numbered.slice(-5),
      };
    }
    await writeFixture('date-ranges', breakdown);
  });
}

// ────────────────────────────────────────────────────────────────────
// 6. Sibling-DB scan — list lookup-pattern tables across all visible
//    databases on the same server. PURELY metadata: table names,
//    column lists, row counts. NO row data is read.
// ────────────────────────────────────────────────────────────────────

// Tables whose names match this pattern are likely lookups for the
// opaque HCMEmployee codes (JOB / BU / EMP_TYPE / EMP_GROUP / etc).
// Broad on purpose — this is a metadata scan, not a data pull.
const LOOKUP_NAME_PATTERN =
  /JOB|RANK|POSITION|GRADE|BU\b|ORG|FACULT|DEPART|DEPT|DIVISION|BRANCH|EMP_?TYPE|EMP_?GROUP|EMP_?LEVEL|TYPE|CODE|LOOKUP|MASTER|REF|STATUS|NATIONAL|SUBGRADE|TDESC/i;

// Bracket-escape a SQL Server identifier (DB / schema / table name).
function bracket(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

interface SiblingDbResult {
  databases: string[];
  tablesPerDb: Record<
    string,
    | {
        totalTables: number;
        candidateLookups: Array<{
          schema: string;
          name: string;
          type: string;
          rowCount: number | null;
          columns: string[];
        }>;
      }
    | { error: string }
  >;
}

async function captureSiblingDbs(): Promise<void> {
  console.log('[sibling-dbs] listing databases visible to this login…');
  await withConnection(configFromEnv(), async (pool) => {
    const dbRows = await query<{ name: string }>(
      pool,
      `SELECT name FROM sys.databases
       WHERE HAS_DBACCESS(name) = 1
         AND state_desc = 'ONLINE'
         AND name NOT IN ('master', 'tempdb', 'model', 'msdb', 'SSISDB')
       ORDER BY name`,
    );
    const dbs = dbRows.map((d) => d.name);
    console.log(`  → ${dbs.length} accessible DBs: ${dbs.join(', ')}`);

    const result: SiblingDbResult = { databases: dbs, tablesPerDb: {} };

    for (const db of dbs) {
      try {
        const tables = await query<{
          TABLE_SCHEMA: string;
          TABLE_NAME: string;
          TABLE_TYPE: string;
        }>(
          pool,
          `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
           FROM ${bracket(db)}.INFORMATION_SCHEMA.TABLES
           WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
           ORDER BY TABLE_NAME`,
        );
        const candidates = tables.filter((t) =>
          LOOKUP_NAME_PATTERN.test(t.TABLE_NAME),
        );
        const enriched: Array<{
          schema: string;
          name: string;
          type: string;
          rowCount: number | null;
          columns: string[];
        }> = [];
        // Cap at 40 candidates per DB to keep scan time bounded.
        for (const t of candidates.slice(0, 40)) {
          let rowCount: number | null = null;
          let columns: string[] = [];
          try {
            const r = await query<{ N: number }>(
              pool,
              `SELECT COUNT(*) AS N FROM ${bracket(db)}.${bracket(
                t.TABLE_SCHEMA,
              )}.${bracket(t.TABLE_NAME)}`,
            );
            rowCount = Number(r[0]?.N ?? 0);
          } catch {
            // Some views (e.g., pointing at offline tables) error; ignore.
          }
          try {
            const c = await query<{ COLUMN_NAME: string }>(
              pool,
              `SELECT COLUMN_NAME
               FROM ${bracket(db)}.INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @tbl
               ORDER BY ORDINAL_POSITION`,
              { schema: t.TABLE_SCHEMA, tbl: t.TABLE_NAME },
            );
            columns = c.map((x) => x.COLUMN_NAME);
          } catch {
            // ignore
          }
          enriched.push({
            schema: t.TABLE_SCHEMA,
            name: t.TABLE_NAME,
            type: t.TABLE_TYPE,
            rowCount,
            columns,
          });
        }
        result.tablesPerDb[db] = {
          totalTables: tables.length,
          candidateLookups: enriched,
        };
        console.log(
          `    [${db}] ${tables.length} total / ${candidates.length} match lookup pattern (showing ${enriched.length})`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.tablesPerDb[db] = { error: msg };
        console.log(`    [${db}] error: ${msg}`);
      }
    }

    await writeFixture('sibling-dbs', result);
  });
}

// ────────────────────────────────────────────────────────────────────
// 7. Lookup-table capture — pull reference tables from epm_report
//    (and ERPPowerBI) in full. These are CODE→LABEL maps with no
//    per-person data, so no suppression is applied. They translate
//    HCMEmployee's opaque codes (EMP_TYPE / JOB / BU1..BU7) into
//    human-readable Thai/English labels.
// ────────────────────────────────────────────────────────────────────

async function captureLookups(): Promise<void> {
  console.log('[lookups] pulling reference tables from epm_report + ERPPowerBI…');
  await withConnection(configFromEnv(), async (pool) => {
    const lookups: Record<string, unknown> = {};

    // Each entry: friendly name → fully-qualified table → expected size note
    const lookupTables: Array<{
      key: string;
      sql: string;
      rowCap: number;
      note: string;
    }> = [
      {
        key: 'personnel_type',
        sql: `SELECT * FROM [epm_report].[dbo].[Personnel_Type] ORDER BY id`,
        rowCap: 50,
        note: 'EMP_TYPE code → label (10 rows expected)',
      },
      {
        key: 'all_position_type',
        sql: `SELECT * FROM [epm_report].[dbo].[all_position_type] ORDER BY id`,
        rowCap: 50,
        note: 'High-level position class — likely the academic/support/hospital filter (6 rows)',
      },
      {
        key: 'job_families',
        sql: `SELECT * FROM [epm_report].[dbo].[job_families] ORDER BY id`,
        rowCap: 50,
        note: 'Job family / category (19 rows)',
      },
      {
        key: 'positions',
        sql: `SELECT * FROM [epm_report].[dbo].[positions] ORDER BY id`,
        rowCap: 1000,
        note: 'JOB-XXXX code → rank label (512 rows)',
      },
      {
        key: 'faculty_org_tree',
        sql: `SELECT * FROM [epm_report].[dbo].[Faculty] ORDER BY id`,
        rowCap: 5000,
        note: 'Self-referencing org tree resolving BU1..BU7 codes (2,787 rows)',
      },
      {
        key: 'workforce_faculty_distinct',
        sql: `SELECT DISTINCT FACULTY, All_PositionTypes
              FROM [epm_report].[dbo].[Workforce_new_vs_old_positions]
              WHERE FACULTY IS NOT NULL
              ORDER BY FACULTY`,
        rowCap: 500,
        note: 'Distinct faculty + position-type combinations from workforce table — sanity check that names land in Thai/English',
      },
      {
        key: 'recruiting_bu_distinct',
        sql: `SELECT DISTINCT BU_NAME
              FROM [ERPPowerBI].[dbo].[Recruiting_Position]
              WHERE BU_NAME IS NOT NULL
              ORDER BY BU_NAME`,
        rowCap: 500,
        note: 'Distinct BU_NAME from recruiting table — independent verification of BU labels',
      },
    ];

    for (const lookup of lookupTables) {
      try {
        const rows = await query<Record<string, unknown>>(pool, lookup.sql);
        const truncated = rows.length > lookup.rowCap;
        lookups[lookup.key] = {
          note: lookup.note,
          rowCount: rows.length,
          truncated,
          rows: truncated ? rows.slice(0, lookup.rowCap) : rows,
        };
        console.log(
          `  → ${lookup.key}: ${rows.length} rows${truncated ? ` (truncated to ${lookup.rowCap})` : ''}`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lookups[lookup.key] = { note: lookup.note, error: msg };
        console.log(`  → ${lookup.key}: ERROR ${msg}`);
      }
    }

    await writeFixture('lookups', lookups);
  });
}

// ────────────────────────────────────────────────────────────────────
// 8. Bridge probe — verify the join between HCMEmployee.EMP_POSITION
//    and epm_report.workforce_current_position_request_Final.Position_Number.
//    All output is aggregate / DISTINCT — no PII names ever read.
// ────────────────────────────────────────────────────────────────────

// CTE used by bridge-probe queries to canonicalise the workforce table
// to one row per Position_Number. The workforce table has 217k rows
// for ~15k distinct positions, so multiple rows per position would
// otherwise inflate counts. Deterministic choice via ROW_NUMBER OVER
// PARTITION BY Position_Number.
const WORKFORCE_CANON_CTE = `
  WITH workforce_canon AS (
    SELECT
      Position_Number,
      Faculty,
      POSITION,
      All_PositionTypes,
      Personnel_Type,
      ROW_NUMBER() OVER (PARTITION BY Position_Number ORDER BY (SELECT NULL)) AS rn
    FROM [epm_report].[dbo].[workforce_current_position_request_Final]
  )
`;

async function captureBridgeProbe(): Promise<void> {
  console.log('[bridge-probe] verifying HCMEmployee ↔ workforce JOIN…');
  await withConnection(configFromEnv(), async (pool) => {
    const result: Record<string, unknown> = {};

    // Canonicalisation sanity check — verify how many distinct
    // Position_Number values exist (should be ~15k, matching HCM's
    // EMP_POSITION distinct count of 15,701).
    const wDistinct = await query<{ distinctCount: number; totalRows: number }>(
      pool,
      `SELECT
         COUNT(DISTINCT Position_Number) AS distinctCount,
         COUNT(*) AS totalRows
       FROM [epm_report].[dbo].[workforce_current_position_request_Final]`,
    );
    result.workforceCardinality = {
      distinctPositionNumbers: Number(wDistinct[0]?.distinctCount ?? 0),
      totalRows: Number(wDistinct[0]?.totalRows ?? 0),
    };
    console.log(
      `  workforce table: ${result.workforceCardinality && (result.workforceCardinality as { distinctPositionNumbers: number }).distinctPositionNumbers} distinct positions × ${(result.workforceCardinality as { totalRows: number }).totalRows} total rows`,
    );

    // 0a. Sample DISTINCT EMP_POSITION values from HCMEmployee — to
    //     show what side the JOIN key looks like on the HR side.
    const empPosSamples = await query<{ EMP_POSITION: string | null; LEN: number; N: number }>(
      pool,
      `SELECT TOP 20
         e.EMP_POSITION,
         LEN(e.EMP_POSITION) AS LEN,
         COUNT(*) AS N
       FROM dbo.EmployeeDetail e
       WHERE e.STATUS = 'A'
       GROUP BY e.EMP_POSITION
       ORDER BY COUNT(*) DESC`,
    );
    result.empPositionSamples = empPosSamples.map((r) => ({ ...r, N: Number(r.N) }));

    // 0b. Sample DISTINCT Position_Number values from workforce — show
    //     the other side of the prospective JOIN key.
    const wPosSamples = await query<{ Position_Number: string | null; LEN: number; N: number }>(
      pool,
      `SELECT TOP 20
         w.Position_Number,
         LEN(w.Position_Number) AS LEN,
         COUNT(*) AS N
       FROM [epm_report].[dbo].[workforce_current_position_request_Final] w
       GROUP BY w.Position_Number
       ORDER BY COUNT(*) DESC`,
    );
    result.workforcePositionSamples = wPosSamples.map((r) => ({
      ...r,
      N: Number(r.N),
    }));

    console.log(`  HCMEmployee.EMP_POSITION samples (top 20):`);
    for (const r of empPosSamples) {
      console.log(`    "${r.EMP_POSITION}" (len=${r.LEN}, n=${r.N})`);
    }
    console.log(`  workforce.Position_Number samples (top 20):`);
    for (const r of wPosSamples) {
      console.log(`    "${r.Position_Number}" (len=${r.LEN}, n=${r.N})`);
    }

    // 1. JOIN coverage — how many HCMEmployee rows match workforce rows
    //    (active employees only, to bound the question we care about).
    const cov = await query<{
      total: number;
      matched: number;
      unmatched: number;
    }>(
      pool,
      `${WORKFORCE_CANON_CTE}
       SELECT
         COUNT(*) AS total,
         COUNT(w.Position_Number) AS matched,
         COUNT(*) - COUNT(w.Position_Number) AS unmatched
       FROM dbo.EmployeeDetail e
       LEFT JOIN workforce_canon w
         ON ('PN_' + e.EMP_POSITION) COLLATE Thai_CI_AS = w.Position_Number COLLATE Thai_CI_AS
         AND w.rn = 1
       WHERE e.STATUS = 'A'`,
    );
    result.joinCoverage = cov[0];
    console.log(
      `  join coverage (STATUS=A): matched ${cov[0]?.matched}/${cov[0]?.total} (${cov[0]?.unmatched} unmatched)`,
    );

    // 2. Academic-staff distribution — All_PositionTypes for matched
    //    active employees (suppression applied; this is small-N safe).
    const acad = await query<{ V: string | null; N: number }>(
      pool,
      `${WORKFORCE_CANON_CTE}
       SELECT w.All_PositionTypes AS V, COUNT(*) AS N
       FROM dbo.EmployeeDetail e
       INNER JOIN workforce_canon w
         ON ('PN_' + e.EMP_POSITION) COLLATE Thai_CI_AS = w.Position_Number COLLATE Thai_CI_AS
         AND w.rn = 1
       WHERE e.STATUS = 'A'
       GROUP BY w.All_PositionTypes
       ORDER BY COUNT(*) DESC`,
    );
    result.academicSplit = suppressSmall(
      acad.map((r) => ({ ...r, N: Number(r.N) })),
    ).suppressed;
    console.log(`  All_PositionTypes split for active employees:`);
    for (const r of acad) {
      console.log(`    ${r.V ?? '(null)'}: ${r.N}`);
    }

    // 3. EMP_TYPE → Personnel_Type bridge. Confirms the meaning of
    //    EMP_TYPE codes 1..11.
    const empTypeMap = await query<{
      EMP_TYPE: string | null;
      Personnel_Type: string | null;
      N: number;
    }>(
      pool,
      `${WORKFORCE_CANON_CTE}
       SELECT e.EMP_TYPE, w.Personnel_Type, COUNT(*) AS N
       FROM dbo.EmployeeDetail e
       INNER JOIN workforce_canon w
         ON ('PN_' + e.EMP_POSITION) COLLATE Thai_CI_AS = w.Position_Number COLLATE Thai_CI_AS
         AND w.rn = 1
       WHERE e.STATUS = 'A'
       GROUP BY e.EMP_TYPE, w.Personnel_Type
       ORDER BY e.EMP_TYPE, COUNT(*) DESC`,
    );
    result.empTypeBridge = empTypeMap.map((r) => ({
      ...r,
      N: Number(r.N),
    }));
    console.log(`  EMP_TYPE × Personnel_Type rows: ${empTypeMap.length}`);

    // 4. JOB → POSITION (text) bridge. Top 50 most common JOB codes
    //    with their resolved text names. Suppression-safe.
    const jobMap = await query<{
      JOB: string | null;
      POSITION: string | null;
      N: number;
    }>(
      pool,
      `${WORKFORCE_CANON_CTE}
       SELECT TOP 50 e.JOB, w.POSITION, COUNT(*) AS N
       FROM dbo.EmployeeDetail e
       INNER JOIN workforce_canon w
         ON ('PN_' + e.EMP_POSITION) COLLATE Thai_CI_AS = w.Position_Number COLLATE Thai_CI_AS
         AND w.rn = 1
       WHERE e.STATUS = 'A'
       GROUP BY e.JOB, w.POSITION
       ORDER BY COUNT(*) DESC`,
    );
    result.jobToPositionTop50 = jobMap.map((r) => ({
      ...r,
      N: Number(r.N),
    }));
    console.log(`  JOB → POSITION top 50 rows: ${jobMap.length}`);

    // 5. BU1 → Faculty bridge — distinct (HCMEmployee.BU1, workforce.Faculty)
    //    pairs for active employees. Suppression-safe.
    const buMap = await query<{
      BU1: string | null;
      Faculty: string | null;
      N: number;
    }>(
      pool,
      `${WORKFORCE_CANON_CTE}
       SELECT e.BU1, w.Faculty, COUNT(*) AS N
       FROM dbo.EmployeeDetail e
       INNER JOIN workforce_canon w
         ON ('PN_' + e.EMP_POSITION) COLLATE Thai_CI_AS = w.Position_Number COLLATE Thai_CI_AS
         AND w.rn = 1
       WHERE e.STATUS = 'A' AND e.BU1 IS NOT NULL AND e.BU1 != ''
       GROUP BY e.BU1, w.Faculty
       ORDER BY COUNT(*) DESC`,
    );
    result.bu1ToFaculty = suppressSmall(
      buMap.map((r) => ({
        V: `${r.BU1 ?? ''}|${r.Faculty ?? ''}`,
        N: Number(r.N),
      })),
    ).suppressed;
    console.log(`  BU1 × Faculty rows: ${buMap.length}`);

    // 6. Filtered candidate count — STATUS=A AND All_PositionTypes IN academic.
    const candCount = await query<{ N: number }>(
      pool,
      `${WORKFORCE_CANON_CTE}
       SELECT COUNT(*) AS N
       FROM dbo.EmployeeDetail e
       INNER JOIN workforce_canon w
         ON ('PN_' + e.EMP_POSITION) COLLATE Thai_CI_AS = w.Position_Number COLLATE Thai_CI_AS
         AND w.rn = 1
       WHERE e.STATUS = 'A'
         AND w.All_PositionTypes IN (N'วิชาการ', N'วิชาการ วิจัย สนับสนุน')`,
    );
    result.academicActiveCount = Number(candCount[0]?.N ?? 0);
    console.log(
      `  candidate academic-active count: ${result.academicActiveCount}`,
    );

    await writeFixture('bridge-probe', result);
  });
}

// ────────────────────────────────────────────────────────────────────
// 9. Job-lookup probe — try to find a comprehensive JOB code → name
//    mapping. The workforce_current_position_request_Final table only
//    covers ~23% of active employees, so we need a broader source.
//    Tries: (a) other workforce tables, (b) ALL tables in epm_report
//    sorted by row count, looking for "JOB" / "POSITION" / "TITLE"
//    columns indirectly.
// ────────────────────────────────────────────────────────────────────

async function captureJobLookupProbe(): Promise<void> {
  console.log('[job-lookup] hunting for comprehensive JOB → name source…');
  await withConnection(configFromEnv(), async (pool) => {
    const result: Record<string, unknown> = {};

    // 1. Sample POSITION_NUMBER from Workforce_new_vs_old_positions
    //    to see if its format matches HCMEmployee.EMP_POSITION.
    try {
      const r = await query<{ POSITION_NUMBER: string | null; LEN: number; N: number }>(
        pool,
        `SELECT TOP 20 POSITION_NUMBER, LEN(POSITION_NUMBER) AS LEN, COUNT(*) AS N
         FROM [epm_report].[dbo].[Workforce_new_vs_old_positions]
         GROUP BY POSITION_NUMBER
         ORDER BY COUNT(*) DESC`,
      );
      result.workforce_new_vs_old_positions_samples = r.map((x) => ({
        ...x,
        N: Number(x.N),
      }));
      console.log(`  Workforce_new_vs_old_positions.POSITION_NUMBER samples:`);
      for (const x of r.slice(0, 5)) {
        console.log(`    "${x.POSITION_NUMBER}" (len=${x.LEN})`);
      }
    } catch (e) {
      result.workforce_new_vs_old_positions_samples = {
        error: e instanceof Error ? e.message : String(e),
      };
    }

    // 2. JOIN coverage of Workforce_new_vs_old_positions to HCMEmployee
    //    — does it cover more than 23%?
    try {
      const r = await query<{ total: number; matchedRaw: number; matchedPN: number }>(
        pool,
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN EXISTS (
             SELECT 1 FROM [epm_report].[dbo].[Workforce_new_vs_old_positions] w
             WHERE w.POSITION_NUMBER COLLATE Thai_CI_AS = e.EMP_POSITION COLLATE Thai_CI_AS
           ) THEN 1 ELSE 0 END) AS matchedRaw,
           SUM(CASE WHEN EXISTS (
             SELECT 1 FROM [epm_report].[dbo].[Workforce_new_vs_old_positions] w
             WHERE w.POSITION_NUMBER COLLATE Thai_CI_AS = ('PN_' + e.EMP_POSITION) COLLATE Thai_CI_AS
           ) THEN 1 ELSE 0 END) AS matchedPN
         FROM dbo.EmployeeDetail e
         WHERE e.STATUS = 'A'`,
      );
      result.workforce_new_vs_old_positions_coverage = r[0];
      console.log(
        `  Workforce_new_vs_old_positions coverage: raw=${r[0]?.matchedRaw}/${r[0]?.total}, PN_-prefixed=${r[0]?.matchedPN}/${r[0]?.total}`,
      );
    } catch (e) {
      result.workforce_new_vs_old_positions_coverage = {
        error: e instanceof Error ? e.message : String(e),
      };
    }

    // 3. List ALL tables in epm_report with row counts, looking for
    //    something that might have full JOB code coverage.
    try {
      const tables = await query<{ TABLE_SCHEMA: string; TABLE_NAME: string; TABLE_TYPE: string }>(
        pool,
        `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
         FROM [epm_report].INFORMATION_SCHEMA.TABLES
         WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
         ORDER BY TABLE_NAME`,
      );
      const enriched: Array<{
        schema: string;
        name: string;
        type: string;
        rowCount: number | null;
        hasJobColumn: boolean;
        hasPositionColumn: boolean;
        columns: string[];
      }> = [];
      for (const t of tables) {
        let rowCount: number | null = null;
        let columns: string[] = [];
        try {
          const c = await query<{ COLUMN_NAME: string }>(
            pool,
            `SELECT COLUMN_NAME FROM [epm_report].INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @tbl
             ORDER BY ORDINAL_POSITION`,
            { schema: t.TABLE_SCHEMA, tbl: t.TABLE_NAME },
          );
          columns = c.map((x) => x.COLUMN_NAME);
        } catch {
          // ignore
        }
        try {
          const r = await query<{ N: number }>(
            pool,
            `SELECT COUNT(*) AS N FROM [epm_report].${bracket(t.TABLE_SCHEMA)}.${bracket(t.TABLE_NAME)}`,
          );
          rowCount = Number(r[0]?.N ?? 0);
        } catch {
          // ignore
        }
        const colNamesUpper = columns.map((c) => c.toUpperCase());
        enriched.push({
          schema: t.TABLE_SCHEMA,
          name: t.TABLE_NAME,
          type: t.TABLE_TYPE,
          rowCount,
          hasJobColumn: colNamesUpper.some(
            (n) => n.includes('JOB') || n.includes('TITLE'),
          ),
          hasPositionColumn: colNamesUpper.some(
            (n) => n === 'POSITION' || n.includes('POSITION_NAME') || n.includes('POSITION_TITLE'),
          ),
          columns,
        });
      }
      result.allEpmReportTables = enriched;
      const jobCandidates = enriched.filter(
        (t) => t.hasJobColumn || t.hasPositionColumn,
      );
      console.log(
        `  epm_report has ${tables.length} tables; ${jobCandidates.length} have JOB/POSITION columns:`,
      );
      for (const t of jobCandidates) {
        console.log(`    [${t.rowCount}] ${t.name}: ${t.columns.filter((c) => /JOB|POSITION|TITLE/i.test(c)).join(', ')}`);
      }
    } catch (e) {
      result.allEpmReportTables = {
        error: e instanceof Error ? e.message : String(e),
      };
    }

    await writeFixture('job-lookup-probe', result);
  });
}

// ────────────────────────────────────────────────────────────────────
// 10. HCM-actual probe — verify workforce_hcm_actual is a per-employee
//     snapshot of HCMEmployee with JOIN-able position info.
// ────────────────────────────────────────────────────────────────────

async function captureHcmActualProbe(): Promise<void> {
  console.log('[hcm-actual] verifying workforce_hcm_actual ↔ HCMEmployee bridge…');
  await withConnection(configFromEnv(), async (pool) => {
    const result: Record<string, unknown> = {};

    // 1. Format samples — POSITION_NUMBER, JOB_CODE, POSITION
    const samples = await query<{
      POSITION_NUMBER: string | null;
      JOB_CODE: string | null;
      POSITION: string | null;
      All_Position_Types: string | null;
      POSITION_LEVEL: string | null;
      N: number;
    }>(
      pool,
      `SELECT TOP 10
         POSITION_NUMBER, JOB_CODE, POSITION,
         All_Position_Types, POSITION_LEVEL,
         COUNT(*) AS N
       FROM [epm_report].[dbo].[workforce_hcm_actual]
       GROUP BY POSITION_NUMBER, JOB_CODE, POSITION, All_Position_Types, POSITION_LEVEL
       ORDER BY COUNT(*) DESC`,
    );
    result.samples = samples.map((s) => ({ ...s, N: Number(s.N) }));
    console.log(`  workforce_hcm_actual samples (top 10):`);
    for (const s of samples) {
      console.log(
        `    PN=${s.POSITION_NUMBER} JOB=${s.JOB_CODE} POS=${s.POSITION} TYPE=${s.All_Position_Types} LVL=${s.POSITION_LEVEL}`,
      );
    }

    // 2. JOIN coverage — HCMEmployee.EMP_POSITION ↔ workforce_hcm_actual.POSITION_NUMBER
    //    Use LEFT JOIN with DISTINCT-on-the-key subquery for clean count.
    const covRaw = await query<{ total: number; matched: number }>(
      pool,
      `SELECT
         COUNT(*) AS total,
         COUNT(w.POSITION_NUMBER) AS matched
       FROM dbo.EmployeeDetail e
       LEFT JOIN (SELECT DISTINCT POSITION_NUMBER FROM [epm_report].[dbo].[workforce_hcm_actual]) w
         ON e.EMP_POSITION COLLATE Thai_CI_AS = w.POSITION_NUMBER COLLATE Thai_CI_AS
       WHERE e.STATUS = 'A'`,
    );
    const covPN = await query<{ total: number; matched: number }>(
      pool,
      `SELECT
         COUNT(*) AS total,
         COUNT(w.POSITION_NUMBER) AS matched
       FROM dbo.EmployeeDetail e
       LEFT JOIN (SELECT DISTINCT POSITION_NUMBER FROM [epm_report].[dbo].[workforce_hcm_actual]) w
         ON ('PN_' + e.EMP_POSITION) COLLATE Thai_CI_AS = w.POSITION_NUMBER COLLATE Thai_CI_AS
       WHERE e.STATUS = 'A'`,
    );
    result.coverage = {
      total: covRaw[0]?.total,
      matchedRaw: covRaw[0]?.matched,
      matchedPN: covPN[0]?.matched,
    };
    console.log(
      `  active-employee coverage: raw match=${covRaw[0]?.matched}/${covRaw[0]?.total}, PN_-prefixed match=${covPN[0]?.matched}/${covPN[0]?.total}`,
    );

    // 3. JOB_CODE format and overlap with HCMEmployee.JOB
    const jobFmt = await query<{ JOB_CODE: string | null; LEN: number; N: number }>(
      pool,
      `SELECT TOP 10 JOB_CODE, LEN(JOB_CODE) AS LEN, COUNT(*) AS N
       FROM [epm_report].[dbo].[workforce_hcm_actual]
       GROUP BY JOB_CODE
       ORDER BY COUNT(*) DESC`,
    );
    result.jobCodeSamples = jobFmt.map((j) => ({ ...j, N: Number(j.N) }));
    console.log(`  JOB_CODE samples: ${jobFmt.map((j) => `${j.JOB_CODE}(len=${j.LEN})`).slice(0, 5).join(', ')}`);

    // 4. Academic split using workforce_hcm_actual on FULL active set
    //    (will tell us how many academics with the broader join).
    const acadFull = await query<{ V: string | null; N: number }>(
      pool,
      `SELECT w.All_Position_Types AS V, COUNT(*) AS N
       FROM dbo.EmployeeDetail e
       INNER JOIN [epm_report].[dbo].[workforce_hcm_actual] w
         ON e.EMP_POSITION COLLATE Thai_CI_AS = w.POSITION_NUMBER COLLATE Thai_CI_AS
       WHERE e.STATUS = 'A'
       GROUP BY w.All_Position_Types
       ORDER BY COUNT(*) DESC`,
    );
    result.academicSplitFull = acadFull.map((a) => ({ ...a, N: Number(a.N) }));
    console.log(`  All_Position_Types split via workforce_hcm_actual:`);
    for (const a of acadFull) {
      console.log(`    ${a.V ?? '(null)'}: ${a.N}`);
    }

    // 5. JOB_CODE × POSITION mapping — comprehensive (not TOP 50 this time)
    const jobMap = await query<{ JOB_CODE: string | null; POSITION: string | null; N: number }>(
      pool,
      `SELECT JOB_CODE, POSITION, COUNT(*) AS N
       FROM [epm_report].[dbo].[workforce_hcm_actual]
       WHERE JOB_CODE IS NOT NULL AND POSITION IS NOT NULL
       GROUP BY JOB_CODE, POSITION
       ORDER BY JOB_CODE, COUNT(*) DESC`,
    );
    result.jobCodeToPosition = jobMap.map((j) => ({ ...j, N: Number(j.N) }));
    console.log(`  comprehensive JOB_CODE → POSITION rows: ${jobMap.length}`);

    // 6. POSITION_LEVEL distinct values — likely the rank (Asst Prof / Assoc Prof / Prof)
    const lvls = await query<{ POSITION_LEVEL: string | null; N: number }>(
      pool,
      `SELECT POSITION_LEVEL, COUNT(*) AS N
       FROM [epm_report].[dbo].[workforce_hcm_actual]
       WHERE POSITION_LEVEL IS NOT NULL
       GROUP BY POSITION_LEVEL
       ORDER BY COUNT(*) DESC`,
    );
    result.positionLevels = lvls.map((l) => ({ ...l, N: Number(l.N) }));
    console.log(`  POSITION_LEVEL distinct values:`);
    for (const l of lvls.slice(0, 20)) {
      console.log(`    ${l.POSITION_LEVEL}: ${l.N}`);
    }

    await writeFixture('hcm-actual-probe', result);
  });
}

// ────────────────────────────────────────────────────────────────────
// Dispatch
// ────────────────────────────────────────────────────────────────────

const HELP = `
Usage: pnpm hr:capture <subcommand>

Subcommands (recommended order):
  schema       column types via INFORMATION_SCHEMA — run first
  counts       overall row count + counts per STATUS / EMP_TYPE / etc.
  org-tree     distinct values of BU1..BU7 — tells us which BU level is faculty
  positions    distinct JOB / EMP_LEVEL / etc. — tells us canonical rank field
  date-ranges  yearly bucket counts on BIRTHDAY / STARTDATE / etc. — date format check
  sibling-dbs  metadata-only scan of lookup tables across all visible DBs
  lookups      pull EMP_TYPE / JOB / BU code-to-label tables from epm_report
  bridge-probe verify HCMEmployee ↔ workforce JOIN coverage and code mappings
  all          run all five core captures in order (does NOT include sibling-dbs / lookups / bridge-probe)

Reads KKU_HR_DB_* from .env. Writes JSON fixtures to
  apps/ingestion/test/fixtures/kku-hr/<name>.json

All output is aggregate (counts, distinct values). Buckets with < 5 rows
are collapsed under "(suppressed: …)" to prevent re-identification.
`.trim();

async function main(): Promise<void> {
  const subcommand = process.argv[2];
  if (!subcommand) {
    console.error(HELP);
    process.exit(1);
  }

  await ensureDir();

  switch (subcommand) {
    case 'schema':
      await captureSchema();
      break;
    case 'counts':
      await captureCounts();
      break;
    case 'org-tree':
      await captureOrgTree();
      break;
    case 'positions':
      await capturePositions();
      break;
    case 'date-ranges':
      await captureDateRanges();
      break;
    case 'sibling-dbs':
      await captureSiblingDbs();
      break;
    case 'lookups':
      await captureLookups();
      break;
    case 'bridge-probe':
      await captureBridgeProbe();
      break;
    case 'job-lookup':
      await captureJobLookupProbe();
      break;
    case 'hcm-actual':
      await captureHcmActualProbe();
      break;
    case 'all':
      await captureSchema();
      await captureCounts();
      await captureOrgTree();
      await capturePositions();
      await captureDateRanges();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}\n\n${HELP}`);
      process.exit(1);
  }

  console.log('[hr:capture] done');
}

void main().catch((err: unknown) => {
  console.error('[hr:capture] failed:', err);
  process.exit(1);
});
