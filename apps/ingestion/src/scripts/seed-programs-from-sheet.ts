#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// KKU master programs sheet → Program rows.
//
// 2026-05-02 rewrite — discipline-from-parens approach:
//   • Canonical discipline name comes from the FIRST `(...)` in column D
//     ("ชื่อปริญญา"), NOT column E ("ชื่อสาขา"). Column E is unreliable —
//     it carries rename history, typos, and legacy notes.
//   • When column E disagrees with the parsed-from-D discipline, column E
//     is preserved verbatim in `Program.sheet_remark` for analyst review.
//   • For degree titles WITHOUT parens (e.g., "ทันตแพทยศาสตรบัณฑิต"), the
//     full degree string IS the discipline.
//
// Modes:
//   default       smart-merge (upsert by sequenceNoFromSheet); does NOT
//                 overwrite digest-derived fields (nameEn, totalCredits,
//                 durationYears, language, recruitmentSummaryTh, etc.) —
//                 those come from the PDF and are authoritative.
//   --dry-run     report only, no writes.
//   --wipe        destructive: delete all Program rows + cascade, then
//                 insert from sheet. Use only when the schema changes
//                 require a clean recreate. Wipes 228+ digests' Program-
//                 side materialisation; AiExtraction rows survive.
//
// Sheet columns (8):
//   ลำดับหลักสูตร | สถานะ | คณะ | ชื่อปริญญา | ชื่อสาขา | ระดับ | ปี พ.ศ. | รหัสหลักสูตร อว.
//
// PDF linking is NOT done here. The fuzzy filename matcher that used to do it
// (`link-orphan-pdfs.ts`) was retired 2026-07-29 — it mislinked ~30 programs.
// PDFs are attached per-program via /admin/programs/[id]?tab=files.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import { loadOrganization, prisma, type ProgramLevel, type ProgramStatus } from '@kku/db';

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1d_JxDNNCtgnFEwRAhmQy64npYYRAAclAdwNK_pYFsEg/export?format=csv&gid=0';
const CSV_CACHE_PATH = '/tmp/kku-programs-sheet.csv';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const WIPE = args.has('--wipe');

// ─── CSV parsing ─────────────────────────────────────────────────────────────

interface SheetRow {
  sequenceNo: number;
  statusFromSheet: string;
  facultyShort: string;
  degreeName: string;          // column D ("ชื่อปริญญา")
  originalSheetMajor: string;  // column E ("ชื่อสาขา") — kept raw
  level: string;
  curriculumYearBe: number | null;
  mhesiCode: string;
}

/** Full-CSV parser that respects multi-line quoted fields. The previous
 *  split-on-newline approach silently dropped 7+ rows when a sheet cell
 *  contained an embedded newline (e.g., "กลุ่มวิชา…1.…\n2.…\n3.…"). */
function parseCsvRows(csv: string): string[][] {
  const norm = csv.replace(/\r\n/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i]!;
    if (inQuotes) {
      if (c === '"' && norm[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c; // newlines inside quotes are part of the cell
    } else {
      if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '"') inQuotes = true;
      else cur += c;
    }
  }
  if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }
  return rows;
}

function parseCsv(csv: string): SheetRow[] {
  const rows = parseCsvRows(csv);
  const out: SheetRow[] = [];
  // Skip header (first row); subsequent rows that don't parse as a numeric
  // sequence in column A are footers or blank lines — silently ignored.
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]!;
    if (cells.length < 8) continue;
    const [seq, status, fac, degree, major, level, year, mhesi] = cells;
    const sequenceNo = Number((seq ?? '').trim());
    if (!Number.isInteger(sequenceNo) || sequenceNo <= 0) continue;
    out.push({
      sequenceNo,
      statusFromSheet: (status ?? '').trim(),
      facultyShort: (fac ?? '').trim(),
      degreeName: (degree ?? '').trim(),
      originalSheetMajor: (major ?? '').trim(),
      level: (level ?? '').trim(),
      curriculumYearBe: parseYear(year ?? ''),
      mhesiCode: (mhesi ?? '').trim(),
    });
  }
  return out;
}

function parseYear(s: string): number | null {
  const n = Number(s.trim());
  return Number.isInteger(n) && n >= 2400 && n <= 2700 ? n : null;
}

// ─── Discipline extraction (the new core logic) ──────────────────────────────

interface ExtractedDegree {
  /** First parenthetical, the canonical discipline. Equals the full degree
   *  string when no parens are present (single-discipline degrees like
   *  "ทันตแพทยศาสตรบัณฑิต"). */
  discipline: string;
  /** Subsequent parens — modifiers like "(นานาชาติ)", "(หลักสูตรใหม่)". */
  modifiers: string[];
  /** Degree-prefix preceding the first paren — e.g., "วิทยาศาสตรบัณฑิต". */
  degreePrefix: string;
}

export function extractDisciplineFromDegree(degreeName: string): ExtractedDegree {
  const trimmed = degreeName.trim();
  const matches = [...trimmed.matchAll(/\(([^)]+)\)/g)];
  if (matches.length === 0) {
    return { discipline: trimmed, modifiers: [], degreePrefix: trimmed };
  }
  const first = matches[0]!;
  const discipline = first[1]!.trim();
  const modifiers = matches.slice(1).map((m) => m[1]!.trim());
  const degreePrefix = trimmed.slice(0, first.index).trim();
  return { discipline, modifiers, degreePrefix };
}

/** Normalise for equality comparison: trim, collapse runs of whitespace,
 *  strip a few common decorations that show up on the column-E side only. */
function normaliseForCompare(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s*\(หลักสูตรนานาชาติ\)\s*/g, '')
    .replace(/\s*\(นานาชาติ\)\s*/g, '')
    .trim()
    .toLowerCase();
}

/** Decide whether column E carries information not already encoded by
 *  the parsed-from-D discipline. Returns the verbatim column E string
 *  to persist as `sheet_remark`, or null when E adds nothing. */
function deriveSheetRemark(extracted: ExtractedDegree, columnE: string, columnD: string): string | null {
  if (!columnE) return null;
  const e = normaliseForCompare(columnE);
  const disc = normaliseForCompare(extracted.discipline);
  const fullD = normaliseForCompare(columnD);
  // Identical to discipline — no signal.
  if (e === disc) return null;
  // Identical to the full degree string — also no signal (E mirrors D).
  if (e === fullD) return null;
  // E contains the discipline as a substring AND has no extra Thai words
  // beyond modifier text — still no useful signal.
  // Conservative: keep everything else.
  return columnE;
}

// ─── Faculty + level normalisation ───────────────────────────────────────────

const FACULTY_ALIAS_MAP: Record<string, string> = {
  'คณะมนุษยศาสตร์ฯ': 'คณะมนุษยศาสตร์และสังคมศาสตร์',
  'คณะบริหารธุรกิจฯ': 'คณะบริหารธุรกิจและการบัญชี',
};

function normaliseFacultyName(short: string): string {
  const s = short.trim();
  if (!s) return s;
  if (s.startsWith('หมายเหตุ') || s.length > 60) return '';
  const candidate =
    s.startsWith('วิทยาลัย') || s.startsWith('บัณฑิตวิทยาลัย') ? s : `คณะ${s}`;
  return FACULTY_ALIAS_MAP[candidate] ?? candidate;
}

function normaliseLevel(thaiLevel: string): ProgramLevel | null {
  switch (thaiLevel.trim()) {
    case 'ป.ตรี': return 'BACHELOR';
    case 'ป.โท': return 'MASTER';
    case 'ป.เอก': return 'DOCTORAL';
    case 'ป.บัณฑิตชั้นสูง': return 'HIGHER_GRAD_DIPLOMA';
    default: return null;
  }
}

function normaliseStatus(sheetStatus: string): ProgramStatus {
  return sheetStatus.toLowerCase() === 'active' ? 'ACTIVE' : 'PAUSED';
}

function deriveCode(row: SheetRow): string {
  return `KKU-SEQ-${row.sequenceNo.toString().padStart(4, '0')}`;
}

/** `nameTh` is the full degree string from column D — preserves modifiers
 *  like "(นานาชาติ)" inline. The PDF digest may overwrite this with a
 *  cleaner form on materialisation. */
function deriveNameTh(row: SheetRow): string {
  return row.degreeName || row.originalSheetMajor || row.facultyShort;
}

// ─── Phase A: optional wipe ──────────────────────────────────────────────────

async function wipePrograms(): Promise<void> {
  const existing = await prisma.program.count();
  if (existing === 0) {
    console.log('No existing Program rows to wipe.');
    return;
  }
  console.log(`Wiping ${existing} existing Program rows + cascade-dependent rows…`);
  console.log('  AiExtraction rows survive (FK-free); re-materialise via /admin/extraction-review.');
  if (DRY_RUN) {
    console.log('  (dry-run, skipping)');
    return;
  }
  await prisma.program.deleteMany({});
  console.log('  Wipe complete.');
}

// ─── Phase B: fetch sheet CSV ────────────────────────────────────────────────

async function fetchSheetCsv(): Promise<string> {
  if (existsSync(CSV_CACHE_PATH)) {
    const stats = await stat(CSV_CACHE_PATH);
    const ageMin = (Date.now() - stats.mtimeMs) / 1000 / 60;
    if (ageMin < 60) {
      console.log(`Using cached CSV (${ageMin.toFixed(0)} min old)`);
      return readFileSync(CSV_CACHE_PATH, 'utf8');
    }
  }
  console.log(`Fetching ${SHEET_URL}…`);
  const res = await fetch(SHEET_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status} ${res.statusText}`);
  const csv = await res.text();
  await writeFile(CSV_CACHE_PATH, csv, 'utf8');
  return csv;
}

// ─── Phase C: smart-merge upsert ─────────────────────────────────────────────

interface SeedReport {
  totalRowsInSheet: number;
  created: number;
  updated: number;
  unchanged: number;
  withRemark: number;
  skipped: { reason: string; count: number; samples: string[] }[];
  facultyMisses: string[];
  remarkSamples: string[];
}

async function seedProgramsFromCsv(rows: SheetRow[]): Promise<SeedReport> {
  const faculties = await prisma.faculty.findMany({ select: { id: true, nameTh: true } });
  const facultyByNameTh = new Map(faculties.map((f) => [f.nameTh, f.id]));

  const report: SeedReport = {
    totalRowsInSheet: rows.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    withRemark: 0,
    skipped: [],
    facultyMisses: [],
    remarkSamples: [],
  };

  const skipReasons = new Map<string, { count: number; samples: string[] }>();
  const noteSkip = (reason: string, sample: string) => {
    if (!skipReasons.has(reason)) skipReasons.set(reason, { count: 0, samples: [] });
    const r = skipReasons.get(reason)!;
    r.count++;
    if (r.samples.length < 5) r.samples.push(sample);
  };

  // Pre-fetch existing programs by sequenceNoFromSheet for change detection.
  const existing = await prisma.program.findMany({
    select: { sequenceNoFromSheet: true, majors: true, sheetRemark: true, degreeNameTh: true, mhesiCode: true, curriculumYearBE: true, facultyId: true, level: true, status: true },
  });
  const existingBySeq = new Map(existing.filter((e) => e.sequenceNoFromSheet !== null).map((e) => [e.sequenceNoFromSheet!, e]));

  for (const row of rows) {
    const facultyNameTh = normaliseFacultyName(row.facultyShort);
    const facultyId = facultyByNameTh.get(facultyNameTh);
    if (!facultyId) {
      noteSkip(`unknown_faculty:${facultyNameTh}`, `seq=${row.sequenceNo} ${row.degreeName}`);
      if (!report.facultyMisses.includes(facultyNameTh)) report.facultyMisses.push(facultyNameTh);
      continue;
    }
    const level = normaliseLevel(row.level);
    if (!level) {
      noteSkip(`unknown_level:${row.level}`, `seq=${row.sequenceNo}`);
      continue;
    }

    const extracted = extractDisciplineFromDegree(row.degreeName);
    const sheetRemark = deriveSheetRemark(extracted, row.originalSheetMajor, row.degreeName);
    if (sheetRemark) {
      report.withRemark++;
      if (report.remarkSamples.length < 8) {
        report.remarkSamples.push(`seq=${row.sequenceNo} D="${row.degreeName}" → discipline="${extracted.discipline}" | E="${row.originalSheetMajor.slice(0, 80)}"`);
      }
    }

    // Sheet-owned fields. `nameTh` and `majors` are in this set; the
    // digest's `materialiseProgramDigest` doesn't currently touch them
    // (it touches nameEn / totalCredits / durationYears / language /
    // recruitmentSummaryTh — see packages/db/src/program-digest-materialize.ts).
    const sheetOwned = {
      code: deriveCode(row),
      mhesiCode: row.mhesiCode || null,
      sequenceNoFromSheet: row.sequenceNo,
      nameTh: deriveNameTh(row),
      facultyId,
      level,
      status: normaliseStatus(row.statusFromSheet),
      degreeNameTh: row.degreeName || null,
      majors: [extracted.discipline, ...extracted.modifiers].filter((s) => s.length > 0),
      curriculumYearBE: row.curriculumYearBe,
      sheetRemark,
    };

    const prev = existingBySeq.get(row.sequenceNo);
    const isCreate = !prev;
    const hasChange =
      !!prev && (
        prev.facultyId !== sheetOwned.facultyId ||
        prev.level !== sheetOwned.level ||
        prev.status !== sheetOwned.status ||
        prev.degreeNameTh !== sheetOwned.degreeNameTh ||
        prev.mhesiCode !== sheetOwned.mhesiCode ||
        prev.curriculumYearBE !== sheetOwned.curriculumYearBE ||
        prev.sheetRemark !== sheetOwned.sheetRemark ||
        JSON.stringify(prev.majors) !== JSON.stringify(sheetOwned.majors)
      );

    if (DRY_RUN) {
      if (isCreate) report.created++;
      else if (hasChange) report.updated++;
      else report.unchanged++;
      continue;
    }

    try {
      // Smart-merge: `update` payload only touches sheet-owned fields.
      // Digest-derived fields (nameEn, totalCredits, durationYears,
      // language, recruitmentSummaryTh, careersThJson, …) are NOT in the
      // update payload and remain authoritative once a digest has
      // materialised them.
      await prisma.program.upsert({
        where: { sequenceNoFromSheet: row.sequenceNo },
        update: sheetOwned,
        create: { ...sheetOwned, nameEn: '' },
      });
      if (isCreate) report.created++;
      else if (hasChange) report.updated++;
      else report.unchanged++;
    } catch (err) {
      noteSkip('upsert_failed', `seq=${row.sequenceNo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const [reason, { count, samples }] of skipReasons) {
    report.skipped.push({ reason, count, samples });
  }
  return report;
}

// ─── Main orchestrator ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  await loadOrganization();
  const mode = WIPE ? 'WIPE+RECREATE' : DRY_RUN ? 'DRY RUN (smart-merge)' : 'SMART-MERGE (writes)';
  console.log(`Mode: ${mode}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (WIPE) {
    console.log('\n[1/3] Wiping all Program rows…');
    await wipePrograms();
  } else {
    console.log('\n[1/3] Smart-merge mode — no wipe; existing rows updated in place.');
  }

  console.log('\n[2/3] Fetching KKU master programs sheet…');
  const csv = await fetchSheetCsv();
  const rows = parseCsv(csv);
  console.log(`  Parsed ${rows.length} sheet rows`);

  console.log('\n[3/3] Upserting Program rows…');
  const report = await seedProgramsFromCsv(rows);
  console.log(`  Created:    ${report.created}`);
  console.log(`  Updated:    ${report.updated}`);
  console.log(`  Unchanged:  ${report.unchanged}`);
  console.log(`  With sheet_remark (column E ≠ extracted discipline): ${report.withRemark}`);

  if (report.skipped.length > 0) {
    console.log('\n  Skipped:');
    for (const s of report.skipped) {
      console.log(`    (${s.reason}): ${s.count} — samples: ${s.samples.slice(0, 3).join(' | ')}`);
    }
  }
  if (report.facultyMisses.length > 0) {
    console.log('\n  Faculty names not found in DB:');
    for (const f of report.facultyMisses) console.log(`    ${f}`);
  }
  if (report.remarkSamples.length > 0) {
    console.log('\n  sheet_remark samples (first 8):');
    for (const s of report.remarkSamples) console.log(`    ${s}`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Final DB state:');
  const programCount = await prisma.program.count();
  const programWithRemark = await prisma.program.count({ where: { sheetRemark: { not: null } } });
  const pdfLinkCount = await prisma.programDocument.count({ where: { role: 'CURRENT_CURRICULUM', isCurrent: true } });
  const programsWithoutPdf = await prisma.program.count({ where: { documents: { none: { role: 'CURRENT_CURRICULUM', isCurrent: true } } } });
  console.log(`  Programs:                          ${programCount}`);
  console.log(`  Programs with sheet_remark:        ${programWithRemark}`);
  console.log(`  CURRENT_CURRICULUM links:          ${pdfLinkCount}`);
  console.log(`  Programs without curriculum PDF:   ${programsWithoutPdf}`);
  console.log('\nNext: attach curriculum PDFs via /admin/programs/[id]?tab=files');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
