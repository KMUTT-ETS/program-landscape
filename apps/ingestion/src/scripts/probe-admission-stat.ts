#!/usr/bin/env tsx
// Probe POWERBI.ADMISSION_STAT — re-check after Registrar added ENROLLSEAT,
// PLAN, CURR_ID. Read-only.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
loadDotEnv(path.resolve(process.cwd(), '.env'));
function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i < 0) continue;
    const k = t.slice(0, i).trim(); let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
import { configFromEnv, query, withConnection } from '../lib/oracle-client';

async function main() {
  const cfg = configFromEnv('KKU_REGISTRY_DB');
  await withConnection(cfg, async (conn) => {
    const q = (label: string, sql: string) => query<Record<string, unknown>>(conn, sql)
      .then((r) => { console.log(`\n── ${label} ──`); r.forEach((x) => console.log(JSON.stringify(x))); return r; })
      .catch((e) => { console.log(`\n── ${label} ── ERR: ${String(e).slice(0, 160)}`); return []; });

    await q('columns', `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE FROM ALL_TAB_COLUMNS
      WHERE OWNER='POWERBI' AND TABLE_NAME='ADMISSION_STAT' ORDER BY COLUMN_ID`);

    await q('null coverage new cols', `SELECT
      COUNT(*) AS ROWS_TOTAL,
      SUM(CASE WHEN ENROLLSEAT IS NULL THEN 1 ELSE 0 END) AS ENROLLSEAT_NULL,
      SUM(CASE WHEN PLAN IS NULL THEN 1 ELSE 0 END) AS PLAN_NULL,
      SUM(CASE WHEN CURR_ID IS NULL THEN 1 ELSE 0 END) AS CURRID_NULL
      FROM POWERBI.ADMISSION_STAT`);

    // CURR_ID shape + cardinality + does it match ADMISSION_STAT_CURRID's CURR_ID?
    await q('CURR_ID cardinality + length', `SELECT COUNT(DISTINCT CURR_ID) AS D_CURRID,
      COUNT(DISTINCT PROGRAMID) AS D_PROGRAMID, MIN(LENGTH(CURR_ID)) AS MINLEN, MAX(LENGTH(CURR_ID)) AS MAXLEN
      FROM POWERBI.ADMISSION_STAT WHERE CURR_ID IS NOT NULL`);

    // Is PROGRAMID → CURR_ID a function (1 curr per programid)? or many?
    await q('PROGRAMID -> #CURR_ID (>1 means programid spans curricula)', `SELECT COUNT(*) AS PIDS_WITH_MULTI_CURR FROM (
      SELECT PROGRAMID, COUNT(DISTINCT CURR_ID) c FROM POWERBI.ADMISSION_STAT WHERE CURR_ID IS NOT NULL
      GROUP BY PROGRAMID HAVING COUNT(DISTINCT CURR_ID) > 1)`);
    await q('CURR_ID -> #PROGRAMID (>1 means curr spans recruitment programs)', `SELECT COUNT(*) AS CURR_WITH_MULTI_PID FROM (
      SELECT CURR_ID, COUNT(DISTINCT PROGRAMID) c FROM POWERBI.ADMISSION_STAT WHERE CURR_ID IS NOT NULL
      GROUP BY CURR_ID HAVING COUNT(DISTINCT PROGRAMID) > 1)`);

    // Does ADMISSION_STAT.CURR_ID match ADMISSION_STAT_CURRID.CURR_ID?
    await q('CURR_ID overlap with ADMISSION_STAT_CURRID', `SELECT
      (SELECT COUNT(DISTINCT CURR_ID) FROM POWERBI.ADMISSION_STAT WHERE CURR_ID IS NOT NULL) AS STAT_CURR,
      (SELECT COUNT(DISTINCT CURR_ID) FROM POWERBI.ADMISSION_STAT_CURRID) AS CURRID_CURR,
      (SELECT COUNT(*) FROM (SELECT DISTINCT CURR_ID FROM POWERBI.ADMISSION_STAT WHERE CURR_ID IS NOT NULL
         INTERSECT SELECT DISTINCT CURR_ID FROM POWERBI.ADMISSION_STAT_CURRID)) AS SHARED
      FROM DUAL`);

    // PLAN behaviour: is PLAN constant per (CURR_ID, ACADYEAR)? per (PROGRAMID, ACADYEAR)?
    await q('PLAN distinct per (CURR_ID, ACADYEAR) >1?', `SELECT COUNT(*) AS GROUPS_WITH_VARYING_PLAN FROM (
      SELECT CURR_ID, ACADYEAR, COUNT(DISTINCT PLAN) c FROM POWERBI.ADMISSION_STAT WHERE CURR_ID IS NOT NULL
      GROUP BY CURR_ID, ACADYEAR HAVING COUNT(DISTINCT PLAN) > 1)`);

    // ENROLLSEAT: per-track value? sample with funnel
    await q('sample rows (new cols)', `SELECT WPROGRAMID, PROGRAMID, CURR_ID, ACADYEAR, ROUND, ENROLLSEAT, PLAN, TOTAL_APPLICANT, REG_REPORTED, PROGRAMNAME
      FROM POWERBI.ADMISSION_STAT WHERE CURR_ID IS NOT NULL FETCH FIRST 10 ROWS ONLY`);

    // PLAN/ENROLLSEAT ranges
    await q('PLAN / ENROLLSEAT ranges', `SELECT MIN(PLAN) AS PLAN_MIN, MAX(PLAN) AS PLAN_MAX, ROUND(AVG(PLAN)) AS PLAN_AVG,
      MIN(ENROLLSEAT) AS SEAT_MIN, MAX(ENROLLSEAT) AS SEAT_MAX, ROUND(AVG(ENROLLSEAT)) AS SEAT_AVG
      FROM POWERBI.ADMISSION_STAT`);

    // For one program-year: do per-round ENROLLSEAT sum > PLAN (over-allocation like the funnel table)?
    await q('over-allocation sample (one CURR_ID, one year)', `SELECT CURR_ID, ACADYEAR, MAX(PLAN) AS PLAN, SUM(ENROLLSEAT) AS SUM_SEATS, COUNT(*) AS TRACKS
      FROM POWERBI.ADMISSION_STAT WHERE CURR_ID IS NOT NULL AND PLAN IS NOT NULL
      GROUP BY CURR_ID, ACADYEAR ORDER BY SUM_SEATS DESC FETCH FIRST 8 ROWS ONLY`);
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
