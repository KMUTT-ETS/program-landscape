#!/usr/bin/env tsx
// ────────────────────────────────────────────────────────────────────────────
// Capture aggregated samples from the KKU Registrar Oracle views.
//
// Run locally on the dev machine (must be on KKU's internal network) with
// KKU_REGISTRY_DB_PASSWORD set in .env. Outputs JSON fixtures under
// apps/ingestion/test/fixtures/kku-registry/.
//
// Usage:
//   pnpm registry:capture schema      # introspect ALL_TAB_COLUMNS — run first
//   pnpm registry:capture counts      # row count per view
//   pnpm registry:capture statuses    # distinct STUDENTSTATUS / ENTRYTYPE values
//   pnpm registry:capture aggregate   # programme tuples + status vocab + counts
//   pnpm registry:capture all         # all of the above, in order
//
// All output is **aggregated at source and suppressed below a k-anonymity
// floor of 5** before it is written. No row is an identifier, and no row
// describes a group small enough to single a student out. Safe to commit.
//
// This was not always true. Until 2026-08-27 the `aggregate` subcommand
// wrote every group the registrar returned, including 79,465 demographic
// rows and 12,888 status rows that described exactly one student
// (programme x cohort x gender x home province x nationality is amply
// re-identifying at N=1). If you widen a GROUP BY here, re-check the
// smallest cell it can produce before you commit the output.
//
// On failure: the most common cause is a column name mismatch between
// what we assume (from the registrar info PDF) and the actual view
// schema. Run `schema` first to confirm column names before `aggregate`.
// ────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { configFromEnv, query, withConnection } from '../lib/oracle-client';

// Load .env from cwd (repo root) without adding a dotenv dep. Node 20.12+
// has process.loadEnvFile but we hand-roll for older runtimes.
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
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const VIEWS = [
  'VIEW_STUDENT_DETAIL',
  'VIEW_STUDENT_DETAIL_ALL',
  'VIEW_STUDENT_DETAIL_ALUMNI',
  'VIEWSTUDENTINFO',
  'VIEWSTUDENTENROLLFEE',
] as const;

const FIXTURE_DIR = path.resolve(
  __dirname,
  '../../test/fixtures/kku-registry',
);

// Minimum cell size. A group smaller than this never leaves Oracle — the
// HAVING clause is the trust boundary, not a filter we apply afterwards.
// Matches the posture kku-hr and kku-finance already enforce at source.
const MIN_CELL = 5;

async function ensureDir(): Promise<void> {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
}

async function writeFixture(name: string, data: unknown): Promise<void> {
  const target = path.join(FIXTURE_DIR, `${name}.json`);
  await fs.writeFile(target, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  → wrote ${path.relative(process.cwd(), target)}`);
}

// ──────────────────────────────────────────────────────────────────────
// 1. Schema introspection
// ──────────────────────────────────────────────────────────────────────

interface ColumnRow extends Record<string, unknown> {
  OWNER: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  DATA_LENGTH: number;
  NULLABLE: string;
  COLUMN_ID: number;
}

async function captureSchema(): Promise<void> {
  console.log('[schema] introspecting ALL_TAB_COLUMNS for POWERBI views…');
  await withConnection(configFromEnv(), async (conn) => {
    const rows = await query<ColumnRow>(
      conn,
      `SELECT owner, table_name, column_name, data_type, data_length, nullable, column_id
       FROM all_tab_columns
       WHERE owner = 'POWERBI'
         AND table_name IN (${VIEWS.map((v) => `'${v}'`).join(', ')})
       ORDER BY table_name, column_id`,
    );
    const grouped: Record<string, ColumnRow[]> = {};
    for (const row of rows) {
      const key = row.TABLE_NAME;
      grouped[key] ??= [];
      grouped[key].push(row);
    }
    const summary = Object.fromEntries(
      Object.entries(grouped).map(([view, cols]) => [view, cols.length]),
    );
    console.log('[schema] columns per view:', summary);
    await writeFixture('schema', grouped);
  });
}

// ──────────────────────────────────────────────────────────────────────
// 2. Row counts
// ──────────────────────────────────────────────────────────────────────

async function captureCounts(): Promise<void> {
  console.log('[counts] running COUNT(*) on each view…');
  await withConnection(configFromEnv(), async (conn) => {
    const counts: Record<string, number> = {};
    for (const view of VIEWS) {
      const rows = await query<{ N: number }>(
        conn,
        `SELECT COUNT(*) AS N FROM POWERBI.${view}`,
      );
      counts[view] = Number(rows[0]?.N ?? 0);
      console.log(`  ${view.padEnd(32)} ${counts[view].toLocaleString()}`);
    }
    await writeFixture('counts', counts);
  });
}

// ──────────────────────────────────────────────────────────────────────
// 3. Distinct status / entry-type values
// ──────────────────────────────────────────────────────────────────────

interface VocabCell {
  VAL: string | null;
  N: number | null;
  suppressed?: boolean;
}

// Keeps the value, withholds a count that would identify a group of fewer
// than MIN_CELL. `N: null` means "withheld", never "zero".
function suppressSmallCells(rows: { VAL: string; N: number }[]): VocabCell[] {
  return rows.map((r) =>
    r.N < MIN_CELL ? { VAL: r.VAL, N: null, suppressed: true } : { VAL: r.VAL, N: r.N },
  );
}

async function captureStatuses(): Promise<void> {
  console.log('[statuses] enumerating distinct STUDENTSTATUS / ENTRYTYPE…');
  await withConnection(configFromEnv(), async (conn) => {
    const distinctStatuses = await query<{ VAL: string; N: number }>(
      conn,
      `SELECT STUDENTSTATUS AS VAL, COUNT(*) AS N
       FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
       GROUP BY STUDENTSTATUS
       ORDER BY N DESC`,
    );
    const distinctEntryTypes = await query<{ VAL: string; N: number }>(
      conn,
      `SELECT ENTRYTYPE AS VAL, COUNT(*) AS N
       FROM POWERBI.VIEW_STUDENT_DETAIL
       GROUP BY ENTRYTYPE
       ORDER BY N DESC`,
    );
    const distinctLevels = await query<{ VAL: string; N: number }>(
      conn,
      `SELECT PROGRAMLEVEL AS VAL, COUNT(*) AS N
       FROM POWERBI.VIEW_STUDENT_DETAIL
       GROUP BY PROGRAMLEVEL
       ORDER BY N DESC`,
    );
    console.log(
      `  ${distinctStatuses.length} status values, ${distinctEntryTypes.length} entry types, ${distinctLevels.length} program levels`,
    );
    // The VALUE list is the point of this fixture, so nothing is dropped —
    // but a handful of statuses and entry types are held by a single student
    // university-wide, and some of those values are sensitive in themselves
    // (e.g. "expelled following a custodial sentence"). Withhold the count
    // below the k-anonymity floor and keep the vocabulary complete.
    await writeFixture('statuses', {
      suppression: {
        policy: `N >= ${MIN_CELL}`,
        note:
          'Vocabulary fixture: every distinct value is listed, but a count ' +
          'below the k-anonymity floor is withheld (N: null, suppressed: ' +
          'true) rather than the row being dropped.',
      },
      distinctStatuses: suppressSmallCells(distinctStatuses),
      distinctEntryTypes: suppressSmallCells(distinctEntryTypes),
      distinctLevels: suppressSmallCells(distinctLevels),
    });
  });
}

// ──────────────────────────────────────────────────────────────────────
// 4. Aggregation queries — programme tuples, status vocabulary, cohort counts
// ──────────────────────────────────────────────────────────────────────

// All three queries pull from VIEW_STUDENT_DETAIL_ALL which has ADMITACADYEAR
// + STUDENTSTATUS + demographics + parents' info — single-view, no
// JOINs needed. Years are Buddhist Era (BE = CE + 543); the connector
// converts at the transform layer.
//
// Q1 returns counts grouped by RAW STUDENTSTATUS (Thai). Bucketing
// (graduated / active / dropout / never-enrolled) happens in TS so it
// can be unit-tested and updated as new status values appear, without
// re-running SQL.
//
// The queries filter out rows with NULL faculty or program — those
// are malformed registrar entries (~handful), useless to us.

// Q0a: the programme catalogue vocabulary the mapping consumers actually
// need — faculty, programme, level, major. DISTINCT, no counts, so there is
// nothing to suppress: it says which programmes exist, not who is in them.
const Q0_PROGRAM_TUPLES = `
SELECT DISTINCT
  FACULTYNAME                AS FACULTY_NAME,
  PROGRAMNAME                AS PROGRAM_NAME,
  PROGRAMLEVEL               AS PROGRAM_LEVEL,
  MAJOR                      AS MAJOR
FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
WHERE FACULTYNAME IS NOT NULL AND PROGRAMNAME IS NOT NULL
ORDER BY FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL, MAJOR
`;

// Q0b: the registrar's status code table. DISTINCT (code, label), no counts.
// This is what status-mapping.test.ts asserts STATUS_BUCKET_MAP covers, so
// it must stay complete — hence no suppression, and hence no counts.
const Q0_STATUS_VOCABULARY = `
SELECT DISTINCT
  STUDENTSTATUSCODE          AS STATUS_CODE,
  STUDENTSTATUS              AS STATUS
FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
ORDER BY STUDENTSTATUSCODE
`;

// Q1: cohort flow counts. Bucketing into enrolled/dropout/graduated happens
// in the connector's transform layer, NOT in SQL, so the mapping is testable
// and easy to update. Cells below MIN_CELL are dropped server-side.
const Q1_STATUS_COUNTS = `
SELECT
  FACULTYNAME                AS FACULTY_NAME,
  PROGRAMNAME                AS PROGRAM_NAME,
  PROGRAMLEVEL               AS PROGRAM_LEVEL,
  MAJOR                      AS MAJOR,
  ADMITACADYEAR              AS COHORT_YEAR_BE,
  STUDENTSTATUS              AS STATUS,
  STUDENTSTATUSCODE          AS STATUS_CODE,
  COUNT(*)                   AS N
FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
WHERE FACULTYNAME IS NOT NULL AND PROGRAMNAME IS NOT NULL
GROUP BY
  FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL, MAJOR, ADMITACADYEAR,
  STUDENTSTATUS, STUDENTSTATUSCODE
HAVING COUNT(*) >= ${MIN_CELL}
ORDER BY
  FACULTYNAME, PROGRAMNAME, ADMITACADYEAR
`;

// The Q2 demographic histogram (programme × cohort × gender × home province ×
// nationality) is deliberately NOT captured any more. 79,465 of its 136,289
// groups held exactly one student, which is a re-identifying combination, and
// no consumer in this repo ever read it. If a future module genuinely needs
// demographic composition, take it from the `student_demographics` table the
// connector loads — do not re-add a committed fixture of it.

async function captureAggregate(): Promise<void> {
  console.log('[aggregate] programme tuples + status vocabulary + suppressed cohort counts…');
  await withConnection(configFromEnv(), async (conn) => {
    const programTuples = await query(conn, Q0_PROGRAM_TUPLES);
    console.log(`  Q0a returned ${programTuples.length.toLocaleString()} distinct programme tuples`);

    const statusVocabulary = await query(conn, Q0_STATUS_VOCABULARY);
    console.log(`  Q0b returned ${statusVocabulary.length.toLocaleString()} distinct status codes`);

    const statusCounts = await query(conn, Q1_STATUS_COUNTS);
    console.log(
      `  Q1 returned ${statusCounts.length.toLocaleString()} (program × cohort × status) cells at N >= ${MIN_CELL}`,
    );

    await writeFixture('aggregated', {
      capturedAt: new Date().toISOString(),
      // sourceHost / sourceService are deliberately NOT recorded — the
      // registrar's Oracle hostname and service name are infrastructure
      // detail, and this fixture is committed to a repo that external
      // universities can read.
      suppression: {
        policy: `N >= ${MIN_CELL}`,
        appliedTo: ['statusCounts'],
        droppedSeries: ['demographics'],
        note:
          'statusCounts cells below the k-anonymity floor are dropped, not ' +
          'zeroed — a missing cell means "fewer than 5, value withheld", not ' +
          '"nobody". programTuples and statusVocabulary carry no counts at ' +
          'all, so they are not subject to suppression.',
      },
      programTuples,
      statusVocabulary,
      statusCounts,
    });
  });
}

// ──────────────────────────────────────────────────────────────────────
// Dispatch
// ──────────────────────────────────────────────────────────────────────

const HELP = `
Usage: pnpm registry:capture <subcommand>

Subcommands (recommended order — commit each output as you go):
  schema      introspect ALL_TAB_COLUMNS for the 5 views in scope
  counts      row counts per view (sanity check before bigger queries)
  statuses    distinct STUDENTSTATUS / ENTRYTYPE / PROGRAMLEVEL values
  aggregate   programme tuples + status vocabulary + suppressed cohort counts
  all         run all four in order

Reads KKU_REGISTRY_DB_* from .env. Writes JSON fixtures to
  apps/ingestion/test/fixtures/kku-registry/<name>.json
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
    case 'statuses':
      await captureStatuses();
      break;
    case 'aggregate':
      await captureAggregate();
      break;
    case 'all':
      await captureSchema();
      await captureCounts();
      await captureStatuses();
      await captureAggregate();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}\n\n${HELP}`);
      process.exit(1);
  }

  console.log('[registry:capture] done');
}

void main().catch((err: unknown) => {
  console.error('[registry:capture] failed:', err);
  process.exit(1);
});
