#!/usr/bin/env tsx
// ────────────────────────────────────────────────────────────────────────────
// Seed RegistryProgramMapping rows by exact-match against existing
// Program rows.
//
// One-shot dev/staging utility — NOT part of the daily pipeline.
//
// What it does:
//   1. Load the captured aggregate fixture (we don't re-hit Oracle).
//   2. For each `Program` in our DB:
//        a. Build a Thai key = (faculty.nameTh, program.nameTh, levelTh)
//        b. Find all distinct (faculty, program, level, major) tuples in
//           the fixture matching that key.
//        c. Create one RegistryProgramMapping per distinct major variant.
//   3. Report match/skip counts.
//
// Idempotent: uses upsert on the unique constraint, so re-running is safe.
//
// Run:    pnpm registry:seed-mappings
// Dry-run: pnpm registry:seed-mappings --dry-run
// ────────────────────────────────────────────────────────────────────────────

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

import { loadOrganization, prisma, type ProgramLevel } from '@kku/db';

const LEVEL_TH: Record<ProgramLevel, string> = {
  BACHELOR: 'ปริญญาตรี',
  MASTER: 'ปริญญาโท',
  DOCTORAL: 'ปริญญาเอก',
  HIGHER_GRAD_DIPLOMA: 'ประกาศนียบัตรบัณฑิตชั้นสูง',
};

interface Q1Row {
  FACULTY_NAME: string;
  PROGRAM_NAME: string;
  PROGRAM_LEVEL: string | null;
  MAJOR: string | null;
}

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  'apps/ingestion/test/fixtures/kku-registry/aggregated.json',
);

async function main(): Promise<number> {
  await loadOrganization();
  const dryRun = process.argv.includes('--dry-run');

  if (!existsSync(FIXTURE_PATH)) {
    console.error(`fixture not found at ${FIXTURE_PATH}\nrun \`pnpm registry:capture aggregate\` first.`);
    return 2;
  }

  console.log('[seed-mappings] loading fixture…');
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
    programTuples?: Q1Row[];
  };

  // `programTuples` is the fixture's distinct (faculty, programme, level,
  // major) vocabulary — programme catalogue metadata, de-duped at capture
  // time, no counts and no student attributes. Re-keying here anyway so the
  // trim/normalisation matches what the mapping rows are written with.
  const tuples = new Map<
    string,
    { faculty: string; program: string; level: string; major: string }
  >();
  for (const r of fixture.programTuples ?? []) {
    const faculty = (r.FACULTY_NAME ?? '').trim();
    const program = (r.PROGRAM_NAME ?? '').trim();
    const level = (r.PROGRAM_LEVEL ?? '').trim();
    const major = (r.MAJOR ?? '').trim();
    const key = `${faculty}|${program}|${level}|${major}`;
    if (!tuples.has(key)) {
      tuples.set(key, { faculty, program, level, major });
    }
  }
  console.log(`[seed-mappings] fixture has ${tuples.size.toLocaleString()} distinct registry tuples`);

  // Index tuples by (faculty, program, level) for fast lookup.
  type Tuple = ReturnType<typeof tuples.get> & object;
  const byFacProgLevel = new Map<string, Tuple[]>();
  for (const t of tuples.values()) {
    const key = `${t.faculty}|${t.program}|${t.level}`;
    let bucket = byFacProgLevel.get(key);
    if (!bucket) {
      bucket = [];
      byFacProgLevel.set(key, bucket);
    }
    bucket.push(t);
  }

  console.log('[seed-mappings] loading our programs…');
  const programs = await prisma.program.findMany({
    select: {
      id: true,
      nameTh: true,
      level: true,
      faculty: { select: { nameTh: true } },
    },
  });
  console.log(`[seed-mappings] our DB has ${programs.length} programs`);

  // Second index — by (faculty, level, major). Registry's "program" field
  // is *usually* the same as its "major" field, but using major-only as
  // the lookup key catches the master-sheet → registry naming mismatch:
  // master stores "<degree> (<major>)" as Program.nameTh, registry stores
  // just "<major>". Falling back to majors[0] from our DB lifts coverage
  // from ~3% to >50% in the kku-registry case.
  const programs2 = await prisma.program.findMany({
    select: {
      id: true,
      nameTh: true,
      majors: true,
      level: true,
      faculty: { select: { nameTh: true } },
    },
  });

  // Build (faculty, level, major) → tuple index for the fallback lookup.
  const byFacLevelMajor = new Map<string, Tuple[]>();
  for (const t of tuples.values()) {
    const key = `${t.faculty}|${t.level}|${t.major}`;
    let bucket = byFacLevelMajor.get(key);
    if (!bucket) {
      bucket = [];
      byFacLevelMajor.set(key, bucket);
    }
    bucket.push(t);
  }

  let matchedPrograms = 0;
  let mappingsToCreate = 0;
  let mappingsCreated = 0;
  let matchedViaExact = 0;
  let matchedViaMajor = 0;
  const unmatched: { faculty: string; program: string; level: string }[] = [];

  for (const p of programs2) {
    const facTh = (p.faculty?.nameTh ?? '').trim();
    const programTh = (p.nameTh ?? '').trim();
    const levelTh = LEVEL_TH[p.level];
    const major = (p.majors[0] ?? '').trim();

    // 1. Exact match on (faculty, programNameTh, levelTh). Catches the
    // ~3% of programs where master sheet name == registry program name.
    let matches: Tuple[] | undefined = byFacProgLevel.get(`${facTh}|${programTh}|${levelTh}`);
    let strategy: 'exact' | 'major' | undefined;
    if (matches && matches.length > 0) {
      strategy = 'exact';
    } else if (major) {
      // 2. Fallback: match on (faculty, level, majors[0]). Bridges the
      // structural format mismatch.
      matches = byFacLevelMajor.get(`${facTh}|${levelTh}|${major}`);
      if (matches && matches.length > 0) strategy = 'major';
    }

    if (!matches || matches.length === 0 || !strategy) {
      unmatched.push({ faculty: facTh, program: programTh, level: levelTh });
      continue;
    }

    matchedPrograms++;
    mappingsToCreate += matches.length;
    if (strategy === 'exact') matchedViaExact++;
    else matchedViaMajor++;

    if (dryRun) continue;

    for (const tuple of matches) {
      await prisma.registryProgramMapping.upsert({
        where: {
          registryFacultyName_registryProgramName_registryLevel_registryMajor: {
            registryFacultyName: tuple.faculty,
            registryProgramName: tuple.program,
            registryLevel: tuple.level,
            registryMajor: tuple.major,
          },
        },
        create: {
          registryFacultyName: tuple.faculty,
          registryProgramName: tuple.program,
          registryLevel: tuple.level,
          registryMajor: tuple.major,
          programId: p.id,
          notes: `auto-seeded by seed-registry-mappings.ts via ${strategy} match`,
        },
        update: {
          programId: p.id,
        },
      });
      mappingsCreated++;
    }
  }

  console.log();
  console.log('[seed-mappings] summary');
  console.log(`  matched programs:        ${matchedPrograms} / ${programs2.length}`);
  console.log(`    via exact (fac,prog,level): ${matchedViaExact}`);
  console.log(`    via major (fac,level,major): ${matchedViaMajor}`);
  console.log(`  mappings ${dryRun ? 'would create' : 'created (upserted)'}: ${dryRun ? mappingsToCreate : mappingsCreated}`);
  console.log(`  unmatched programs:      ${unmatched.length}`);
  if (unmatched.length > 0 && unmatched.length <= 30) {
    console.log();
    console.log('[seed-mappings] unmatched (no exact registry tuple):');
    for (const u of unmatched) {
      console.log(`  - ${u.faculty} | ${u.program} | ${u.level}`);
    }
  }

  if (dryRun) {
    console.log();
    console.log('[seed-mappings] DRY RUN — no rows written. Re-run without --dry-run to commit.');
  }

  await prisma.$disconnect();
  return 0;
}

void main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('[seed-mappings] failed:', err);
    process.exit(2);
  });
