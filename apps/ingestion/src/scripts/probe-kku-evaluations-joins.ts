#!/usr/bin/env tsx
// ───────────────────────────────────────────────────────────────────────
// Follow-up probe — natural key + join viability for EVALUATE_INSTRUCTOR.
//
// What this verifies:
//   [A] Natural row key candidates:
//         (ACADYEAR, SEMESTER, CLASSID, QUESTIONID, OFFICERID)
//         (ACADYEAR, SEMESTER, COURSECODE, SECTION, QUESTIONID, OFFICERID)
//       — confirm one of these uniquely identifies a row
//   [B] Team-teaching duplication shape:
//         How many distinct OFFICERIDs per (CLASSID, QUESTIONID)?
//   [C] Join keys with the universe of OFFICERID / KKUMAIL we already have
//       (FacultyMember.kkuMailFromHr, employeeCode)
//   [D] OFFICERID identity — is it FacultyMember.employeeId? Range +
//       presence vs HR-sourced employee codes.
//   [E] FACULTYID → registry meaning (sample distinct values + check
//       against existing Faculty.id or another lookup).
//   [F] Score columns sanity — POINT vs POINT_AVG vs TOTAL_STUDENT:
//       does POINT = POINT_AVG * TOTAL_STUDENT?
//   [G] Distinct (Y,SEM,CLASSID,QID,OFFICERID) vs row count — uniqueness.
//
// Read-only, aggregate-only.
// ───────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configFromEnv, query, withConnection } from '../lib/oracle-client';

loadDotEnv(path.resolve(process.cwd(), '.env'));
function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

const VIEW = 'POWERBI.EVALUATE_INSTRUCTOR';
const FIXTURE_DIR = path.resolve(process.cwd(), 'apps/ingestion/test/fixtures/kku-evaluations');

function writeFixture(name: string, payload: unknown): void {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(path.join(FIXTURE_DIR, `${name}.json`), JSON.stringify(payload, null, 2));
}

async function main(): Promise<void> {
  const cfg = configFromEnv('KKU_REGISTRY_DB');
  await withConnection(cfg, async (conn) => {
    console.log(`▶ EVALUATE_INSTRUCTOR — follow-up probe`);

    // [A] Natural key check — every row uniquely identified by:
    //     (ACADYEAR, SEMESTER, CLASSID, QUESTIONID, OFFICERID) ?
    console.log('\n[A] Natural row-key uniqueness:');
    const key1 = await query<{ R: number; D: number }>(
      conn,
      `SELECT COUNT(*) AS R,
              COUNT(DISTINCT ACADYEAR || '|' || SEMESTER || '|' || CLASSID || '|' || QUESTIONID || '|' || OFFICERID) AS D
       FROM ${VIEW}`,
    );
    const r1 = key1[0]!;
    console.log(
      `  rows=${Number(r1.R).toLocaleString()}  distinct(Y,SEM,CLASSID,QID,OFFICERID)=${Number(r1.D).toLocaleString()}  ${Number(r1.R) === Number(r1.D) ? '✓ UNIQUE' : '⚠ NOT unique'}`,
    );

    // Compare with (Y, SEM, COURSECODE, SECTION, QID, OFFICERID)
    const key2 = await query<{ D: number }>(
      conn,
      `SELECT COUNT(DISTINCT ACADYEAR || '|' || SEMESTER || '|' || COURSECODE || '|' || SECTION || '|' || QUESTIONID || '|' || OFFICERID) AS D
       FROM ${VIEW}`,
    );
    console.log(
      `  distinct(Y,SEM,COURSECODE,SECTION,QID,OFFICERID)=${Number(key2[0]?.D ?? 0).toLocaleString()}  ${Number(key2[0]?.D ?? 0) === Number(r1.R) ? '✓ same' : '⚠ differs (CLASSID is more specific)'}`,
    );

    // [B] Team-teaching: how many OFFICERIDs per (CLASSID, QUESTIONID)?
    console.log('\n[B] Team-teaching duplication:');
    const team = await query<{ N: number; MX: number; AVG: number; ZERO: number }>(
      conn,
      `SELECT COUNT(*) AS N, MAX(C) AS MX, AVG(C) AS AVG,
              SUM(CASE WHEN C = 1 THEN 1 ELSE 0 END) AS ZERO
       FROM (
         SELECT CLASSID, QUESTIONID, COUNT(DISTINCT OFFICERID) AS C
         FROM ${VIEW} GROUP BY CLASSID, QUESTIONID
       )`,
    );
    const tt = team[0]!;
    console.log(
      `  (class,question) groups=${Number(tt.N).toLocaleString()}  single-teacher=${Number(tt.ZERO).toLocaleString()}  max-team=${tt.MX}  avg=${Number(tt.AVG).toFixed(2)}`,
    );
    const teamDist = await query<{ C: number; N: number }>(
      conn,
      `SELECT C, COUNT(*) AS N FROM (
         SELECT CLASSID, QUESTIONID, COUNT(DISTINCT OFFICERID) AS C
         FROM ${VIEW} GROUP BY CLASSID, QUESTIONID
       ) GROUP BY C ORDER BY C`,
    );
    console.log('  team-size distribution:');
    for (const r of teamDist) {
      console.log(`    ${r.C} instructor(s): ${Number(r.N).toLocaleString()} groups`);
    }

    // [C] Score sanity: POINT = POINT_AVG * TOTAL_STUDENT?
    console.log('\n[C] Score column sanity:');
    const ss = await query<{
      TOT: number;
      PA_MIN: number;
      PA_MAX: number;
      TS_MIN: number;
      TS_MAX: number;
      P_NUM_OK: number;
      MATCH: number;
    }>(
      conn,
      `SELECT
         COUNT(*) AS TOT,
         MIN(POINT_AVG) AS PA_MIN, MAX(POINT_AVG) AS PA_MAX,
         MIN(TOTAL_STUDENT) AS TS_MIN, MAX(TOTAL_STUDENT) AS TS_MAX,
         SUM(CASE WHEN REGEXP_LIKE(POINT, '^[0-9]+(\\.[0-9]+)?$') THEN 1 ELSE 0 END) AS P_NUM_OK,
         SUM(CASE WHEN POINT_AVG IS NOT NULL AND TOTAL_STUDENT IS NOT NULL
                  AND ABS(TO_NUMBER(POINT) - POINT_AVG * TOTAL_STUDENT) < 0.01
              THEN 1 ELSE 0 END) AS MATCH
       FROM ${VIEW} WHERE POINT IS NOT NULL`,
    );
    const sr = ss[0]!;
    console.log(
      `  rows-w-point=${Number(sr.TOT).toLocaleString()}  POINT numeric=${Number(sr.P_NUM_OK).toLocaleString()}  POINT≈POINT_AVG×TOTAL_STUDENT in ${Number(sr.MATCH).toLocaleString()} (${((Number(sr.MATCH) / Number(sr.TOT)) * 100).toFixed(1)}%)`,
    );
    console.log(`  POINT_AVG range=[${sr.PA_MIN}, ${sr.PA_MAX}]  TOTAL_STUDENT range=[${sr.TS_MIN}, ${sr.TS_MAX}]`);

    // [D] OFFICERID identity — confirm range + populated
    console.log('\n[D] OFFICERID + KKUMAIL identity:');
    const offStats = await query<{
      D_OFF: number;
      D_MAIL: number;
      NULL_MAIL: number;
      MIN_OFF: number;
      MAX_OFF: number;
    }>(
      conn,
      `SELECT COUNT(DISTINCT OFFICERID) AS D_OFF,
              COUNT(DISTINCT KKUMAIL) AS D_MAIL,
              SUM(CASE WHEN KKUMAIL IS NULL THEN 1 ELSE 0 END) AS NULL_MAIL,
              MIN(OFFICERID) AS MIN_OFF, MAX(OFFICERID) AS MAX_OFF
       FROM ${VIEW}`,
    );
    const od = offStats[0]!;
    console.log(
      `  distinct OFFICERID=${Number(od.D_OFF).toLocaleString()}  distinct KKUMAIL=${Number(od.D_MAIL).toLocaleString()}  null-KKUMAIL rows=${Number(od.NULL_MAIL).toLocaleString()}  OFFICERID range=[${od.MIN_OFF}, ${od.MAX_OFF}]`,
    );
    // Are there OFFICERIDs that share a KKUMAIL? (same human, multiple ids)
    const dupe = await query<{ N: number; MX: number }>(
      conn,
      `SELECT COUNT(*) AS N, MAX(C) AS MX FROM (
         SELECT KKUMAIL, COUNT(DISTINCT OFFICERID) AS C
         FROM ${VIEW} WHERE KKUMAIL IS NOT NULL
         GROUP BY KKUMAIL HAVING COUNT(DISTINCT OFFICERID) > 1
       )`,
    );
    console.log(`  KKUMAILs with >1 OFFICERID: ${Number(dupe[0]?.N ?? 0).toLocaleString()}  max-distinct-OFFICERID per email=${dupe[0]?.MX ?? 0}`);

    // [E] FACULTYID universe
    console.log('\n[E] FACULTYID universe:');
    const facs = await query<{ FID: number; N: number; D_OFF: number }>(
      conn,
      `SELECT FACULTYID AS FID, COUNT(*) AS N, COUNT(DISTINCT OFFICERID) AS D_OFF
       FROM ${VIEW} GROUP BY FACULTYID ORDER BY COUNT(*) DESC FETCH FIRST 30 ROWS ONLY`,
    );
    for (const r of facs) {
      console.log(
        `  FACULTYID=${String(r.FID).padStart(4)}  rows=${Number(r.N).toLocaleString().padStart(10)}  distinct instructors=${Number(r.D_OFF).toLocaleString()}`,
      );
    }

    // [F] Distinct QUESTIONID + question-text mapping
    console.log('\n[F] Question catalog (distinct QID → most-common Q text):');
    const qs = await query<{ QID: string; N: number; QT: string }>(
      conn,
      `SELECT QUESTIONID AS QID, COUNT(*) AS N, MAX(QUESTION) AS QT
       FROM ${VIEW} GROUP BY QUESTIONID ORDER BY QUESTIONID`,
    );
    for (const r of qs) {
      console.log(
        `  QID=${r.QID.padEnd(4)}  n=${Number(r.N).toLocaleString().padStart(10)}  text=${String(r.QT).slice(0, 120)}`,
      );
    }

    // [G] How many ROWS get suppressed if we apply respondentCount >= 5?
    console.log('\n[G] Anonymity-suppression cost at threshold 5:');
    const supp = await query<{ TOT: number; KEPT: number; SKIPPED: number }>(
      conn,
      `SELECT COUNT(*) AS TOT,
              SUM(CASE WHEN TOTAL_STUDENT >= 5 THEN 1 ELSE 0 END) AS KEPT,
              SUM(CASE WHEN TOTAL_STUDENT < 5 OR TOTAL_STUDENT IS NULL THEN 1 ELSE 0 END) AS SKIPPED
       FROM ${VIEW}`,
    );
    const su = supp[0]!;
    const dropPct = (Number(su.SKIPPED) / Number(su.TOT)) * 100;
    console.log(
      `  total=${Number(su.TOT).toLocaleString()}  keep(n≥5)=${Number(su.KEPT).toLocaleString()}  drop(n<5)=${Number(su.SKIPPED).toLocaleString()}  (${dropPct.toFixed(1)}% suppressed)`,
    );

    // [H] Most-recent semester LAST_UPDATE so we know freshness
    console.log('\n[H] Freshness:');
    const fresh = await query<{ MX: Date | string; MN: Date | string }>(
      conn,
      `SELECT MIN(LAST_UPDATE) AS MN, MAX(LAST_UPDATE) AS MX FROM ${VIEW}`,
    );
    console.log(`  LAST_UPDATE range: ${String(fresh[0]?.MN)} → ${String(fresh[0]?.MX)}`);

    // Write composite fixture
    writeFixture('joins-summary', {
      view: VIEW,
      naturalKey: {
        rowCount: Number(r1.R),
        distinctClassidQidOfficerKey: Number(r1.D),
        unique: Number(r1.R) === Number(r1.D),
      },
      teamSizeDistribution: teamDist.map((r) => ({ teamSize: Number(r.C), groups: Number(r.N) })),
      scoreSanity: {
        rowsWithPoint: Number(sr.TOT),
        pointNumericOk: Number(sr.P_NUM_OK),
        pointEqualsAvgTimesN: Number(sr.MATCH),
        pointAvgRange: [Number(sr.PA_MIN), Number(sr.PA_MAX)],
        totalStudentRange: [Number(sr.TS_MIN), Number(sr.TS_MAX)],
      },
      instructorIdentity: {
        distinctOfficerId: Number(od.D_OFF),
        distinctKkumail: Number(od.D_MAIL),
        nullKkumailRows: Number(od.NULL_MAIL),
        officerIdRange: [Number(od.MIN_OFF), Number(od.MAX_OFF)],
        kkumailsWithMultiOfficerId: Number(dupe[0]?.N ?? 0),
      },
      facultyTop30: facs.map((r) => ({
        facultyId: Number(r.FID),
        rows: Number(r.N),
        distinctInstructors: Number(r.D_OFF),
      })),
      questionCatalog: qs.map((r) => ({
        questionId: r.QID,
        rows: Number(r.N),
        questionText: String(r.QT),
      })),
      suppression: {
        threshold: 5,
        total: Number(su.TOT),
        kept: Number(su.KEPT),
        skipped: Number(su.SKIPPED),
        skippedPct: dropPct,
      },
    });
    console.log('\n✓ done.');
  });
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
