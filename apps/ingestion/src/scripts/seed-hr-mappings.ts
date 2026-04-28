#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Seed HrOrgMapping rows by exact-match against existing Faculty rows.
//
// One-shot dev/staging utility — NOT part of the daily pipeline.
//
// What it does:
//   1. Load the captured `lookups.json` fixture (the
//      `faculty_org_tree` section is a snapshot of
//      `epm_report.dbo.Faculty`). We don't re-hit SQL Server.
//   2. For each `Faculty` in our DB, build a Thai-name lookup key.
//   3. For each fixture row whose Faculty code matches HCMEmployee
//      BU1 pattern (5 digits) and Parent='Faculty-NN', extract
//      "code - ชื่อ" → split off the Thai name and exact-match
//      against our Faculty.nameTh.
//   4. Upsert one HrOrgMapping per matched code (FACULTY kind).
//   5. Report mapped / unmapped counts.
//
// Idempotent: uses upsert on the unique constraint, so re-running is safe.
//
// Run:    pnpm hr:seed-mappings
// Dry-run: pnpm hr:seed-mappings --dry-run
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

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

import { prisma } from '@kku/db';

interface FacultyTreeRow {
  id: number;
  Faculty: string;
  Parent: string;
  Alias_Default: string;
}

interface LookupsFixture {
  faculty_org_tree: { rows: FacultyTreeRow[] };
}

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  'apps/ingestion/test/fixtures/kku-hr/lookups.json',
);

// HCMEmployee BU1 codes are 5 digits ending in `000` (per discovery —
// 30 distinct values: 01000, 02000, ..., 30000). The Faculty table
// has these as `Parent='Faculty-NN'` rows. The Alias_Default format
// is "XXXXX - ชื่อ" — strip the "XXXXX - " prefix to get the Thai
// name for matching against Faculty.nameTh.
const BU1_PATTERN = /^\d{2}000$/;

function extractThaiName(aliasDefault: string): string {
  // Format: "07000 - คณะแพทยศาสตร์" → "คณะแพทยศาสตร์"
  const idx = aliasDefault.indexOf(' - ');
  return idx === -1 ? aliasDefault.trim() : aliasDefault.slice(idx + 3).trim();
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run');

  if (!existsSync(FIXTURE_PATH)) {
    console.error(
      `fixture not found at ${FIXTURE_PATH}\nrun \`pnpm hr:capture lookups\` first.`,
    );
    return 2;
  }

  console.log('[seed-hr-mappings] loading fixture…');
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as LookupsFixture;
  const allRows = fixture.faculty_org_tree.rows;
  console.log(
    `[seed-hr-mappings] fixture has ${allRows.length.toLocaleString()} faculty_org_tree rows`,
  );

  // Filter to BU1-pattern codes via the "rolls up to faculty NN" rows.
  // Each BU code appears twice in the table (one with Parent='BU_NN',
  // one with Parent='Faculty-NN') — we dedupe by Faculty (code).
  const bu1Lookups = new Map<string, string>(); // code → aliasDefault
  for (const r of allRows) {
    if (BU1_PATTERN.test(r.Faculty) && r.Parent.startsWith('Faculty-')) {
      bu1Lookups.set(r.Faculty, r.Alias_Default);
    }
  }
  console.log(
    `[seed-hr-mappings] ${bu1Lookups.size} HCM BU1-pattern codes found in fixture`,
  );

  console.log('[seed-hr-mappings] loading our faculties…');
  const faculties = await prisma.faculty.findMany({
    select: { id: true, code: true, nameTh: true },
  });
  console.log(
    `[seed-hr-mappings] our DB has ${faculties.length} faculties`,
  );

  // Build a Thai-name → facultyId index for lookup.
  const facultyByNameTh = new Map<string, string>();
  for (const f of faculties) {
    facultyByNameTh.set(f.nameTh.trim(), f.id);
  }

  let matchedFaculties = 0;
  let mappingsCreated = 0;
  const unmatched: { hrCode: string; hrLabel: string }[] = [];

  for (const [hrCode, aliasDefault] of bu1Lookups) {
    const thName = extractThaiName(aliasDefault);
    const facultyId = facultyByNameTh.get(thName);

    if (!facultyId) {
      unmatched.push({ hrCode, hrLabel: aliasDefault });
      continue;
    }

    matchedFaculties++;
    if (dryRun) continue;

    await prisma.hrOrgMapping.upsert({
      where: { hrCode },
      create: {
        hrCode,
        hrLabelTh: aliasDefault,
        hrOrgKind: 'FACULTY',
        facultyId,
        isResolved: true,
        notes: 'auto-seeded by seed-hr-mappings.ts via exact Faculty.nameTh match',
      },
      update: {
        hrLabelTh: aliasDefault,
        hrOrgKind: 'FACULTY',
        facultyId,
        isResolved: true,
      },
    });
    mappingsCreated++;
  }

  console.log();
  console.log('[seed-hr-mappings] summary');
  console.log(`  HCM BU1 codes in fixture:    ${bu1Lookups.size}`);
  console.log(`  matched to KKU Faculty rows: ${matchedFaculties}`);
  console.log(
    `  mappings ${dryRun ? 'would create' : 'created (upserted)'}: ${dryRun ? matchedFaculties : mappingsCreated}`,
  );
  console.log(`  unmatched BU1 codes:         ${unmatched.length}`);
  if (unmatched.length > 0 && unmatched.length <= 50) {
    console.log();
    console.log('[seed-hr-mappings] unmatched (no Faculty.nameTh exact match):');
    for (const u of unmatched) {
      console.log(`  - ${u.hrLabel}`);
    }
  }

  if (dryRun) {
    console.log();
    console.log('[seed-hr-mappings] DRY RUN — no rows written. Re-run without --dry-run to commit.');
  }

  await prisma.$disconnect();
  return 0;
}

void main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('[seed-hr-mappings] failed:', err);
    process.exit(2);
  });
