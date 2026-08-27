#!/usr/bin/env tsx
// One-shot sweep that walks every unmatched Program and confirms the
// highest-scored fixture-tuple candidate, with two safety guards:
//
//   1. Score threshold (default 0.30). The seed already caught the easy
//      exact-match cases; the unmatched residue is fuzzier.
//   2. Reassignment only when it CORRECTS an auto-seed mistake — i.e.
//      the existing owner's faculty doesn't match the tuple's faculty,
//      AND our candidate program's faculty does. This rules out stealing
//      mappings from programs the auto-seed legitimately matched.
//
// Anything outside those guards is reported as SKIPPED with a reason.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { prisma } from '@kku/db';

interface Tuple {
  faculty: string;
  program: string;
  level: string | null;
  major: string | null;
}

const LEVEL_TH: Record<string, string> = {
  BACHELOR: 'ปริญญาตรี',
  MASTER: 'ปริญญาโท',
  DOCTORAL: 'ปริญญาเอก',
  HIGHER_GRAD_DIPLOMA: 'ประกาศนียบัตรบัณฑิตชั้นสูง',
};

// AVAILABLE picks need a meaningful score too — the first pass at 0.05 took
// 18% matches that mapped Logistics Engineering to Process Engineering and
// Digital Media Engineering to Chemical Engineering. 0.50 is the threshold
// where the program names share a clear majority of tokens.
const REASSIGN_SCORE_THRESHOLD = 0.50;
const AVAILABLE_MIN_SCORE = 0.50;

function jaccard(a: string, b: string): number {
  const tokenize = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[(),\-/]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 2),
    );
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

async function main() {
  const FIXTURE = path.resolve(
    process.cwd(),
    'apps/ingestion/test/fixtures/kku-registry/aggregated.json',
  );
  if (!existsSync(FIXTURE)) {
    console.error('fixture missing — run pnpm registry:capture aggregate');
    process.exit(1);
  }
  // `programTuples` is the fixture's distinct (faculty, programme, level,
  // major) vocabulary — programme catalogue metadata, no counts, no student
  // attributes.
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    programTuples?: Array<{
      FACULTY_NAME: string;
      PROGRAM_NAME: string;
      PROGRAM_LEVEL: string | null;
      MAJOR: string | null;
    }>;
  };
  const seen = new Map<string, Tuple>();
  for (const r of raw.programTuples ?? []) {
    const fac = (r.FACULTY_NAME ?? '').trim();
    const prog = (r.PROGRAM_NAME ?? '').trim();
    const major = (r.MAJOR ?? '').trim();
    const level = (r.PROGRAM_LEVEL ?? '').trim() || null;
    seen.set(fac + '|' + prog + '|' + (level ?? '') + '|' + major, {
      faculty: fac,
      program: prog,
      level,
      major: major || null,
    });
  }
  const fixture: Tuple[] = [...seen.values()];

  // Pre-load mappings keyed by tuple → owner
  const existing = await prisma.registryProgramMapping.findMany({
    select: {
      registryFacultyName: true,
      registryProgramName: true,
      registryLevel: true,
      registryMajor: true,
      program: { select: { id: true, code: true, faculty: { select: { nameTh: true } } } },
    },
  });
  const byKey = new Map<
    string,
    { programId: string; programCode: string; ownerFaculty: string }
  >();
  for (const m of existing) {
    const key = `${m.registryFacultyName}||${m.registryProgramName}||${m.registryLevel}||${m.registryMajor}`;
    byKey.set(key, {
      programId: m.program.id,
      programCode: m.program.code,
      ownerFaculty: m.program.faculty.nameTh,
    });
  }

  const programs = await prisma.program.findMany({
    where: { registryMappings: { none: {} } },
    select: {
      id: true,
      code: true,
      nameTh: true,
      level: true,
      majors: true,
      faculty: { select: { nameTh: true } },
    },
    orderBy: { code: 'asc' },
  });

  let confirmed = 0;
  let reassigned = 0;
  // Never incremented — the low-score cases are counted as skippedNoCandidate
  // below. Kept so the summary line's shape stays stable. (const, not let:
  // pre-existing lint error in this file, fixed here because CI lints the
  // files a PR touches.)
  const skippedLowScore = 0;
  let skippedNoCandidate = 0;
  let skippedReassignWouldHurt = 0;
  let failed = 0;
  const skipReports: string[] = [];

  for (const p of programs) {
    const levelTh = LEVEL_TH[p.level] ?? p.level;
    const sameFac = fixture.filter((t) => t.faculty === p.faculty.nameTh);
    const pool = sameFac.length > 0 ? sameFac : fixture;
    const scored = pool
      .map((t) => {
        const ps = jaccard(p.nameTh, t.program);
        const ms =
          p.majors.length > 0
            ? Math.max(...p.majors.map((m) => jaccard(m, t.major ?? '')))
            : jaccard(p.nameTh, t.major ?? '');
        return { tuple: t, score: 0.7 * ps + 0.3 * ms };
      })
      .filter((s) => s.score >= AVAILABLE_MIN_SCORE)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      skippedNoCandidate += 1;
      skipReports.push(`${p.code}  ${p.nameTh.slice(0, 40)} — no candidate above noise floor`);
      continue;
    }

    // Prefer the BEST AVAILABLE candidate (not currently mapped) — that
    // never steals from another program. Fall back to a guarded reassign
    // only if no available option exists.
    let chosen: { tuple: Tuple; score: number } | null = null;
    let chosenReassignFromOwner: { programCode: string; ownerFaculty: string } | null = null;

    for (const s of scored) {
      const apiLevel = s.tuple.level ?? levelTh;
      const apiMajor = s.tuple.major ?? '';
      const tupleKey = `${s.tuple.faculty}||${s.tuple.program}||${apiLevel}||${apiMajor}`;
      const owner = byKey.get(tupleKey);
      if (!owner) {
        chosen = s;
        chosenReassignFromOwner = null;
        break;
      }
      if (owner.programId === p.id) {
        chosen = null; // already done
        break;
      }
    }

    let action: 'confirm' | 'reassign' | 'skip' = 'skip';
    let skipReason = '';

    if (!chosen) {
      // No available candidate found. Try guarded reassign on the top one.
      const top = scored[0]!;
      const apiLevel = top.tuple.level ?? levelTh;
      const apiMajor = top.tuple.major ?? '';
      const tupleKey = `${top.tuple.faculty}||${top.tuple.program}||${apiLevel}||${apiMajor}`;
      const owner = byKey.get(tupleKey);
      if (!owner || owner.programId === p.id) continue; // weird — shouldn't reach here
      const tupleFac = top.tuple.faculty;
      const ownerInRightFac = owner.ownerFaculty === tupleFac;
      const candidateInRightFac = p.faculty.nameTh === tupleFac;
      if (top.score < REASSIGN_SCORE_THRESHOLD) {
        skippedReassignWouldHurt += 1;
        skipReason = `only candidate(s) would reassign with score ${Math.round(top.score * 100)}% — too low`;
      } else if (!ownerInRightFac && candidateInRightFac) {
        action = 'reassign';
        chosen = top;
        chosenReassignFromOwner = { programCode: owner.programCode, ownerFaculty: owner.ownerFaculty };
      } else {
        skippedReassignWouldHurt += 1;
        skipReason = `top candidate (${Math.round(top.score * 100)}%) currently with ${owner.programCode} in matching faculty — won't steal`;
      }
    } else {
      action = 'confirm';
    }

    if (action === 'skip' || !chosen) {
      skipReports.push(`${p.code}  ${p.nameTh.slice(0, 40)} — ${skipReason}`);
      continue;
    }

    const top = chosen;
    const apiLevel = top.tuple.level ?? levelTh;
    const apiMajor = top.tuple.major ?? '';
    const tupleKey = `${top.tuple.faculty}||${top.tuple.program}||${apiLevel}||${apiMajor}`;
    const owner = chosenReassignFromOwner;

    try {
      await prisma.registryProgramMapping.upsert({
        where: {
          registryFacultyName_registryProgramName_registryLevel_registryMajor: {
            registryFacultyName: top.tuple.faculty,
            registryProgramName: top.tuple.program,
            registryLevel: apiLevel,
            registryMajor: apiMajor,
          },
        },
        update: { programId: p.id, confirmedAt: new Date() },
        create: {
          programId: p.id,
          registryFacultyName: top.tuple.faculty,
          registryProgramName: top.tuple.program,
          registryLevel: apiLevel,
          registryMajor: apiMajor,
          confirmedAt: new Date(),
        },
      });
      // Refresh the byKey cache so subsequent iterations see the new owner.
      byKey.set(tupleKey, {
        programId: p.id,
        programCode: p.code,
        ownerFaculty: p.faculty.nameTh,
      });
      if (action === 'confirm') {
        confirmed += 1;
        console.log(
          `✓ confirm  ${p.code}  ${p.nameTh.slice(0, 40)}  ←  ${top.tuple.program.slice(0, 40)} (${Math.round(top.score * 100)}%)`,
        );
      } else {
        reassigned += 1;
        console.log(
          `↻ reassign ${p.code}  ${p.nameTh.slice(0, 40)}  ←  ${top.tuple.program.slice(0, 40)} (was ${owner?.programCode}, ${Math.round(top.score * 100)}%)`,
        );
      }
    } catch (err) {
      failed += 1;
      console.log(`✗ failed   ${p.code}  ${(err as Error).message}`);
    }
  }

  console.log('\n─── summary ───');
  console.log(`programs touched:`);
  console.log(`  ✓ confirmed (no side-effect):     ${confirmed}`);
  console.log(`  ↻ reassigned (auto-seed fix):     ${reassigned}`);
  console.log(`programs skipped (need manual review):`);
  console.log(`  ⨯ no candidate above noise floor:   ${skippedNoCandidate}`);
  console.log(`  ⨯ reassign would steal legit owner: ${skippedReassignWouldHurt}`);
  console.log(`failed (DB constraint):              ${failed}`);
  void skippedLowScore;
  if (skipReports.length > 0) {
    console.log('\n─── skipped programs needing manual review ───');
    for (const r of skipReports.slice(0, 30)) console.log('  ' + r);
    if (skipReports.length > 30) console.log(`  ... + ${skipReports.length - 30} more`);
  }

  // Final tally
  const stillUnmatched = await prisma.program.count({ where: { registryMappings: { none: {} } } });
  console.log(`\nfinal unmatched programs: ${stillUnmatched}`);

  await prisma.$disconnect();
}

main();
