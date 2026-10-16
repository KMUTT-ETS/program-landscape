#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Backfill FacultyMember.departmentId for kkupub_-prefixed rows.
//
// The kku-publications.people row carries `department_id`; kku-publications
// has its own `departments` master with `name_en`. Our Department table is
// sparse (12 rows, 5 mapped faculties) — most kkupub-backfilled rows won't
// resolve to a department until our Department seed is expanded. This
// script does what's possible NOW via exact name_en match, and reports the
// unmatched as a worklist for analyst seeding.
//
// Posture:
//   - Only updates FacultyMember rows where employee_code starts with
//     'kkupub_'. Never touches kku-hr-prefixed rows.
//   - Only updates rows where departmentId IS NULL. Idempotent.
//   - No new Department rows created — this script is a join + update pass,
//     not a Department seeder.
//
// Usage:
//   pnpm research:backfill-departments              # dry-run
//   pnpm research:backfill-departments --apply      # commit updates
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadOrganization, prisma } from '@kku/db';
import { configFromEnv, query, withConnection } from '../lib/postgres-client';

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  await loadOrganization();
  console.log(`[backfill-departments] mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  // 1. Load kkupub-prefixed FacultyMember rows that lack departmentId.
  const targets = await prisma.facultyMember.findMany({
    where: { employeeCode: { startsWith: 'kkupub_' }, departmentId: null },
    select: { id: true, employeeCode: true, facultyId: true, nameEn: true },
  });
  console.log(`  kkupub_ FacultyMember rows missing departmentId: ${targets.length.toLocaleString()}`);
  if (targets.length === 0) {
    console.log('  nothing to update.');
    return;
  }

  // Extract the kkuscholar people.id from employeeCode prefix.
  const kkuscholarIdToFmId = new Map<number, { fmId: string; facultyId: string }>();
  for (const r of targets) {
    const m = /^kkupub_(\d+)$/.exec(r.employeeCode);
    if (m) {
      const id = Number(m[1]);
      kkuscholarIdToFmId.set(id, { fmId: r.id, facultyId: r.facultyId });
    }
  }

  // 2. Load our Department table.
  const ourDepts = await prisma.department.findMany({
    select: { id: true, facultyId: true, nameEn: true, nameTh: true },
  });
  // Index by (facultyId, lowercased nameEn) — must scope by faculty
  // because department names like "Department of Biology" might exist
  // under multiple faculties.
  const ourDeptByFacKey = new Map<string, string>();
  for (const d of ourDepts) {
    if (d.nameEn) {
      const k = `${d.facultyId}|${d.nameEn.trim().toLowerCase()}`;
      ourDeptByFacKey.set(k, d.id);
    }
  }
  console.log(`  our Department table: ${ourDepts.length} rows`);

  // 3. Pull kkuscholar.people → departments join for our target IDs.
  const cfg = configFromEnv('KKU_PUBLICATIONS_DB');
  const ids = [...kkuscholarIdToFmId.keys()];
  const rows = await withConnection(cfg, async (client) => {
    return await query<{
      person_id: number;
      department_id: number | null;
      department_name_en: string | null;
      department_name_th: string | null;
    }>(
      client,
      `SELECT p.id AS person_id,
              p.department_id,
              d.name_en AS department_name_en,
              d.name AS department_name_th
       FROM people p
       LEFT JOIN departments d ON d.id = p.department_id
       WHERE p.id = ANY($1::int[])
         AND p.department_id IS NOT NULL`,
      [ids],
    );
  });
  console.log(`  kku-publications people with department_id: ${rows.length.toLocaleString()}`);

  // 4. Resolve and queue updates.
  type Update = { fmId: string; departmentId: string };
  const updates: Update[] = [];
  const unmappedDepts = new Map<string, number>();
  let resolved = 0;
  let skippedNoDept = 0;

  for (const r of rows) {
    if (!r.department_name_en) {
      skippedNoDept++;
      continue;
    }
    const target = kkuscholarIdToFmId.get(r.person_id);
    if (!target) continue;
    const key = `${target.facultyId}|${r.department_name_en.trim().toLowerCase()}`;
    const ourDeptId = ourDeptByFacKey.get(key);
    if (ourDeptId) {
      updates.push({ fmId: target.fmId, departmentId: ourDeptId });
      resolved++;
    } else {
      const k = r.department_name_en.trim();
      unmappedDepts.set(k, (unmappedDepts.get(k) ?? 0) + 1);
    }
  }

  console.log('\n[summary]');
  console.log(`  resolved (will update):           ${resolved.toLocaleString()}`);
  console.log(`  skipped — kkuscholar dept null:   ${skippedNoDept.toLocaleString()}`);
  console.log(`  skipped — no match in our DB:     ${[...unmappedDepts.values()].reduce((a, b) => a + b, 0).toLocaleString()}`);
  console.log(`  distinct unmapped dept names:     ${unmappedDepts.size}`);

  if (unmappedDepts.size > 0) {
    console.log('\n  top-15 unmapped departments (analyst-seed candidates):');
    const sorted = [...unmappedDepts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, n] of sorted.slice(0, 15)) console.log(`    ${name}  (${n} people)`);
    if (sorted.length > 15) console.log(`    ... and ${sorted.length - 15} more`);
  }

  if (!apply) {
    console.log('\n[dry-run] no changes. Pass --apply to commit.');
    return;
  }

  // 5. Apply updates in chunks. Idempotent (we filtered to departmentId IS NULL).
  console.log(`\n[apply] updating ${updates.length.toLocaleString()} FacultyMember rows…`);
  const CHUNK = 50;
  let updated = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((u) =>
        prisma.facultyMember.update({
          where: { id: u.fmId },
          data: { departmentId: u.departmentId },
        }),
      ),
    );
    updated += chunk.length;
    if (updated % 200 === 0 || updated >= updates.length) {
      console.log(`  ${updated.toLocaleString()} / ${updates.length.toLocaleString()}`);
    }
  }
  console.log(`\n[done] updated ${updated.toLocaleString()} FacultyMember rows.`);
}

main()
  .catch((err) => {
    console.error('[error]', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
