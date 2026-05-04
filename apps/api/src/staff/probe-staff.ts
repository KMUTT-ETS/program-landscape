// Comprehensive aggregate-only probe over vw_history (current snapshot).
// PURPOSE: validate the staff-category discriminator + collect the
// numbers needed to size the Staff dashboard cubes. Output is
// strictly aggregate (counts, ranges, distinct values) — no PII.
//
// Run: pnpm tsx src/staff/probe-staff.ts

import 'dotenv/config';
import { configFromEnv, withConnection, query } from './mysql-client';
import { STAFF_TABLE, staffCategorySqlExpr } from './staff-category';

const CAT = staffCategorySqlExpr();

async function main() {
  const cfg = configFromEnv();
  console.log(`MySQL  ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);
  console.log(`Source: ${STAFF_TABLE} (current snapshot)\n`);

  await withConnection(cfg, async (conn) => {
    // ── 1. Total + per-category headcount ─────────────────────────
    const totals = await query<{ category: string; cnt: number }>(
      conn,
      `SELECT ${CAT} AS category, COUNT(*) AS cnt
         FROM ${STAFF_TABLE}
        GROUP BY ${CAT}
        ORDER BY cnt DESC`,
    );
    console.log('1. Headcount by category');
    let grand = 0;
    for (const r of totals) {
      console.log(`   ${r.category.padEnd(10)}  ${r.cnt}`);
      grand += Number(r.cnt);
    }
    console.log(`   ${'TOTAL'.padEnd(10)}  ${grand}\n`);

    // ── 2. Per-category × faculty (top 12 faculties) ──────────────
    const byFaculty = await query<{ category: string; faculty: string; cnt: number }>(
      conn,
      `SELECT ${CAT} AS category,
              COALESCE(NULLIF(TRIM(faculty), ''), '∅') AS faculty,
              COUNT(*) AS cnt
         FROM ${STAFF_TABLE}
        GROUP BY ${CAT}, COALESCE(NULLIF(TRIM(faculty), ''), '∅')`,
    );
    const fac = new Map<string, Record<string, number>>();
    for (const r of byFaculty) {
      const row = fac.get(r.faculty) ?? {};
      row[r.category] = Number(r.cnt);
      fac.set(r.faculty, row);
    }
    const facRanked = [...fac.entries()]
      .map(([name, row]) => ({
        name,
        row,
        sum: Object.values(row).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.sum - a.sum);
    console.log('2. Top 15 faculties by total headcount');
    console.log(
      `   ${'faculty'.padEnd(34)}  ${'ACADEMIC'.padStart(8)}  ${'EXEC'.padStart(5)}  ${'RES'.padStart(4)}  ${'SUPPORT'.padStart(8)}  ${'TOTAL'.padStart(7)}`,
    );
    for (const f of facRanked.slice(0, 15)) {
      console.log(
        `   ${f.name.slice(0, 34).padEnd(34)}  ` +
          `${String(f.row.ACADEMIC ?? 0).padStart(8)}  ` +
          `${String(f.row.EXECUTIVE ?? 0).padStart(5)}  ` +
          `${String(f.row.RESEARCH ?? 0).padStart(4)}  ` +
          `${String(f.row.SUPPORT ?? 0).padStart(8)}  ` +
          `${String(f.sum).padStart(7)}`,
      );
    }
    console.log(`   (${facRanked.length} faculties total)\n`);

    // ── 3. ACADEMIC rank distribution (`level`) ───────────────────
    const ranks = await query<{ level: string; cnt: number }>(
      conn,
      `SELECT COALESCE(NULLIF(TRIM(level), ''), '∅') AS level, COUNT(*) AS cnt
         FROM ${STAFF_TABLE}
        WHERE workline LIKE '%วิชาการ%'
        GROUP BY COALESCE(NULLIF(TRIM(level), ''), '∅')
        ORDER BY cnt DESC`,
    );
    console.log('3. ACADEMIC rank distribution (`level` field)');
    for (const r of ranks) console.log(`   ${r.level.padEnd(36)}  ${r.cnt}`);
    console.log();

    // ── 4. SUPPORT level distribution ─────────────────────────────
    const supLevels = await query<{ level: string; cnt: number }>(
      conn,
      `SELECT COALESCE(NULLIF(TRIM(level), ''), '∅') AS level, COUNT(*) AS cnt
         FROM ${STAFF_TABLE}
        WHERE workline NOT LIKE '%วิชาการ%'
          AND workline <> 'บริหาร'
          AND workline <> 'วิจัย'
        GROUP BY COALESCE(NULLIF(TRIM(level), ''), '∅')
        ORDER BY cnt DESC
        LIMIT 30`,
    );
    console.log('4. SUPPORT level distribution (top 30)');
    for (const r of supLevels) console.log(`   ${r.level.padEnd(36)}  ${r.cnt}`);
    console.log();

    // ── 5. Education level (highest qualification) ────────────────
    const edu = await query<{ category: string; educationlevel: string; cnt: number }>(
      conn,
      `SELECT ${CAT} AS category,
              COALESCE(NULLIF(TRIM(educationlevel), ''), '∅') AS educationlevel,
              COUNT(*) AS cnt
         FROM ${STAFF_TABLE}
        GROUP BY ${CAT}, COALESCE(NULLIF(TRIM(educationlevel), ''), '∅')
        ORDER BY ${CAT}, cnt DESC`,
    );
    console.log('5. Education level by category');
    let lastCat = '';
    for (const r of edu) {
      if (r.category !== lastCat) {
        console.log(`   [${r.category}]`);
        lastCat = r.category;
      }
      console.log(`     ${r.educationlevel.padEnd(34)}  ${r.cnt}`);
    }
    console.log();

    // ── 6. Funding source (`sal_type`) ────────────────────────────
    const fund = await query<{ category: string; sal_type: string; cnt: number }>(
      conn,
      `SELECT ${CAT} AS category,
              COALESCE(NULLIF(TRIM(sal_type), ''), '∅') AS sal_type,
              COUNT(*) AS cnt
         FROM ${STAFF_TABLE}
        GROUP BY ${CAT}, COALESCE(NULLIF(TRIM(sal_type), ''), '∅')
        ORDER BY ${CAT}, cnt DESC`,
    );
    console.log('6. Funding source (`sal_type`) by category');
    lastCat = '';
    for (const r of fund) {
      if (r.category !== lastCat) {
        console.log(`   [${r.category}]`);
        lastCat = r.category;
      }
      console.log(`     ${r.sal_type.padEnd(34)}  ${r.cnt}`);
    }
    console.log();

    // ── 7. Age distribution (decade buckets) — current year ───────
    const today = new Date();
    const yyyy = today.getFullYear();
    const ageRows = await query<{ category: string; bucket: string; cnt: number }>(
      conn,
      `SELECT ${CAT} AS category,
              CASE
                WHEN birthday IS NULL OR birthday = '' THEN '∅'
                WHEN ${yyyy} - YEAR(birthday) < 25 THEN '<25'
                WHEN ${yyyy} - YEAR(birthday) < 35 THEN '25–34'
                WHEN ${yyyy} - YEAR(birthday) < 45 THEN '35–44'
                WHEN ${yyyy} - YEAR(birthday) < 55 THEN '45–54'
                WHEN ${yyyy} - YEAR(birthday) < 60 THEN '55–59'
                WHEN ${yyyy} - YEAR(birthday) < 65 THEN '60–64'
                ELSE '65+'
              END AS bucket,
              COUNT(*) AS cnt
         FROM ${STAFF_TABLE}
        GROUP BY ${CAT}, bucket
        ORDER BY ${CAT}, bucket`,
    );
    console.log('7. Age distribution by category');
    lastCat = '';
    for (const r of ageRows) {
      if (r.category !== lastCat) {
        console.log(`   [${r.category}]`);
        lastCat = r.category;
      }
      console.log(`     ${r.bucket.padEnd(8)}  ${r.cnt}`);
    }
    console.log();

    // ── 8. Salary aggregate sample (HAVING >= 5 suppression) ──────
    const sal = await query<{
      category: string;
      n: number;
      sal_min: number | null;
      sal_avg: number | null;
      sal_max: number | null;
    }>(
      conn,
      `SELECT ${CAT} AS category,
              COUNT(*) AS n,
              MIN(salary) AS sal_min,
              AVG(salary) AS sal_avg,
              MAX(salary) AS sal_max
         FROM ${STAFF_TABLE}
        WHERE salary IS NOT NULL AND salary > 0
        GROUP BY ${CAT}
       HAVING COUNT(*) >= 5`,
    );
    console.log('8. Salary aggregate by category (HAVING n >= 5)');
    console.log(
      `   ${'category'.padEnd(10)}  ${'n'.padStart(6)}  ${'min'.padStart(10)}  ${'avg'.padStart(10)}  ${'max'.padStart(10)}`,
    );
    for (const r of sal) {
      console.log(
        `   ${r.category.padEnd(10)}  ${String(r.n).padStart(6)}  ` +
          `${(r.sal_min ?? 0).toLocaleString().padStart(10)}  ` +
          `${Math.round(r.sal_avg ?? 0).toLocaleString().padStart(10)}  ` +
          `${(r.sal_max ?? 0).toLocaleString().padStart(10)}`,
      );
    }
    console.log();

    // ── 9. Data-quality: presence of key fields per category ──────
    const dq = await query<{
      category: string;
      n: number;
      have_id: number;
      have_birthday: number;
      have_putday: number;
      have_faculty: number;
      have_division: number;
      have_country: number;
      have_email: number;
      have_orcid: number;
    }>(
      conn,
      `SELECT ${CAT} AS category,
              COUNT(*) AS n,
              SUM(CASE WHEN identification IS NOT NULL AND identification <> '' THEN 1 ELSE 0 END) AS have_id,
              SUM(CASE WHEN birthday IS NOT NULL AND birthday <> '' THEN 1 ELSE 0 END) AS have_birthday,
              SUM(CASE WHEN putday IS NOT NULL AND putday <> '' THEN 1 ELSE 0 END) AS have_putday,
              SUM(CASE WHEN faculty IS NOT NULL AND faculty <> '' THEN 1 ELSE 0 END) AS have_faculty,
              SUM(CASE WHEN division IS NOT NULL AND division <> '' THEN 1 ELSE 0 END) AS have_division,
              SUM(CASE WHEN country IS NOT NULL AND country <> '' THEN 1 ELSE 0 END) AS have_country,
              SUM(CASE WHEN email IS NOT NULL AND email <> '' THEN 1 ELSE 0 END) AS have_email,
              0 AS have_orcid
         FROM ${STAFF_TABLE}
        GROUP BY ${CAT}`,
    );
    console.log('9. Data-quality (column population) by category');
    console.log(
      `   ${'category'.padEnd(10)}  ${'n'.padStart(6)}  ${'cit_id'.padStart(7)}  ${'birth'.padStart(6)}  ${'hire'.padStart(6)}  ${'fac'.padStart(5)}  ${'div'.padStart(5)}  ${'country'.padStart(7)}  ${'email'.padStart(6)}`,
    );
    for (const r of dq) {
      const pct = (n: number) => (r.n === 0 ? '—' : `${Math.round((n / r.n) * 100)}%`);
      console.log(
        `   ${r.category.padEnd(10)}  ${String(r.n).padStart(6)}  ` +
          `${pct(r.have_id).padStart(7)}  ` +
          `${pct(r.have_birthday).padStart(6)}  ` +
          `${pct(r.have_putday).padStart(6)}  ` +
          `${pct(r.have_faculty).padStart(5)}  ` +
          `${pct(r.have_division).padStart(5)}  ` +
          `${pct(r.have_country).padStart(7)}  ` +
          `${pct(r.have_email).padStart(6)}`,
      );
    }
    console.log();

    // ── 10. Birth-country distribution (academic, top 12) ─────────
    const country = await query<{ country: string; cnt: number }>(
      conn,
      `SELECT COALESCE(NULLIF(TRIM(country), ''), '∅') AS country, COUNT(*) AS cnt
         FROM ${STAFF_TABLE}
        WHERE workline LIKE '%วิชาการ%'
        GROUP BY COALESCE(NULLIF(TRIM(country), ''), '∅')
        ORDER BY cnt DESC
        LIMIT 12`,
    );
    console.log('10. Education country (`country` field) for ACADEMIC — top 12');
    for (const r of country) console.log(`    ${r.country.padEnd(36)}  ${r.cnt}`);
    console.log();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
