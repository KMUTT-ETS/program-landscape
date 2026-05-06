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
    const total = await query<{ N: number }>(conn, 'SELECT COUNT(*) AS N FROM POWERBI.ADMISSION_STAT_CURRID');
    console.log(`Total rows: ${total[0]?.N}`);
    const dist = await query<{ ACADYEAR: number; ROUND: number; N: number }>(conn,
      `SELECT ACADYEAR, ROUND, COUNT(*) AS N FROM POWERBI.ADMISSION_STAT_CURRID
       GROUP BY ACADYEAR, ROUND ORDER BY ACADYEAR DESC, ROUND`);
    for (const r of dist.slice(0, 24)) console.log(`  BE ${r.ACADYEAR} round ${r.ROUND}: ${r.N}`);
    const sample = await query<Record<string, unknown>>(conn,
      'SELECT * FROM POWERBI.ADMISSION_STAT_CURRID FETCH FIRST 3 ROWS ONLY');
    console.log('\nSample rows:');
    for (const r of sample) console.log(' ', r);
    const distinct = await query<{ N: number }>(conn,
      'SELECT COUNT(DISTINCT CURR_ID) AS N FROM POWERBI.ADMISSION_STAT_CURRID');
    console.log(`\nDistinct CURR_ID: ${distinct[0]?.N}`);
  });
}
main().catch(e => { console.error(e); process.exit(1); });
