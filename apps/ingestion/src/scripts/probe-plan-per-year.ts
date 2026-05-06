#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv(path.resolve(process.cwd(), '.env'));
import { configFromEnv, query, withConnection } from '../lib/oracle-client';
async function main() {
  await withConnection(configFromEnv('KKU_REGISTRY_DB'), async (conn) => {
    // Is PLAN_PER_YEAR constant across rounds within a (CURR_ID, ACADYEAR)?
    const variation = await query<{ N: number }>(conn,
      `SELECT COUNT(*) AS N FROM (
         SELECT CURR_ID, ACADYEAR
         FROM POWERBI.ADMISSION_STAT_CURRID
         GROUP BY CURR_ID, ACADYEAR
         HAVING COUNT(DISTINCT NVL(PLAN_PER_YEAR, -1)) > 1
       )`);
    console.log(`(CURR_ID, ACADYEAR) tuples where PLAN_PER_YEAR varies across rounds: ${variation[0]?.N}`);
    // NULL-coverage per year
    const nulls = await query<{ ACADYEAR: number; ROWS: number; NULLS: number; DISTINCT_PROGS_NULL: number; DISTINCT_PROGS: number }>(conn,
      `SELECT
         ACADYEAR,
         COUNT(*) AS ROW_CNT,
         SUM(CASE WHEN PLAN_PER_YEAR IS NULL THEN 1 ELSE 0 END) AS NULL_CNT,
         COUNT(DISTINCT CASE WHEN PLAN_PER_YEAR IS NULL THEN CURR_ID END) AS DISTINCT_PROGS_NULL,
         COUNT(DISTINCT CURR_ID) AS DISTINCT_PROGS
       FROM POWERBI.ADMISSION_STAT_CURRID
       GROUP BY ACADYEAR ORDER BY ACADYEAR DESC`);
    console.log('PLAN_PER_YEAR NULL coverage by ACADYEAR:');
    for (const r of nulls) {
      console.log(`  BE ${r.ACADYEAR}: rows=${r.ROW_CNT}, NULL_rows=${r.NULL_CNT} (${(r.NULL_CNT/r.ROWS*100).toFixed(0)}%); programs_with_NULL=${r.DISTINCT_PROGS_NULL}/${r.DISTINCT_PROGS}`);
    }
    // Sample over-allocation: SUM(ENROLLSEAT) vs MAX(PLAN_PER_YEAR) per (program, year)
    const ratio = await query<{ ACADYEAR: number; PROGS: number; SUM_SEAT: number; SUM_PLAN: number; AVG_RATIO: number }>(conn,
      `SELECT ACADYEAR,
              COUNT(*) AS PROGS,
              SUM(SUM_ENROLLSEAT) AS SUM_SEAT,
              SUM(MAX_PLAN) AS SUM_PLAN,
              AVG(CASE WHEN MAX_PLAN > 0 THEN SUM_ENROLLSEAT / MAX_PLAN END) AS AVG_RATIO
       FROM (
         SELECT CURR_ID, ACADYEAR,
                NVL(SUM(ENROLLSEAT),0) AS SUM_ENROLLSEAT,
                MAX(PLAN_PER_YEAR) AS MAX_PLAN
         FROM POWERBI.ADMISSION_STAT_CURRID
         GROUP BY CURR_ID, ACADYEAR
       )
       WHERE MAX_PLAN IS NOT NULL
       GROUP BY ACADYEAR ORDER BY ACADYEAR DESC`);
    console.log('\nOver-allocation factor (SUM ENROLLSEAT / PLAN_PER_YEAR) by year:');
    for (const r of ratio) {
      console.log(`  BE ${r.ACADYEAR}: ${r.PROGS} progs, sum_enrollseat=${r.SUM_SEAT}, sum_plan=${r.SUM_PLAN}, avg ratio=${(r.AVG_RATIO ?? 0).toFixed(2)}`);
    }
    // 5 sample rows
    const sample = await query<Record<string, unknown>>(conn,
      `SELECT CURR_ID, ACADYEAR, ROUND, ENROLLSEAT, PLAN_PER_YEAR FROM POWERBI.ADMISSION_STAT_CURRID
       WHERE CURR_ID = '25360031100431' AND ACADYEAR = 2569 ORDER BY ROUND`);
    console.log('\nSample rows for one program × year:');
    for (const r of sample) console.log(' ', r);
  });
}
main().catch(e => { console.error(e); process.exit(1); });
