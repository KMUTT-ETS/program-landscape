// Diff the 50 faculty names found in the processed-HR mart against the
// Faculty rows already seeded in our Postgres, AFTER applying the
// faculty-name normalization map. Output: matched + missing lists,
// sorted by current-staff headcount.
//
// Run: pnpm tsx src/staff/probe-faculty-gap.ts

import 'dotenv/config';
import { prisma } from '@kku/db';
import { configFromEnv, withConnection, query } from './mysql-client';
import { STAFF_TABLE, staffCategorySqlExpr } from './staff-category';
import { FACULTY_NAME_NORMALIZATION, normalizeFacultyName } from './faculty-name-normalization';

interface MartRow {
  faculty: string;
  total: number;
  academic: number;
  support: number;
}

async function main() {
  const cfg = configFromEnv();
  const CAT = staffCategorySqlExpr();

  const martRows = await withConnection(cfg, async (conn) =>
    query<{ faculty: string; total: number; academic: number; support: number }>(
      conn,
      `SELECT COALESCE(NULLIF(TRIM(faculty), ''), '∅') AS faculty,
              COUNT(*) AS total,
              SUM(CASE WHEN ${CAT} IN ('ACADEMIC','RESEARCH') THEN 1 ELSE 0 END) AS academic,
              SUM(CASE WHEN ${CAT} = 'SUPPORT' THEN 1 ELSE 0 END) AS support
         FROM ${STAFF_TABLE}
        GROUP BY COALESCE(NULLIF(TRIM(faculty), ''), '∅')`,
    ),
  );

  const dbFaculties = await prisma.faculty.findMany({
    select: { nameTh: true, kind: true },
  });
  const dbNames = new Set(dbFaculties.map((f) => f.nameTh.trim()));

  // Apply normalization, then merge rows that map to the same canonical name.
  const merged = new Map<
    string,
    { canonical: string; total: number; academic: number; support: number; rawSources: string[]; isNormalized: boolean }
  >();
  for (const r of martRows) {
    const raw = r.faculty;
    // Probe SQL coalesces NULL/'' to '∅'; pass the empty string back
    // through the normalizer so the fallback rule (Office of the
    // President) applies the same way the cube refresh will see it.
    const canonical = raw === '∅' ? normalizeFacultyName('') : normalizeFacultyName(raw);
    const existing = merged.get(canonical) ?? {
      canonical,
      total: 0,
      academic: 0,
      support: 0,
      rawSources: [] as string[],
      isNormalized: false,
    };
    existing.total += Number(r.total);
    existing.academic += Number(r.academic);
    existing.support += Number(r.support);
    existing.rawSources.push(raw);
    if (raw in FACULTY_NAME_NORMALIZATION) existing.isNormalized = true;
    merged.set(canonical, existing);
  }

  const matched: typeof merged extends Map<string, infer V> ? V[] : never = [];
  const missing: typeof matched = [];
  for (const v of merged.values()) {
    if (dbNames.has(v.canonical)) matched.push(v);
    else missing.push(v);
  }
  matched.sort((a, b) => b.total - a.total);
  missing.sort((a, b) => b.total - a.total);

  console.log(`Postgres has ${dbFaculties.length} Faculty rows seeded.`);
  console.log(`MySQL mart has ${martRows.length} distinct faculty values.`);
  console.log(`Normalization map has ${Object.keys(FACULTY_NAME_NORMALIZATION).length} entries.\n`);

  console.log(`── MATCHED (${matched.length}) — after normalization`);
  console.log(
    `   ${'canonical'.padEnd(46)}  ${'TOTAL'.padStart(7)}  ${'AC+RES'.padStart(7)}  ${'SUPPORT'.padStart(8)}  norm?`,
  );
  for (const r of matched) {
    const tag = r.isNormalized ? ' ←' : '';
    console.log(
      `   ${r.canonical.slice(0, 46).padEnd(46)}  ${String(r.total).padStart(7)}  ${String(r.academic).padStart(7)}  ${String(r.support).padStart(8)}${tag}`,
    );
  }
  console.log();

  console.log(`── MISSING (${missing.length}) — still unmapped`);
  console.log(
    `   ${'faculty (raw)'.padEnd(46)}  ${'TOTAL'.padStart(7)}  ${'AC+RES'.padStart(7)}  ${'SUPPORT'.padStart(8)}`,
  );
  for (const r of missing) {
    console.log(
      `   ${r.canonical.slice(0, 46).padEnd(46)}  ${String(r.total).padStart(7)}  ${String(r.academic).padStart(7)}  ${String(r.support).padStart(8)}`,
    );
  }
  console.log();

  const matchedHc = matched.reduce((a, b) => a + b.total, 0);
  const missingHc = missing.reduce((a, b) => a + b.total, 0);
  const tot = matchedHc + missingHc;
  console.log(`Coverage by headcount:`);
  console.log(
    `   matched : ${matchedHc.toLocaleString()} / ${tot.toLocaleString()}  (${((matchedHc / tot) * 100).toFixed(2)}%)`,
  );
  console.log(
    `   missing : ${missingHc.toLocaleString()} / ${tot.toLocaleString()}  (${((missingHc / tot) * 100).toFixed(2)}%)`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
