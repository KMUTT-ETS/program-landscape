#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Per-program alumni status counts — bucketed roll-up of the registrar's
// `STUDENTSTATUS` values from `POWERBI.VIEW_STUDENT_DETAIL_ALUMNI`.
//
// Server-side `GROUP BY entry_year × status` keeps PDPA aggregate-only:
// per-student rows never leave Oracle. The connector receives status
// strings + counts only.
//
// Status bucketing happens in TS (8 buckets — see alumni-status-mapping.ts)
// so we can evolve the bucket definitions without touching SQL.
//
// Idempotent: full delete-and-replace per program. Re-run safe.
//
// Usage:
//   pnpm programs:link-alumni <code|mhesi|seqNo|id>      # single program
//   pnpm programs:link-alumni --all [--limit=N]          # bulk
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

import { loadOrganization, prisma, type ProgramLevel } from '@kku/db';
import { withScriptRun } from '../lib/script-run';
import { OracleSession, configFromEnv } from '../lib/oracle-client';
import {
  bucketAlumniStatus,
  type AlumniStatusBucket,
} from '../connectors/sources/kku-registry/alumni-status-mapping';

const LEVEL_TO_THAI: Record<ProgramLevel, string> = {
  BACHELOR: 'ปริญญาตรี',
  MASTER: 'ปริญญาโท',
  DOCTORAL: 'ปริญญาเอก',
  HIGHER_GRAD_DIPLOMA: 'ประกาศนียบัตรบัณฑิตชั้นสูง',
};

interface CliArgs {
  programArg: string | null;
  all: boolean;
  limit: number | null;
  apply: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.find((a) => !a.startsWith('--')) ?? null;
  const all = argv.includes('--all');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1] ?? '0', 10) : null;
  const apply = !argv.includes('--dry-run');
  if (!positional && !all) {
    console.error(
      'Usage: pnpm programs:link-alumni <code|mhesi|seq|id> | --all [--limit=N] [--dry-run]',
    );
    process.exit(1);
  }
  return { programArg: positional, all, limit, apply };
}

interface ProgramRow {
  id: string;
  code: string;
  nameTh: string;
  level: ProgramLevel;
  majors: string[];
  faculty: { nameTh: string };
}

async function resolveProgramIds(args: CliArgs): Promise<ProgramRow[]> {
  if (args.all) {
    return prisma.program.findMany({
      where: {
        // Canonical 297 only.
        sequenceNoFromSheet: { not: null },
        majors: { isEmpty: false },
      },
      select: {
        id: true,
        code: true,
        nameTh: true,
        level: true,
        majors: true,
        faculty: { select: { nameTh: true } },
      },
      orderBy: { code: 'asc' },
      ...(args.limit ? { take: args.limit } : {}),
    });
  }
  const arg = args.programArg!;
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
  if (!program) throw new Error(`Program not found for "${arg}"`);
  return [program];
}

interface AlumniRawRow {
  ENTRY_YEAR_BE: number;
  STUDENTSTATUS: string | null;
  N: number;
}

async function fetchAlumniCounts(
  session: OracleSession,
  facultyNameTh: string,
  majorPattern: string,
  levelPattern: string,
): Promise<AlumniRawRow[]> {
  // Server-side aggregate. STUDENTCODE first 2 digits = BE entry year.
  const sql = `
    SELECT
      TO_NUMBER(SUBSTR(STUDENTCODE, 1, 2)) AS ENTRY_YEAR_BE,
      STUDENTSTATUS,
      COUNT(*) AS N
    FROM POWERBI.VIEW_STUDENT_DETAIL_ALUMNI
    WHERE MAJOR             LIKE :majorPattern
      AND PROGRAMLEVEL      LIKE :levelPattern
      AND FACULTYNAME       = :facultyName
      AND REGEXP_LIKE(STUDENTCODE, '^[0-9]{2}')
    GROUP BY TO_NUMBER(SUBSTR(STUDENTCODE, 1, 2)), STUDENTSTATUS
    ORDER BY 1, 3 DESC
  `;
  // Shared invocation-wide session — one login for all programs, not
  // one per program (per-call logins are what got the account locked).
  return session.run(async (conn) => {
    const result = await conn.execute<AlumniRawRow>(
      sql,
      {
        majorPattern: `%${majorPattern}%`,
        levelPattern: `%${levelPattern}%`,
        facultyName: facultyNameTh,
      },
      { outFormat: 4002 },
    );
    return (result.rows ?? []) as AlumniRawRow[];
  });
}

async function processProgram(
  program: ProgramRow,
  apply: boolean,
  runId: string,
  session: OracleSession,
): Promise<{ rows: number; total: number }> {
  const major = program.majors[0] ?? '';
  if (!major) return { rows: 0, total: 0 };
  const levelTh = LEVEL_TO_THAI[program.level];
  const raw = await fetchAlumniCounts(session, program.faculty.nameTh, major, levelTh);

  // Bucket per (entry_year_be × bucket) and convert BE prefix → full BE year.
  // Skip entries newer than the next academic year (BE 2599 etc. are
  // bogus registrar data — saw "BE 2599 (CE 2056)" in initial run).
  const nowCE = new Date().getUTCFullYear();
  const isBeforeJune = new Date().getUTCMonth() < 5;
  const currentAcademicBE = nowCE + 543 - (isBeforeJune ? 1 : 0);
  const maxEntryBE = currentAcademicBE + 1;
  const aggregated = new Map<
    string,
    { entryYearBE: number; bucket: AlumniStatusBucket; count: number }
  >();
  let skippedFutureYears = 0;
  for (const r of raw) {
    const yr = 2500 + r.ENTRY_YEAR_BE;
    if (yr < 2530 || yr > maxEntryBE) {
      skippedFutureYears += Number(r.N);
      continue;
    }
    const bucket = bucketAlumniStatus(r.STUDENTSTATUS);
    const key = `${yr}-${bucket}`;
    const cur = aggregated.get(key);
    if (cur) cur.count += Number(r.N);
    else aggregated.set(key, { entryYearBE: yr, bucket, count: Number(r.N) });
  }
  if (skippedFutureYears > 0) {
    console.log(
      `  ⚠ Skipped ${skippedFutureYears} record(s) with entry year > BE ${maxEntryBE} (next academic year)`,
    );
  }
  const enriched = [...aggregated.values()].sort(
    (a, b) => a.entryYearBE - b.entryYearBE || a.bucket.localeCompare(b.bucket),
  );
  const total = enriched.reduce((s, r) => s + r.count, 0);

  console.log(
    `  ${program.code}: ${enriched.length} (year × bucket) cells · ${total} alumni records`,
  );
  // Show by-year totals for visibility
  const byYear = new Map<number, number>();
  for (const e of enriched) byYear.set(e.entryYearBE, (byYear.get(e.entryYearBE) ?? 0) + e.count);
  for (const [yr, n] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`    BE ${yr}: ${n}`);
  }

  if (!apply || enriched.length === 0) return { rows: enriched.length, total };

  await prisma.$transaction([
    prisma.alumniCohortStatus.deleteMany({ where: { programId: program.id } }),
    prisma.alumniCohortStatus.createMany({
      data: enriched.map((e) => ({
        programId: program.id,
        entryYearBE: e.entryYearBE,
        statusBucket: e.bucket,
        count: e.count,
        ingestionRunId: runId,
      })),
    }),
  ]);
  return { rows: enriched.length, total };
}

async function main(): Promise<void> {
  await loadOrganization();
  const args = parseArgs(process.argv.slice(2));
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);

  const programs = await resolveProgramIds(args);
  console.log(`Programs to process: ${programs.length}\n`);

  // Wrap the work in a tracked IngestionRun on kku-registry — alumni cohort
  // data is derived from the registrar's VIEW_STUDENT_DETAIL_ALUMNI view, so
  // its provenance maps to the kku-registry DataSource. The synthetic run
  // tags every alumni_cohort_statuses row this script writes so they survive
  // the data-quality.v2 STRICT-mode filter (see docs/evaluation-pipeline.md §13).
  // One Oracle login for the whole invocation — shared across every
  // program (see OracleSession in lib/oracle-client.ts).
  const session = new OracleSession(configFromEnv('KKU_REGISTRY_DB'));
  try {
    await withScriptRun('kku-registry', async ({ runId, setRecordsLoaded }) => {
      let succeeded = 0;
      let failed = 0;
      let totalRows = 0;
      let totalRecords = 0;

      for (const p of programs) {
        try {
          const { rows, total } = await processProgram(p, args.apply, runId, session);
          if (rows > 0) succeeded++;
          totalRows += rows;
          totalRecords += total;
        } catch (err) {
          failed++;
          console.error(`  ✗ ${p.code} failed:`, err instanceof Error ? err.message : err);
        }
      }

      setRecordsLoaded(totalRows);
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Programs with alumni data: ${succeeded} / ${programs.length}`);
      console.log(`Failed:                    ${failed}`);
      console.log(`Total (year × bucket) cells: ${totalRows}`);
      console.log(`Total alumni records:        ${totalRecords.toLocaleString()}`);
    });
  } finally {
    await session.close();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
