#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Probe POWERBI.ADMISSION_STAT_CURRID — confirm column names + types,
// row count, year range, round distribution, NULL-handling expectations,
// before flipping the kku-tcas-funnel connector real.
//
// Usage:
//   pnpm tcas-funnel:probe                    # full probe
//   pnpm tcas-funnel:probe --columns          # describe view columns only
//   pnpm tcas-funnel:probe --sample=20        # sample 20 rows
// ─────────────────────────────────────────────────────────────────────────────

import { loadOrganization } from '@kku/db';
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

import { configFromEnv, query, withConnection } from '../lib/oracle-client';

async function main() {
  await loadOrganization();
  const args = process.argv.slice(2);
  const columnsOnly = args.includes('--columns');
  const sampleArg = args.find((a) => a.startsWith('--sample='));
  const sampleN = sampleArg ? Number(sampleArg.split('=')[1] ?? 5) : 5;

  const cfg = configFromEnv('KKU_REGISTRY_DB');
  await withConnection(cfg, async (conn) => {
    console.log('━━━ POWERBI.ADMISSION_STAT_CURRID probe ━━━\n');

    // 1. Column names + Oracle types from ALL_TAB_COLUMNS
    const cols = await query<{ COLUMN_NAME: string; DATA_TYPE: string; NULLABLE: string }>(
      conn,
      `SELECT COLUMN_NAME, DATA_TYPE, NULLABLE
       FROM ALL_TAB_COLUMNS
       WHERE OWNER = 'POWERBI' AND TABLE_NAME = 'ADMISSION_STAT_CURRID'
       ORDER BY COLUMN_ID`,
    );
    console.log(`Columns (${cols.length}):`);
    for (const c of cols) {
      console.log(`  ${c.COLUMN_NAME.padEnd(28)} ${c.DATA_TYPE.padEnd(14)} nullable=${c.NULLABLE}`);
    }
    if (columnsOnly) return;

    // 2. Total rows + year range + round distribution
    const counts = await query<{ N: number }>(
      conn,
      `SELECT COUNT(*) AS N FROM POWERBI.ADMISSION_STAT_CURRID`,
    );
    console.log(`\nTotal rows: ${counts[0]?.N ?? '?'}`);

    const yearRows = await query<{ ENTRY_YEAR_BE: number; ROUND: number; N: number }>(
      conn,
      `SELECT ENTRY_YEAR_BE, ROUND_NO AS ROUND, COUNT(*) AS N
       FROM POWERBI.ADMISSION_STAT_CURRID
       GROUP BY ENTRY_YEAR_BE, ROUND_NO
       ORDER BY ENTRY_YEAR_BE DESC, ROUND_NO`,
    ).catch(async () => {
      // Fall back: column might be named differently. Try generic shape.
      console.log('(year/round columns: trying alternate names…)');
      return [] as Array<{ ENTRY_YEAR_BE: number; ROUND: number; N: number }>;
    });
    if (yearRows.length > 0) {
      console.log('\n(year × round) row counts:');
      for (const r of yearRows.slice(0, 30)) {
        console.log(`  BE ${r.ENTRY_YEAR_BE} round ${r.ROUND}: ${r.N}`);
      }
    }

    // 3. NULL coverage on the funnel columns
    const nullChecks = await query<{
      ENROLLSEAT_NULL: number;
      TOTAL_APPLICANT_NULL: number;
      TOTAL_PASS_NULL: number;
      SEND_CH_NULL: number;
      CONFIRM_CH_NULL: number;
      SEND_REG_NULL: number;
      REG_REPORTED_NULL: number;
    }>(
      conn,
      `SELECT
         COUNT(*) FILTER (WHERE ENROLLSEAT IS NULL) AS ENROLLSEAT_NULL,
         COUNT(*) FILTER (WHERE TOTAL_APPLICANT IS NULL) AS TOTAL_APPLICANT_NULL,
         COUNT(*) FILTER (WHERE TOTAL_PASS IS NULL) AS TOTAL_PASS_NULL,
         COUNT(*) FILTER (WHERE SEND_CLEARINGHOUSE IS NULL) AS SEND_CH_NULL,
         COUNT(*) FILTER (WHERE CONFIRM_CLEARINGHOUSE IS NULL) AS CONFIRM_CH_NULL,
         COUNT(*) FILTER (WHERE SEND_REG_REPORTED IS NULL) AS SEND_REG_NULL,
         COUNT(*) FILTER (WHERE REG_REPORTED IS NULL) AS REG_REPORTED_NULL
       FROM POWERBI.ADMISSION_STAT_CURRID`,
    ).catch((e) => {
      console.log('(Oracle FILTER not supported — falling back to plain count)');
      return query<{
        ENROLLSEAT_NULL: number;
        TOTAL_APPLICANT_NULL: number;
        TOTAL_PASS_NULL: number;
        SEND_CH_NULL: number;
        CONFIRM_CH_NULL: number;
        SEND_REG_NULL: number;
        REG_REPORTED_NULL: number;
      }>(
        conn,
        `SELECT
           SUM(CASE WHEN ENROLLSEAT IS NULL THEN 1 ELSE 0 END) AS ENROLLSEAT_NULL,
           SUM(CASE WHEN TOTAL_APPLICANT IS NULL THEN 1 ELSE 0 END) AS TOTAL_APPLICANT_NULL,
           SUM(CASE WHEN TOTAL_PASS IS NULL THEN 1 ELSE 0 END) AS TOTAL_PASS_NULL,
           SUM(CASE WHEN SEND_CLEARINGHOUSE IS NULL THEN 1 ELSE 0 END) AS SEND_CH_NULL,
           SUM(CASE WHEN CONFIRM_CLEARINGHOUSE IS NULL THEN 1 ELSE 0 END) AS CONFIRM_CH_NULL,
           SUM(CASE WHEN SEND_REG_REPORTED IS NULL THEN 1 ELSE 0 END) AS SEND_REG_NULL,
           SUM(CASE WHEN REG_REPORTED IS NULL THEN 1 ELSE 0 END) AS REG_REPORTED_NULL
         FROM POWERBI.ADMISSION_STAT_CURRID`,
      ).catch(() => []);
    });
    if (nullChecks.length > 0) {
      console.log('\nNULL counts on funnel columns:');
      const r = nullChecks[0]!;
      for (const [k, v] of Object.entries(r)) console.log(`  ${k}: ${v}`);
    }

    // 4. Sample rows
    const sampleRows = await query<Record<string, unknown>>(
      conn,
      `SELECT * FROM POWERBI.ADMISSION_STAT_CURRID FETCH FIRST ${sampleN} ROWS ONLY`,
    );
    console.log(`\nSample ${Math.min(sampleN, sampleRows.length)} rows:`);
    for (const r of sampleRows) {
      console.log('  ', r);
    }
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); });
