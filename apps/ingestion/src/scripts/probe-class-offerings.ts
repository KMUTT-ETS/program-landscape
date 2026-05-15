#!/usr/bin/env tsx
// ───────────────────────────────────────────────────────────────────────
// Probe POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER — the registrar's list of
// every class/section opened per academic year + semester, with the
// teaching staff (KKUMAIL) attached.
//
// We need this to power two new dashboards:
//   - Education → subject offerings & fulfilment (seat fill, credits)
//   - Staff     → teaching workload (contact hours per teacher)
//
// This script learns the data so we can design the cube tables + queries:
//   [1] Column list
//   [2] Row count
//   [3] Sample rows (5) — masks 13-digit IDs, truncates long values
//   [4] Distinct ACADYEAR × SEMESTER coverage + per-year row counts
//   [5] Cardinalities — distinct subjects / sections / faculties / programs
//   [6] KKUMAIL shape — null rate, multi-teacher rate, duplicate-email rate
//   [7] Program-linkage viability — which columns can resolve to a Program
//   [8] COURSEUNIT / CREDITTOTAL shape — sample distinct values
//
// Output is aggregate-only / sample-only. Run with:
//   pnpm tsx apps/ingestion/src/scripts/probe-class-offerings.ts
// ───────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
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

const VIEW = 'POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER';
const [VIEW_OWNER, VIEW_NAME] = VIEW.split('.');

function mask(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  const s = String(v);
  if (/^\d{13}$/.test(s)) return '***masked-13-digit-id***';
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

async function main(): Promise<void> {
  console.log(`▶ Probing ${VIEW}…`);
  const cfg = configFromEnv('KKU_REGISTRY_DB');
  await withConnection(cfg, async (conn) => {
    // ── 1. Schema introspection ──────────────────────────────────────
    console.log('\n[1] Columns:');
    const cols = await query<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      DATA_LENGTH: number;
      NULLABLE: string;
      COLUMN_ID: number;
    }>(
      conn,
      `SELECT column_name, data_type, data_length, nullable, column_id
       FROM all_tab_columns
       WHERE owner = :owner AND table_name = :name
       ORDER BY column_id`,
      { owner: VIEW_OWNER, name: VIEW_NAME },
    );
    if (cols.length === 0) {
      console.log('  (no columns — view missing or not visible to this account)');
      return;
    }
    for (const c of cols) {
      console.log(
        `  ${String(c.COLUMN_ID).padStart(2)}. ${c.COLUMN_NAME.padEnd(30)} ${c.DATA_TYPE.padEnd(14)} len=${String(c.DATA_LENGTH).padEnd(6)} ${c.NULLABLE === 'Y' ? 'NULL' : 'NOT NULL'}`,
      );
    }
    const colNames = cols.map((c) => c.COLUMN_NAME);
    const has = (re: RegExp): string[] => colNames.filter((n) => re.test(n));

    // ── 2. Row count ─────────────────────────────────────────────────
    console.log('\n[2] Row count:');
    const cnt = await query<{ N: number }>(conn, `SELECT COUNT(*) AS N FROM ${VIEW}`);
    console.log(`  ${(cnt[0]?.N ?? 0).toLocaleString('en-US')} rows`);

    // ── 3. Sample 5 rows ─────────────────────────────────────────────
    console.log('\n[3] Sample 5 rows:');
    const sample = await query<Record<string, unknown>>(
      conn,
      `SELECT * FROM ${VIEW} FETCH FIRST 5 ROWS ONLY`,
    );
    for (let i = 0; i < sample.length; i++) {
      console.log(`  Row ${i + 1}:`);
      for (const [k, v] of Object.entries(sample[i]!)) {
        console.log(`    ${k.padEnd(30)} ${mask(v)}`);
      }
    }

    // ── 4. ACADYEAR × SEMESTER coverage ──────────────────────────────
    const yearCol = has(/ACAD.*YEAR|ACADYEAR|YEAR/i)[0];
    const semCol = has(/SEMESTER|TERM/i)[0];
    console.log(`\n[4] Year/Semester coverage (yearCol=${yearCol ?? '?'}, semCol=${semCol ?? '?'}):`);
    if (yearCol && semCol) {
      const cov = await query<{ Y: number; S: string; N: number }>(
        conn,
        `SELECT ${yearCol} AS Y, ${semCol} AS S, COUNT(*) AS N
         FROM ${VIEW}
         GROUP BY ${yearCol}, ${semCol}
         ORDER BY ${yearCol} DESC, ${semCol}`,
      );
      for (const r of cov.slice(0, 24)) {
        console.log(`  ${r.Y} / sem ${r.S}: ${Number(r.N).toLocaleString('en-US')} rows`);
      }
      if (cov.length > 24) console.log(`  … and ${cov.length - 24} more (year,sem) buckets`);
    }

    // ── 5. Cardinalities ─────────────────────────────────────────────
    console.log('\n[5] Cardinalities:');
    const subjectCol = has(/^SUBJECT.?CODE$|^COURSE.?CODE$/i)[0] ?? has(/SUBJECT/i)[0];
    const _sectionCol = has(/SECTION|GROUP/i)[0];
    void _sectionCol;
    const facultyCols = has(/FACULTY/i);
    const programCols = has(/PROGRAM|CURRIC|MAJOR/i);
    const deptCols = has(/DEPART|DIVISION/i);
    const cardChecks: Array<[string, string]> = [];
    if (subjectCol) cardChecks.push([`distinct ${subjectCol}`, `COUNT(DISTINCT ${subjectCol})`]);
    for (const fc of facultyCols) cardChecks.push([`distinct ${fc}`, `COUNT(DISTINCT ${fc})`]);
    for (const pc of programCols) cardChecks.push([`distinct ${pc}`, `COUNT(DISTINCT ${pc})`]);
    for (const dc of deptCols) cardChecks.push([`distinct ${dc}`, `COUNT(DISTINCT ${dc})`]);
    for (const [label, expr] of cardChecks) {
      try {
        const r = await query<{ N: number }>(conn, `SELECT ${expr} AS N FROM ${VIEW}`);
        console.log(`  ${label.padEnd(40)} ${(r[0]?.N ?? 0).toLocaleString('en-US')}`);
      } catch (err) {
        console.log(`  ${label.padEnd(40)} (failed: ${err instanceof Error ? err.message : err})`);
      }
    }

    // ── 6. KKUMAIL shape ─────────────────────────────────────────────
    const mailCol = has(/KKUMAIL|MAIL|EMAIL/i)[0];
    console.log(`\n[6] KKUMAIL shape (col=${mailCol ?? '?'}):`);
    if (mailCol) {
      const mailStats = await query<{
        TOTAL: number;
        NULLS: number;
        MULTI: number;
        MAXLEN: number;
      }>(
        conn,
        `SELECT
           COUNT(*) AS TOTAL,
           SUM(CASE WHEN ${mailCol} IS NULL OR TRIM(${mailCol}) = '' THEN 1 ELSE 0 END) AS NULLS,
           SUM(CASE WHEN INSTR(${mailCol}, ',') > 0 THEN 1 ELSE 0 END) AS MULTI,
           MAX(LENGTH(${mailCol})) AS MAXLEN
         FROM ${VIEW}`,
      );
      const ms = mailStats[0]!;
      console.log(`  total=${Number(ms.TOTAL).toLocaleString()}  null/empty=${Number(ms.NULLS).toLocaleString()}  multi-teacher=${Number(ms.MULTI).toLocaleString()}  maxLen=${ms.MAXLEN}`);
      // Sample a few non-null KKUMAIL values (work emails — low-sensitivity,
      // but cap at 8 and only show the domain pattern + first-token shape).
      const mailSample = await query<{ V: string }>(
        conn,
        `SELECT ${mailCol} AS V FROM ${VIEW}
         WHERE ${mailCol} IS NOT NULL AND INSTR(${mailCol}, ',') > 0
         FETCH FIRST 5 ROWS ONLY`,
      );
      console.log('  Sample multi-teacher KKUMAIL values:');
      for (const r of mailSample) {
        const parts = String(r.V).split(',').map((s) => s.trim());
        const uniq = [...new Set(parts)];
        console.log(`    raw=${parts.length} tokens, distinct=${uniq.length}  e.g. ${mask(r.V)}`);
      }
      // Distinct-teacher cardinality across the whole view (rough — splits
      // would need a CONNECT BY; here just count distinct raw values).
      const distinctRaw = await query<{ N: number }>(
        conn,
        `SELECT COUNT(DISTINCT ${mailCol}) AS N FROM ${VIEW} WHERE ${mailCol} IS NOT NULL`,
      );
      console.log(`  distinct raw KKUMAIL strings: ${(distinctRaw[0]?.N ?? 0).toLocaleString()}`);
    }

    // ── 7. Program-linkage viability ─────────────────────────────────
    // The class-offering view tells us who taught + the subject. To tie
    // a subject to one of our Program rows we likely need FACULTYNAME +
    // PROGRAMNAME (+ level/major). Check what's populated.
    console.log('\n[7] Program-linkage column null-rates:');
    for (const col of [...facultyCols, ...programCols, ...deptCols]) {
      try {
        const r = await query<{ NN: number; TOT: number }>(
          conn,
          `SELECT SUM(CASE WHEN ${col} IS NOT NULL AND TRIM(${col}) <> '' THEN 1 ELSE 0 END) AS NN,
                  COUNT(*) AS TOT
           FROM ${VIEW}`,
        );
        const pct = r[0]!.TOT ? ((Number(r[0]!.NN) / Number(r[0]!.TOT)) * 100).toFixed(1) : '0';
        console.log(`  ${col.padEnd(30)} populated ${pct}%`);
      } catch (err) {
        console.log(`  ${col.padEnd(30)} (failed: ${err instanceof Error ? err.message : err})`);
      }
    }

    // ── 8. Credit / COURSEUNIT shape ─────────────────────────────────
    const creditCol = has(/CREDIT.?TOTAL|CREDIT/i)[0];
    const unitCol = has(/COURSE.?UNIT|UNIT/i)[0];
    const enrollCol = has(/ENROLL.?SEAT|ENROLL/i)[0];
    const totalSeatCol = has(/TOTAL.?SEAT|SEAT/i).filter((c) => c !== enrollCol)[0];
    console.log(`\n[8] Credit/seat columns: credit=${creditCol ?? '?'} unit=${unitCol ?? '?'} enroll=${enrollCol ?? '?'} totalSeat=${totalSeatCol ?? '?'}`);
    if (unitCol) {
      const unitSample = await query<{ V: string; N: number }>(
        conn,
        `SELECT ${unitCol} AS V, COUNT(*) AS N FROM ${VIEW}
         WHERE ${unitCol} IS NOT NULL
         GROUP BY ${unitCol} ORDER BY COUNT(*) DESC FETCH FIRST 15 ROWS ONLY`,
      );
      console.log(`  Top ${unitCol} values:`);
      for (const r of unitSample) console.log(`    ${String(r.V).padEnd(20)} ×${Number(r.N).toLocaleString()}`);
    }
    if (creditCol && enrollCol && totalSeatCol) {
      const seatStats = await query<{
        ZERO_ENROLL: number;
        OVERFULL: number;
        NULL_SEAT: number;
        TOT: number;
      }>(
        conn,
        `SELECT
           SUM(CASE WHEN ${enrollCol} = 0 THEN 1 ELSE 0 END) AS ZERO_ENROLL,
           SUM(CASE WHEN ${enrollCol} > ${totalSeatCol} THEN 1 ELSE 0 END) AS OVERFULL,
           SUM(CASE WHEN ${totalSeatCol} IS NULL OR ${totalSeatCol} = 0 THEN 1 ELSE 0 END) AS NULL_SEAT,
           COUNT(*) AS TOT
         FROM ${VIEW}`,
      );
      const ss = seatStats[0]!;
      console.log(`  seat sanity: zero-enroll=${Number(ss.ZERO_ENROLL).toLocaleString()}  over-full=${Number(ss.OVERFULL).toLocaleString()}  null/0-capacity=${Number(ss.NULL_SEAT).toLocaleString()}  total=${Number(ss.TOT).toLocaleString()}`);
    }

    console.log('\n✓ done.');
  });
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
