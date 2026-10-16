#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Materialise PROGRAM_DIGEST.payloadJson.courses[] → program_courses bridge.
//
// 302 approved digests × ~8 courses avg ≈ 2,521 course rows in the source.
// This bridge lets a class_offering (which has no direct program column —
// a course can be used in multiple programs) roll up to every program
// whose curriculum-PDF extracted that course code.
//
// Idempotent — full delete-and-replace per program, inside one transaction
// per program (so a single bad digest doesn't wipe everything).
//
// `courseCode` is normalised the same way as ClassOffering.courseCode
// (whitespace stripped, upper-cased) so the natural join key matches.
//
// ─── WHY THIS SCRIPT REFUSES SOME PROGRAMMES ─────────────────────────────────
//
// program_courses has TWO writers, reading DIFFERENT sources, and only one
// of them is category-aware:
//
//   1. this script          ← PROGRAM_DIGEST payloads (program-digest.vN).
//                             The digest schema has no per-course category
//                             field in ANY version, so every row it writes
//                             has category = NULL.
//   2. program-courses-extract/run.ts
//                           ← a dedicated curriculum-PDF pass
//                             (program-courses-extract.vN).
//                             Reads the หมวด headings, so its rows carry a
//                             real category (or an explicit UNKNOWN).
//
// Both do an unconditional delete-and-replace per programme. So running
// this script over a programme the extractor already owns would silently
// DOWNGRADE it: richer, category-bearing rows replaced by NULL-category
// digest rows, no error, and the loss is only visible as a category
// column that quietly went blank.
//
// Guard: any programme whose existing program_courses rows were written by
// program-courses-extract.* is SKIPPED. `--force` overrides, and exists
// only for a deliberate operator-driven rebuild — it is never the right
// flag to reach for routinely.
//
// Usage:
//   pnpm programs:materialise-program-courses           # apply (guard on)
//   pnpm programs:materialise-program-courses --dry-run # preview counts
//   pnpm programs:materialise-program-courses --force   # override the guard
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

import { loadOrganization, prisma, activeRevisionIdFor } from '@kku/db';
import { CourseCategorySchema, type CourseCategory } from '@kku/shared';
import { withScriptRun } from '../lib/script-run';
import { normaliseCourseCode } from '../lib/course-code';

// Single source of truth for the valid หมวด values — derived from the
// prompt schema rather than re-declared here, so a future prompt-side
// enum change can't silently drift from this guard. The Prisma column's
// enum is checked at compile time by the createMany() call below, so a
// drift between the prompt enum and the DB enum fails the typecheck
// rather than the run.
const VALID_CATEGORIES: ReadonlySet<string> = new Set<string>(CourseCategorySchema.options);

interface DigestCourse {
  code?: string;
  courseCode?: string;
  nameTh?: string;
  nameEn?: string;
  credits?: number;
  /** Untyped on purpose: digest payloads are stored JSON, so anything
   *  could be here. Validated against VALID_CATEGORIES before use. */
  category?: string;
}

// Rows written by program-courses-extract carry this method-version prefix
// (both the LLM path, `program-courses-extract.vN`, and its regex fallback,
// `program-courses-extract.vN-fallback`). Matching on the prefix rather than
// an exact version means a future extractor bump stays protected without
// anyone remembering to edit this constant.
const EXTRACTOR_METHOD_PREFIX = 'program-courses-extract.';

function parseArgs(argv: string[]): { apply: boolean; force: boolean } {
  return { apply: !argv.includes('--dry-run'), force: argv.includes('--force') };
}

async function main(): Promise<void> {
  await loadOrganization();
  const args = parseArgs(process.argv.slice(2));
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}${args.force ? ' (--force: guard DISABLED)' : ''}`);

  // kku-registry is the closest existing slug — these digests describe
  // KKU programs/curricula registered with the registrar. Swap to a
  // dedicated 'kku-curriculum-pdfs' slug if one ever lands in the catalog.
  await withScriptRun('kku-registry', async ({ runId, setRecordsLoaded }) => {
    const digests = await prisma.aiExtraction.findMany({
      where: {
        extractionKind: 'PROGRAM_DIGEST',
        reviewStatus: 'APPROVED',
        sourceEntityType: 'program',
      },
      select: {
        id: true,
        sourceEntityId: true,
        methodVersion: true,
        payloadJson: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    console.log(`Approved PROGRAM_DIGESTs: ${digests.length}`);

    // Group by programId; latest digest wins (orderBy desc above).
    const byProgram = new Map<
      string,
      { methodVersion: string; courses: DigestCourse[] }
    >();
    for (const d of digests) {
      if (byProgram.has(d.sourceEntityId)) continue; // keep the most recent
      const payload = d.payloadJson as unknown as { courses?: DigestCourse[] };
      const courses = Array.isArray(payload?.courses) ? payload.courses : [];
      byProgram.set(d.sourceEntityId, {
        methodVersion: d.methodVersion,
        courses,
      });
    }
    console.log(`Distinct programs with approved digest: ${byProgram.size}`);

    // Verify the programs exist (sourceEntityId should be Program.id).
    const programIds = [...byProgram.keys()];
    const programsExist = await prisma.program.findMany({
      where: { id: { in: programIds } },
      select: { id: true, code: true },
    });
    const existingIds = new Set(programsExist.map((p) => p.id));
    const orphanCount = programIds.filter((id) => !existingIds.has(id)).length;
    if (orphanCount > 0) {
      console.warn(`  ⚠ ${orphanCount} digest(s) reference programs that no longer exist — skipped`);
    }
    // Guard lookup (see the WHY block in the header): which of these
    // programmes already hold rows owned by program-courses-extract?
    const extractorOwnedRows = await prisma.programCourse.findMany({
      where: {
        programId: { in: [...existingIds] },
        methodVersion: { startsWith: EXTRACTOR_METHOD_PREFIX },
      },
      select: { programId: true },
      distinct: ['programId'],
    });
    const extractorOwned = new Set(extractorOwnedRows.map((r) => r.programId));
    if (extractorOwned.size > 0) {
      console.log(
        `Extractor-owned programs: ${extractorOwned.size} ` +
          `(${args.force ? 'OVERWRITING — --force given' : 'will be skipped'})`,
      );
    }
    console.log(`Programs to materialise: ${existingIds.size - (args.force ? 0 : extractorOwned.size)}`);

    let totalInserted = 0;
    let skippedExtractorOwned = 0;
    let totalWithCategory = 0;
    let totalDropped = 0;
    let totalDuplicateInDigest = 0;
    let totalEmptyCode = 0;
    let processed = 0;
    let failed = 0;

    for (const programId of existingIds) {
      const entry = byProgram.get(programId);
      if (!entry) continue;
      // Refuse to downgrade extractor-owned rows. Checked before the
      // transaction, so the destructive deleteMany never runs for these.
      if (extractorOwned.has(programId) && !args.force) {
        skippedExtractorOwned++;
        continue;
      }
      try {
        // Provenance: which curriculum revision produced these rows. NULL is
        // the pre-feature baseline. See packages/db/src/program-revision.ts.
        // Resolved ONCE per programme — never per row, and never inside the
        // $transaction below.
        const programRevisionId = await activeRevisionIdFor(programId);

        // Normalise + dedupe within this digest. The extractor sometimes
        // lists the same course twice (e.g., the legacy "duplicate code"
        // page in the PDF). We keep the first occurrence.
        const seen = new Set<string>();
        const rows: Array<{
          programId: string;
          courseCode: string;
          courseCodeRaw: string;
          courseNameTh: string | null;
          courseNameEn: string | null;
          credits: number | null;
          category: CourseCategory | null;
          methodVersion: string;
          ingestionRunId: string;
          programRevisionId: string | null;
        }> = [];
        for (const c of entry.courses) {
          const raw = String(c.code ?? c.courseCode ?? '').trim();
          if (!raw) {
            totalEmptyCode++;
            continue;
          }
          const norm = normaliseCourseCode(raw);
          if (!norm) {
            totalEmptyCode++;
            continue;
          }
          if (seen.has(norm)) {
            totalDuplicateInDigest++;
            continue;
          }
          seen.add(norm);
          rows.push({
            programId,
            courseCode: norm,
            courseCodeRaw: raw,
            courseNameTh: c.nameTh ?? null,
            courseNameEn: c.nameEn ?? null,
            credits: typeof c.credits === 'number' ? c.credits : null,
            // Always null in practice today: this script's source is
            // program-digest (currently v3), whose course schema has no
            // category field in ANY version — so nothing here to read.
            // Wired anyway so that the day the digest schema gains one,
            // it flows through without a code change. An unrecognised
            // value is discarded rather than coerced, so prompt drift can
            // never silently write a bogus category.
            category:
              c.category && VALID_CATEGORIES.has(c.category)
                ? (c.category as CourseCategory)
                : null,
            methodVersion: entry.methodVersion,
            ingestionRunId: runId,
            programRevisionId,
          });
        }

        if (args.apply) {
          await prisma.$transaction([
            prisma.programCourse.deleteMany({ where: { programId } }),
            prisma.programCourse.createMany({ data: rows, skipDuplicates: true }),
          ]);
        }
        totalInserted += rows.length;
        totalWithCategory += rows.filter((r) => r.category !== null).length;
        totalDropped += entry.courses.length - rows.length;
        processed++;
      } catch (err) {
        failed++;
        console.error(`  ✗ program ${programId} failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    setRecordsLoaded(totalInserted);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Programs processed:        ${processed}`);
    console.log(`Programs failed:           ${failed}`);
    console.log(`Programs skipped (extractor-owned rows): ${skippedExtractorOwned}`);
    console.log(`Rows ${args.apply ? 'inserted' : 'would-insert'}:        ${totalInserted}`);
    console.log(`Rows with a category:      ${totalWithCategory} / ${totalInserted}`);
    console.log(`Rows dropped (empty/dup):  ${totalDropped} (empty=${totalEmptyCode}, dup-in-digest=${totalDuplicateInDigest})`);
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
