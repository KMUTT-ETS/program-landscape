// One-shot — DISTINCT workline values + counts. Aggregate only.
// Run from the api workspace:  pnpm tsx src/staff/probe-workline.ts

import 'dotenv/config';
import { configFromEnv, withConnection, query } from './mysql-client';

async function main() {
  const cfg = configFromEnv();
  console.log(`MySQL  ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}\n`);

  await withConnection(cfg, async (conn) => {
    for (const table of ['vw_history', 'vw_history_all']) {
      const total = await query<{ n: number }>(
        conn,
        `SELECT COUNT(*) AS n FROM ${table}`,
      );
      console.log(`── ${table} (${total[0]!.n} rows) — workline distribution`);
      const rows = await query<{ workline: string | null; cnt: number }>(
        conn,
        `SELECT workline, COUNT(*) AS cnt
           FROM ${table}
          GROUP BY workline
          ORDER BY cnt DESC`,
      );
      for (const r of rows) {
        const w = r.workline === null || r.workline === '' ? '∅ (NULL/empty)' : r.workline;
        console.log(`  ${w.padEnd(36)}  ${r.cnt}`);
      }
      console.log();
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
