import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  // DS2001 first
  const ds = {
    host: process.env.UNICON_DS2001_DB_HOST!,
    port: Number(process.env.UNICON_DS2001_DB_PORT),
    database: process.env.UNICON_DS2001_DB_DATABASE!,
    user: process.env.UNICON_DS2001_DB_USER!,
    password: process.env.UNICON_DS2001_DB_PASSWORD!,
  };
  const c1 = await mysql.createConnection({ ...ds, dateStrings: true });
  await c1.query("SET NAMES 'utf8'");
  console.log('=== DS2001 BIRTHDAY ===');
  const [rows] = await c1.query<any[]>(
    `SELECT BIRTHDAY, LEFT(BIRTHDAY, 4) AS Y4, YEAR(BIRTHDAY) AS YR FROM DS2001 WHERE BIRTHDAY IS NOT NULL LIMIT 8`,
  );
  for (const r of rows) console.log(' ', r);
  const [stats] = await c1.query<any[]>(
    `SELECT MIN(YEAR(BIRTHDAY))::SIGNED AS minyr, MAX(YEAR(BIRTHDAY))::SIGNED AS maxyr,
            SUM(CASE WHEN BIRTHDAY IS NULL THEN 1 ELSE 0 END) AS nulls,
            SUM(CASE WHEN BIRTHDAY = '0000-00-00' THEN 1 ELSE 0 END) AS zeros
       FROM DS2001`,
  );
  console.log('  stats:', stats[0]);
  await c1.end();

  // processed-HR vw_history
  const pr = {
    host: process.env.KKU_HR_PROCESSED_DB_HOST!,
    port: Number(process.env.KKU_HR_PROCESSED_DB_PORT),
    database: process.env.KKU_HR_PROCESSED_DB_DATABASE!,
    user: process.env.KKU_HR_PROCESSED_DB_USER!,
    password: process.env.KKU_HR_PROCESSED_DB_PASSWORD!,
  };
  const c2 = await mysql.createConnection({ ...pr, dateStrings: true });
  await c2.query("SET NAMES 'utf8'");
  console.log('\n=== processed-HR vw_history birthday / retireday ===');
  const [r2] = await c2.query<any[]>(
    `SELECT identification, birthday, sixtyday, retireday, outday FROM vw_history WHERE birthday IS NOT NULL LIMIT 5`,
  );
  for (const r of r2) {
    const id = r.identification ? String(r.identification).slice(0, 4) + '…' : null;
    console.log(` { id_prefix: '${id}', birthday: '${r.birthday}', sixtyday: '${r.sixtyday}', retireday: '${r.retireday}', outday: '${r.outday}' }`);
  }
  const [s2] = await c2.query<any[]>(
    `SELECT
       MIN(YEAR(birthday)) AS by_min, MAX(YEAR(birthday)) AS by_max,
       SUM(CASE WHEN birthday IS NULL OR birthday = '0000-00-00' THEN 1 ELSE 0 END) AS nulls,
       COUNT(*) AS total
     FROM vw_history`,
  );
  console.log('  stats:', s2[0]);
  await c2.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
