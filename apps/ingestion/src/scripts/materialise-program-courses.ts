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
// Usage:
//   pnpm programs:materialise-program-courses           # apply all
//   pnpm programs:materialise-program-courses --dry-run # preview counts
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

import { prisma } from '@kku/db';
import { withScriptRun } from '../lib/script-run';
import { normaliseCourseCode } from '../lib/course-code';

interface DigestCourse {
  code?: string;
  courseCode?: string;
  nameTh?: string;
  nameEn?: string;
  credits?: number;
}

function parseArgs(argv: string[]): { apply: boolean } {
  return { apply: !argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);

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
    console.log(`Programs to materialise: ${existingIds.size}`);

    let totalInserted = 0;
    let totalDropped = 0;
    let totalDuplicateInDigest = 0;
    let totalEmptyCode = 0;
    let processed = 0;
    let failed = 0;

    for (const programId of existingIds) {
      const entry = byProgram.get(programId);
      if (!entry) continue;
      try {
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
          methodVersion: string;
          ingestionRunId: string;
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
            methodVersion: entry.methodVersion,
            ingestionRunId: runId,
          });
        }

        if (args.apply) {
          await prisma.$transaction([
            prisma.programCourse.deleteMany({ where: { programId } }),
            prisma.programCourse.createMany({ data: rows, skipDuplicates: true }),
          ]);
        }
        totalInserted += rows.length;
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
    console.log(`Rows ${args.apply ? 'inserted' : 'would-insert'}:        ${totalInserted}`);
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
