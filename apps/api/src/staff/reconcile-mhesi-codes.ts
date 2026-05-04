// Reconcile our `Program.mhesiCode` against UNICON's authoritative
// CURR_ID list (REF_CURR sheet of Reference_V2.01.xlsx, filtered to
// KKU UNIV_ID = '003').
//
// For every CURR_ID currently appearing on `staff_program_assignment`
// rows with `program_id = NULL`:
//   1. Look up the canonical Thai program name from REF_CURR
//   2. Match by parsed (degree, subject) at matched level
//   3. Try a relaxed "subject stem" pass that strips redundant
//      "วิทยาศาสตร์" / "ศาสตร์" / "การ" prefixes
//   4. Where confident, write a `ProgramMhesiAlias` row pointing to
//      the matched Program
//
// Aliases let multiple UNICON CURR_IDs map to one Program (Thai vs
// International program-mode variants, curriculum-revision codes).
// `Program.mhesiCode` stays as the canonical primary.
//
// Dry-run by default. Pass `--apply` to write changes.

import 'dotenv/config';
import { prisma } from '@kku/db';
import * as XLSX from 'xlsx';

const REF_CURR_XLSX = '/home/denpong/employment/unicon/Reference_V2.01.xlsx';
const KKU_UNIV_ID = '003';

interface RefCurrRow {
  CURR_ID: string;
  CURR_DESC: string;
  UNIV_ID: string;
  LEV_NAME_TH: string;
  DEGREE_NUM: string | number;
}

const LEV_TO_ENUM: Record<string, string> = {
  'ปริญญาตรี': 'BACHELOR',
  'ปริญญาโท': 'MASTER',
  'ปริญญาเอก': 'DOCTORAL',
  'ประกาศนียบัตรบัณฑิตชั้นสูง': 'HIGHER_GRAD_DIPLOMA',
};

function tidy(s: string): string {
  return s
    .replace(/[​ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ฏ/g, 'ฎ')
    .trim();
}

function parseDegreeSubject(name: string): { degree: string; subject: string | null } {
  let s = tidy(name);
  s = s.replace(/^หลักสูตร\s*/, '');
  s = s.replace(/\s*มหาวิทยาลัยขอนแก่น\s*$/, '');
  s = s.replace(/\s*\(([^)]+)\)\s*/g, (_match, inner) => {
    const t = tidy(inner);
    if (/หลักสูตร|Program|ต่อเนื่อง|\d/.test(t)) return ' ';
    return ` ⟦${t}⟧ `;
  });
  s = tidy(s);
  let subject: string | null = null;
  const markerMatch = s.match(/⟦([^⟧]+)⟧/);
  if (markerMatch) {
    subject = tidy(markerMatch[1]!);
    s = s.replace(/⟦[^⟧]+⟧/, '').trim();
  }
  const subjMatch = s.match(/สาขาวิชา\s*(.+?)\s*$/);
  if (subjMatch && !subject) {
    subject = tidy(subjMatch[1]!);
    s = s.replace(/สาขาวิชา\s*.+$/, '').trim();
  }
  return { degree: tidy(s), subject };
}

// "Stem" form of a subject for relaxed matching. Strips redundant
// generic prefixes that REF_CURR uses but our Program.nameTh tends to
// omit: e.g. REF "วิทยาศาสตร์การประมง" ↔ ours "การประมง".
function subjectStem(subject: string | null): string | null {
  if (!subject) return null;
  let s = tidy(subject);
  s = s.replace(/^(วิทยาศาสตร์|ศาสตร์|การ|วิชา)+/, '').trim();
  return s.length > 0 ? s : null;
}

interface ProgramRow {
  id: string;
  nameTh: string;
  level: string;
  mhesiCode: string | null;
  degree: string;
  subject: string | null;
  subjectStem: string | null;
}

interface MatchResult {
  currId: string;
  currDesc: string;
  refLevel: string | null;
  rowsAffected: number;
  refDegree: string;
  refSubject: string | null;
  decision:
    | { kind: 'EXACT'; programId: string; via: 'degree+subject' | 'degree+stem' | 'degree-only' }
    | { kind: 'AMBIGUOUS'; matchIds: string[] }
    | { kind: 'NO_MATCH' }
    | { kind: 'NOT_IN_REF_CURR' };
  candidates: ProgramRow[];
}

async function main() {
  const apply = process.argv.includes('--apply');

  // ── 1. Load REF_CURR (KKU only) ──
  const wb = XLSX.readFile(REF_CURR_XLSX);
  const allRefCurr = XLSX.utils.sheet_to_json<RefCurrRow>(wb.Sheets['REF_CURR']!, { defval: '' });
  const refCurr = new Map<string, RefCurrRow>();
  for (const r of allRefCurr) {
    if (String(r.UNIV_ID).trim() === KKU_UNIV_ID) {
      refCurr.set(String(r.CURR_ID).trim(), r);
    }
  }
  console.log(`REF_CURR: ${refCurr.size} KKU curricula loaded`);

  // ── 2. Get unresolved CURR_IDs from BOTH staff and student tables ──
  const unresolved = await prisma.$queryRaw<Array<{ mhesi_curr_id: string; n: number }>>`
    SELECT mhesi_curr_id, SUM(n)::int AS n FROM (
      SELECT mhesi_curr_id, COUNT(*)::int AS n
        FROM staff_program_assignment
       WHERE program_id IS NULL
       GROUP BY mhesi_curr_id
      UNION ALL
      SELECT mhesi_curr_id, COUNT(*)::int AS n
        FROM student_program_record
       WHERE program_id IS NULL
       GROUP BY mhesi_curr_id
    ) t
    GROUP BY mhesi_curr_id
    ORDER BY n DESC
  `;
  console.log(`Unresolved CURR_IDs (staff+student): ${unresolved.length} (${unresolved.reduce((a, b) => a + b.n, 0)} rows)`);

  // ── 3. Load Programs + existing aliases ──
  const programs = await prisma.program.findMany({
    select: { id: true, nameTh: true, level: true, mhesiCode: true },
  });
  const parsed: ProgramRow[] = programs.map((p) => {
    const ds = parseDegreeSubject(p.nameTh);
    return {
      ...p,
      degree: ds.degree,
      subject: ds.subject,
      subjectStem: subjectStem(ds.subject),
    };
  });

  const existingAliases = await prisma.programMhesiAlias.findMany({
    select: { mhesiCode: true, programId: true },
  });
  const aliasedCodes = new Set(existingAliases.map((a) => a.mhesiCode));

  // Index by (level, degree). Within each, we'll match by exact subject,
  // stem subject, or fall back to degree-only when there's a single
  // subject-less program at that degree.
  const idx = new Map<string, Map<string, ProgramRow[]>>();
  for (const p of parsed) {
    if (!idx.has(p.level)) idx.set(p.level, new Map());
    const lvl = idx.get(p.level)!;
    if (!lvl.has(p.degree)) lvl.set(p.degree, []);
    lvl.get(p.degree)!.push(p);
  }

  // ── 4. Match each unresolved CURR_ID ──
  const results: MatchResult[] = [];
  for (const u of unresolved) {
    const ref = refCurr.get(u.mhesi_curr_id);
    if (!ref) {
      results.push({
        currId: u.mhesi_curr_id, currDesc: '', refLevel: null, rowsAffected: u.n,
        refDegree: '', refSubject: null,
        decision: { kind: 'NOT_IN_REF_CURR' }, candidates: [],
      });
      continue;
    }
    const refDesc = String(ref.CURR_DESC).trim();
    const refLevName = String(ref.LEV_NAME_TH).trim();
    const refLevel = LEV_TO_ENUM[refLevName] ?? null;
    const { degree: refDegree, subject: refSubject } = parseDegreeSubject(refDesc);
    const refStem = subjectStem(refSubject);

    if (!refLevel) {
      // No mapped enum value (e.g., "ประกาศนียบัตรบัณฑิต" plain)
      results.push({
        currId: u.mhesi_curr_id, currDesc: refDesc, refLevel: null,
        rowsAffected: u.n, refDegree, refSubject,
        decision: { kind: 'NO_MATCH' }, candidates: [],
      });
      continue;
    }

    const lvl = idx.get(refLevel);
    const degList = lvl?.get(refDegree) ?? [];
    let matches: ProgramRow[] = [];
    let via: 'degree+subject' | 'degree+stem' | 'degree-only' = 'degree+subject';

    // Strategy 1: exact subject match within same degree+level
    matches = degList.filter((p) => p.subject === refSubject);

    // Strategy 2: stem match (strips "วิทยาศาสตร์"/"การ"/"ศาสตร์" prefix)
    if (matches.length === 0 && refStem) {
      matches = degList.filter((p) => p.subjectStem === refStem);
      if (matches.length > 0) via = 'degree+stem';
    }

    // Strategy 3: degree-only when our DB has exactly one program at this
    // degree (typically subject-less degrees like แพทยศาสตรบัณฑิต).
    if (matches.length === 0 && degList.length === 1) {
      matches = degList;
      via = 'degree-only';
    }

    // Strategy 4: when multiple programs exist at the same (level,
    // degree) but exactly one already carries an mhesiCode, the others
    // are presumed duplicate rows from the seed — alias to the primary.
    // Common case: two Program rows for "แพทยศาสตรบัณฑิต" (Medicine),
    // one tagged with the seed's CURR_ID, one untagged.
    if (matches.length === 0 && degList.length > 1) {
      const withCode = degList.filter((p) => p.mhesiCode);
      if (withCode.length === 1) {
        matches = withCode;
        via = 'degree-only';
      }
    }

    let decision: MatchResult['decision'];
    if (matches.length === 1) {
      decision = { kind: 'EXACT', programId: matches[0]!.id, via };
    } else if (matches.length > 1) {
      decision = { kind: 'AMBIGUOUS', matchIds: matches.map((m) => m.id) };
    } else {
      decision = { kind: 'NO_MATCH' };
    }

    results.push({
      currId: u.mhesi_curr_id, currDesc: refDesc, refLevel,
      rowsAffected: u.n, refDegree, refSubject,
      decision, candidates: matches,
    });
  }

  // ── 5. Report ──
  const buckets = {
    EXACT_DEG_SUBJECT: 0, EXACT_DEG_STEM: 0, EXACT_DEG_ONLY: 0,
    AMBIGUOUS: 0, NO_MATCH: 0, NOT_IN_REF_CURR: 0,
  };
  for (const r of results) {
    if (r.decision.kind === 'EXACT') {
      if (r.decision.via === 'degree+subject') buckets.EXACT_DEG_SUBJECT += 1;
      else if (r.decision.via === 'degree+stem') buckets.EXACT_DEG_STEM += 1;
      else buckets.EXACT_DEG_ONLY += 1;
    } else {
      buckets[r.decision.kind] += 1;
    }
  }
  console.log('\n── Match summary ──');
  for (const [k, v] of Object.entries(buckets)) {
    if (v > 0) console.log(`  ${k.padEnd(28)}  ${v}`);
  }

  const fixable = results.filter((r) => r.decision.kind === 'EXACT');
  const fixableRows = fixable.reduce((a, r) => a + r.rowsAffected, 0);
  console.log(`\n── ${fixable.length} fixable (covers ${fixableRows} staff rows) ──`);
  for (const r of fixable.slice(0, 30)) {
    const d = r.decision as { programId: string; via: string };
    const target = parsed.find((p) => p.id === d.programId)!;
    const tag = d.via === 'degree+subject' ? '✓' : d.via === 'degree+stem' ? '~' : '·';
    const note = target.mhesiCode && target.mhesiCode !== r.currId ? ` [primary mhesi=${target.mhesiCode}, will alias]` : '';
    console.log(`  ${tag} ${r.currId}  +${r.rowsAffected} (${d.via})${note}`);
    console.log(`    UNICON : ${r.currDesc}`);
    console.log(`    OURS   : ${target.nameTh}`);
  }
  if (fixable.length > 30) console.log(`  ...(+${fixable.length - 30} more)`);

  const unfixable = results.filter((r) => r.decision.kind !== 'EXACT');
  if (unfixable.length > 0) {
    console.log(`\n── ${unfixable.length} unfixable (sample of 15) ──`);
    for (const r of unfixable.slice(0, 15)) {
      console.log(`  [${r.decision.kind}] ${r.currId}  +${r.rowsAffected}`);
      if (r.currDesc) console.log(`    desc   : ${r.currDesc}`);
      console.log(`    parsed : level=${r.refLevel ?? '∅'} degree="${r.refDegree}" subject="${r.refSubject ?? '∅'}"`);
    }
  }

  // ── 6. Apply ──
  if (!apply) {
    console.log('\n[dry-run] no changes made. Re-run with --apply to write.');
    await prisma.$disconnect();
    return;
  }

  let inserted = 0, skipped = 0;
  for (const r of fixable) {
    const programId = (r.decision as { programId: string }).programId;
    const target = parsed.find((p) => p.id === programId)!;

    // If our Program already has this CURR_ID as its primary mhesiCode,
    // there's nothing to do — the connector will resolve via Program.mhesiCode.
    if (target.mhesiCode === r.currId) {
      skipped += 1;
      continue;
    }
    // If this CURR_ID is already an alias (re-run safety), skip.
    if (aliasedCodes.has(r.currId)) {
      skipped += 1;
      continue;
    }

    await prisma.programMhesiAlias.create({
      data: {
        programId,
        mhesiCode: r.currId,
        source: 'unicon-ds2004 reconcile',
        note: `Matched via ${(r.decision as { via: string }).via}: "${r.currDesc}"`,
      },
    });
    inserted += 1;
  }
  console.log(`\n[apply] wrote ${inserted} ProgramMhesiAlias rows (skipped ${skipped} already-set)`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
