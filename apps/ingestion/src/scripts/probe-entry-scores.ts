#!/usr/bin/env tsx
// ───────────────────────────────────────────────────────────────────────
// Probe AVSREG.VIEW_STUDENT_SCORES so we can build a working entry-score
// query for the Education / Student-performance dashboard.
//
// The first refresh ran cleanly but pulled zero rows, meaning the query
// is syntactically valid against a present view but the column names /
// JOIN key don't match what we assumed (`STUDENTCODE` / `SUBJECTCODE` /
// `SUBJECTNAME` / `SCORE`). This script:
//
//   1. Confirms the view exists and lists its columns
//   2. Counts total rows
//   3. Counts distinct STUDENTCODE-like fields and samples them
//   4. Returns 5 sample rows so we can read the actual shape
//
// Output is aggregate-only / sample-only (5 rows) — no broad PII dump.
// Run with: pnpm tsx apps/ingestion/src/scripts/probe-entry-scores.ts
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

async function main(): Promise<void> {
  console.log('▶ Probing AVSREG.VIEW_STUDENT_SCORES…');
  const cfg = configFromEnv('KKU_REGISTRY_DB');
  await withConnection(cfg, async (conn) => {
    // ── 1. Schema introspection ────────────────────────────────────
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
       WHERE owner = 'AVSREG' AND table_name = 'VIEW_STUDENT_SCORES'
       ORDER BY column_id`,
    );
    if (cols.length === 0) {
      console.log(
        '  (no columns returned — view may not exist, or AVSREG schema is not visible to this account)',
      );
    } else {
      for (const c of cols) {
        console.log(
          `  ${String(c.COLUMN_ID).padStart(2)}. ${c.COLUMN_NAME.padEnd(28)} ${c.DATA_TYPE.padEnd(14)} len=${c.DATA_LENGTH} ${c.NULLABLE === 'Y' ? 'NULL' : 'NOT NULL'}`,
        );
      }
    }

    // ── 2. Row count ──────────────────────────────────────────────
    console.log('\n[2] Row count:');
    try {
      const cnt = await query<{ N: number }>(
        conn,
        `SELECT COUNT(*) AS N FROM AVSREG.VIEW_STUDENT_SCORES`,
      );
      console.log(`  ${(cnt[0]?.N ?? 0).toLocaleString('en-US')} rows`);
    } catch (err) {
      console.log(`  (count failed: ${err instanceof Error ? err.message : String(err)})`);
      return;
    }

    // ── 3. Sample 5 rows ──────────────────────────────────────────
    console.log('\n[3] Sample 5 rows:');
    try {
      const sample = await query<Record<string, unknown>>(
        conn,
        `SELECT * FROM AVSREG.VIEW_STUDENT_SCORES FETCH FIRST 5 ROWS ONLY`,
      );
      for (let i = 0; i < sample.length; i++) {
        console.log(`  Row ${i + 1}:`);
        const row = sample[i]!;
        for (const [k, v] of Object.entries(row)) {
          // Truncate long values; mask anything that looks like a
          // citizen ID (13 digits).
          let display: string;
          if (v === null || v === undefined) display = 'null';
          else if (typeof v === 'string' && /^\d{13}$/.test(v))
            display = '***masked-13-digit-id***';
          else display = String(v).slice(0, 80);
          console.log(`    ${k.padEnd(28)} ${display}`);
        }
      }
    } catch (err) {
      console.log(`  (sample failed: ${err instanceof Error ? err.message : String(err)})`);
    }

    // ── 4. JOIN viability — does any STUDENTCODE-like column align
    //      with VIEW_STUDENT_DETAIL.STUDENTCODE? ────────────────────
    const studentCodeCols = cols
      .filter((c) =>
        /^STUDENT(_)?(CODE|ID)$|^STDCODE$|^STD_ID$|^STUDENT$/i.test(
          c.COLUMN_NAME,
        ),
      )
      .map((c) => c.COLUMN_NAME);
    console.log('\n[4] JOIN viability (vs POWERBI.VIEW_STUDENT_DETAIL.STUDENTCODE):');
    if (studentCodeCols.length === 0) {
      console.log(
        '  (no obvious student-code column found — check the column list above)',
      );
    } else {
      for (const col of studentCodeCols) {
        try {
          const r = await query<{ MATCHED: number; UNMATCHED: number }>(
            conn,
            `SELECT
               SUM(CASE WHEN d.STUDENTCODE IS NOT NULL THEN 1 ELSE 0 END) AS MATCHED,
               SUM(CASE WHEN d.STUDENTCODE IS NULL     THEN 1 ELSE 0 END) AS UNMATCHED
             FROM AVSREG.VIEW_STUDENT_SCORES s
             LEFT JOIN POWERBI.VIEW_STUDENT_DETAIL d ON d.STUDENTCODE = s.${col}`,
          );
          const r0 = r[0];
          console.log(
            `  s.${col} ← matched=${(r0?.MATCHED ?? 0).toLocaleString('en-US')}, unmatched=${(r0?.UNMATCHED ?? 0).toLocaleString('en-US')}`,
          );
        } catch (err) {
          console.log(
            `  s.${col}: (probe failed — ${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }
    }

    // ── 5. Funnel — see where rows are being filtered out at each
    //      step of the production query. Helps when the cube comes
    //      back smaller than expected. ──────────────────────────────
    console.log('\n[5] Filter funnel:');
    const steps: Array<{ label: string; sql: string }> = [
      {
        label: 'AVSREG.VIEW_STUDENT_SCORES total',
        sql: `SELECT COUNT(*) AS N FROM AVSREG.VIEW_STUDENT_SCORES`,
      },
      {
        label: '... with SCORE NOT NULL and >= 0',
        sql: `SELECT COUNT(*) AS N FROM AVSREG.VIEW_STUDENT_SCORES
              WHERE SCORE IS NOT NULL AND SCORE >= 0`,
      },
      {
        label: '... INNER JOIN VIEW_STUDENT_DETAIL_ALL on STUDENTCODE',
        sql: `SELECT COUNT(*) AS N
              FROM AVSREG.VIEW_STUDENT_SCORES s
              INNER JOIN POWERBI.VIEW_STUDENT_DETAIL_ALL d
                ON d.STUDENTCODE = s.STUDENTCODE
              WHERE s.SCORE IS NOT NULL AND s.SCORE >= 0`,
      },
      {
        label: '... + PROGRAMLEVEL = ปริญญาตรี (undergrad)',
        sql: `SELECT COUNT(*) AS N
              FROM AVSREG.VIEW_STUDENT_SCORES s
              INNER JOIN POWERBI.VIEW_STUDENT_DETAIL_ALL d
                ON d.STUDENTCODE = s.STUDENTCODE
              WHERE s.SCORE IS NOT NULL AND s.SCORE >= 0
                AND d.PROGRAMLEVEL = 'ปริญญาตรี'`,
      },
      {
        label: '... GROUP BY (faculty × program × subject) — final cube row count',
        sql: `SELECT COUNT(*) AS N FROM (
                SELECT d.FACULTYNAME, d.PROGRAMNAME, d.PROGRAMLEVEL,
                       s.SUBJECTCODE, s.SUBJECTNAME
                FROM AVSREG.VIEW_STUDENT_SCORES s
                INNER JOIN POWERBI.VIEW_STUDENT_DETAIL_ALL d
                  ON d.STUDENTCODE = s.STUDENTCODE
                WHERE s.SCORE IS NOT NULL AND s.SCORE >= 0
                  AND d.PROGRAMLEVEL = 'ปริญญาตรี'
                  AND d.FACULTYNAME IS NOT NULL
                  AND d.PROGRAMNAME IS NOT NULL
                GROUP BY d.FACULTYNAME, d.PROGRAMNAME, d.PROGRAMLEVEL,
                         s.SUBJECTCODE, s.SUBJECTNAME
              )`,
      },
      {
        label: '... distinct SUBJECTCODE values',
        sql: `SELECT COUNT(DISTINCT SUBJECTCODE) AS N FROM AVSREG.VIEW_STUDENT_SCORES`,
      },
      {
        label: '... distinct PROGRAMNAME values among matched',
        sql: `SELECT COUNT(DISTINCT d.PROGRAMNAME) AS N
              FROM AVSREG.VIEW_STUDENT_SCORES s
              INNER JOIN POWERBI.VIEW_STUDENT_DETAIL_ALL d
                ON d.STUDENTCODE = s.STUDENTCODE
              WHERE d.PROGRAMLEVEL = 'ปริญญาตรี'`,
      },
    ];
    for (const step of steps) {
      try {
        const r = await query<{ N: number }>(conn, step.sql);
        console.log(
          `  ${step.label.padEnd(60)} ${(r[0]?.N ?? 0).toLocaleString('en-US')}`,
        );
      } catch (err) {
        console.log(
          `  ${step.label.padEnd(60)} (failed: ${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }

    console.log('\n✓ done.');
  });
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
