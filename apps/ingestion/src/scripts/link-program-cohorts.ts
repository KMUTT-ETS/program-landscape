#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Per-program student cohort distribution — entry-year histogram.
//
// Entry year is derived from the FIRST 2 DIGITS of STUDENTCODE in
// Buddhist Era (e.g., "65" → BE 2565 → CE 2022). The KKU registrar
// uses 8-digit STUDENTCODEs prefixed with the BE entry year.
//
// Counts ONLY currently-enrolled students (STUDENTSTATUSCODE in the
// ACTIVE set: 5,6,10,11,12,13,14,16,39,90 — see status-mapping.ts).
// "Currently enrolled" = on-roll + on-leave + pending paperwork.
//
// Persists into StudentCohortDistribution per (program × entryYearBE).
// Idempotent — full delete-and-replace per program (one row per cohort
// year present, no stale rows after re-run).
//
// Usage:
//   pnpm programs:link-cohorts <code|mhesi|sequenceNo|id>     # one program
//   pnpm programs:link-cohorts --all                          # all programs with majors
//   pnpm programs:link-cohorts --all --dry-run                # preview only
// ─────────────────────────────────────────────────────────────────────────────

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import { prisma, type ProgramLevel } from '@kku/db';
import { withScriptRun } from '../lib/script-run';
import { OracleSession, configFromEnv as oracleConfigFromEnv } from '../lib/oracle-client';

const LEVEL_TO_THAI: Record<ProgramLevel, string> = {
  BACHELOR: 'ปริญญาตรี',
  MASTER: 'ปริญญาโท',
  DOCTORAL: 'ปริญญาเอก',
  HIGHER_GRAD_DIPLOMA: 'ประกาศนียบัตรบัณฑิตชั้นสูง',
};

// Derived from apps/ingestion/src/connectors/sources/kku-registry/status-mapping.ts
const ACTIVE_STATUS_CODES = [5, 6, 10, 11, 12, 13, 14, 16, 39, 90];

interface CliArgs {
  programArg: string | null;
  all: boolean;
  apply: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.find((a) => !a.startsWith('--')) ?? null;
  const all = argv.includes('--all');
  if (!positional && !all) {
    console.error(
      'Usage: pnpm programs:link-cohorts <code|mhesi|sequenceNo|id> | --all [--dry-run]',
    );
    process.exit(1);
  }
  return {
    programArg: positional,
    all,
    apply: !argv.includes('--dry-run'),
  };
}

interface ProgramRow {
  id: string;
  code: string;
  nameTh: string;
  level: ProgramLevel;
  majors: string[];
  faculty: { nameTh: string };
}

async function resolveProgram(arg: string): Promise<ProgramRow> {
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

interface CohortRow {
  ENTRY_YEAR_BE: number;
  STUDENT_COUNT: number;
}

async function fetchCohortDistribution(
  session: OracleSession,
  facultyNameTh: string,
  majorPattern: string,
  levelPattern: string,
): Promise<CohortRow[]> {
  // SUBSTR(STUDENTCODE, 1, 2) → 2-digit BE prefix → cast to NUMBER.
  // BE-prefixes have been 2-digit since the registrar's KKU coding
  // started (BE 25XX truncated to XX). E.g., "65xxxxxx" = BE 2565
  // entry. We add 2500 in TS to recover the full BE year.
  //
  // Aggregate-at-source: server-side GROUP BY + COUNT, no per-student
  // rows ever leave Oracle.
  const sql = `
    SELECT
      TO_NUMBER(SUBSTR(STUDENTCODE, 1, 2))  AS ENTRY_YEAR_BE,
      COUNT(*)                              AS STUDENT_COUNT
    FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
    WHERE MAJOR             LIKE :majorPattern
      AND PROGRAMLEVEL      LIKE :levelPattern
      AND FACULTYNAME       = :facultyName
      AND STUDENTSTATUSCODE IN (${ACTIVE_STATUS_CODES.join(',')})
      AND REGEXP_LIKE(STUDENTCODE, '^[0-9]{2}')
    GROUP BY TO_NUMBER(SUBSTR(STUDENTCODE, 1, 2))
    ORDER BY 1
  `;
  // Runs on the invocation-wide shared session — do NOT open a fresh
  // connection here; in --all mode this function fires once per program
  // (~300×) and per-call logins are what got the registry account locked.
  return session.run(async (conn) => {
    const result = await conn.execute<CohortRow>(
      sql,
      {
        majorPattern: `%${majorPattern}%`,
        levelPattern: `%${levelPattern}%`,
        facultyName: facultyNameTh,
      },
      { outFormat: 4002 /* OUT_FORMAT_OBJECT */ },
    );
    return (result.rows ?? []) as CohortRow[];
  });
}

async function processProgram(
  program: ProgramRow,
  apply: boolean,
  runId: string,
  session: OracleSession,
): Promise<{
  rows: number;
  total: number;
}> {
  const major = program.majors[0] ?? '';
  if (!major) {
    console.log(`  ⚠ ${program.code} has no major[0] — skipping`);
    return { rows: 0, total: 0 };
  }
  const levelTh = LEVEL_TO_THAI[program.level];
  const cohorts = await fetchCohortDistribution(session, program.faculty.nameTh, major, levelTh);

  // Convert 2-digit BE prefix to full BE year (e.g., 65 → 2565). Skip
  // entries newer than the next academic year — those are clearly
  // bogus registrar data (the registrar won't have legitimate
  // students with codes for cohorts beyond next year). KKU's academic
  // year starts in June, so before June the active year is BE−1.
  const nowCE = new Date().getUTCFullYear();
  const isBeforeJune = new Date().getUTCMonth() < 5;
  const currentAcademicBE = nowCE + 543 - (isBeforeJune ? 1 : 0);
  const maxEntryBE = currentAcademicBE + 1;
  const enriched = cohorts
    .map((r) => ({
      entryYearBE: 2500 + r.ENTRY_YEAR_BE,
      studentCount: Number(r.STUDENT_COUNT),
    }))
    .filter((r) => r.entryYearBE >= 2530 && r.entryYearBE <= maxEntryBE);

  const total = enriched.reduce((s, r) => s + r.studentCount, 0);
  console.log(`  ${program.code}: ${enriched.length} cohort year(s) · ${total} active students`);
  for (const r of enriched) {
    console.log(`    BE ${r.entryYearBE}: ${r.studentCount}`);
  }

  if (!apply || enriched.length === 0) return { rows: enriched.length, total };

  // Idempotent: replace all rows for this program in one transaction.
  await prisma.$transaction([
    prisma.studentCohortDistribution.deleteMany({ where: { programId: program.id } }),
    prisma.studentCohortDistribution.createMany({
      data: enriched.map((r) => ({
        programId: program.id,
        entryYearBE: r.entryYearBE,
        studentCount: r.studentCount,
        ingestionRunId: runId,
      })),
    }),
  ]);
  return { rows: enriched.length, total };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);

  // One Oracle login for the whole invocation — shared across every
  // program in --all mode (see OracleSession in lib/oracle-client.ts).
  const session = new OracleSession(oracleConfigFromEnv('KKU_REGISTRY_DB'));
  try {
    // Cohort data is derived from the registrar's student records → kku-registry.
    await withScriptRun('kku-registry', async ({ runId, setRecordsLoaded }) => {
      if (args.all) {
        const programs = await prisma.program.findMany({
          where: {
            // Canonical 297 only — cohort linking is part of the curriculum
            // pipeline and does not run against legacy/non-canonical rows.
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
        });
        console.log(`Programs to process: ${programs.length}\n`);
        let succeeded = 0;
        let failed = 0;
        let totalRows = 0;
        let totalStudents = 0;
        for (const p of programs) {
          try {
            const { rows, total } = await processProgram(p, args.apply, runId, session);
            if (rows > 0) succeeded++;
            totalRows += rows;
            totalStudents += total;
          } catch (err) {
            failed++;
            console.error(`  ✗ ${p.code} failed:`, err instanceof Error ? err.message : err);
          }
        }
        setRecordsLoaded(totalRows);
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Programs with cohort data: ${succeeded} / ${programs.length}`);
        console.log(`Programs failed: ${failed}`);
        console.log(`Total cohort-year rows: ${totalRows}`);
        console.log(`Total active students: ${totalStudents.toLocaleString()}`);
        return;
      }

      const program = await resolveProgram(args.programArg!);
      console.log(`Program: ${program.code} · ${program.nameTh}`);
      console.log(`Faculty: ${program.faculty.nameTh}`);
      console.log(
        `Filter:  MAJOR LIKE '%${program.majors[0]}%' AND PROGRAMLEVEL LIKE '%${LEVEL_TO_THAI[program.level]}%'\n`,
      );
      const { rows } = await processProgram(program, args.apply, runId, session);
      setRecordsLoaded(rows);
      if (args.apply) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const stored = await prisma.studentCohortDistribution.findMany({
          where: { programId: program.id },
          orderBy: { entryYearBE: 'asc' },
        });
        console.log(`Stored ${stored.length} StudentCohortDistribution rows`);
      }
    });
  } finally {
    await session.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
