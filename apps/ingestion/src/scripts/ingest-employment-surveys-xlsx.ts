#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Ingest KKU annual employment surveys (raw .xlsx → GraduateOutcome upserts).
//
// Source files:  /home/denpong/employment/EmploymentSurveyYYYY.xlsx (BE year)
// Granularity:   one row per graduate (PII), thousands of rows per file
// Target:        GraduateOutcome — one row per (programId, gradYearCE,
//                surveyYearCE), aggregate only
//
// Why a separate script from `outcomes:ingest` (the PDF version)?
//   The PDF survey lands as pre-aggregated faculty/program tables; this
//   one is the raw per-graduate spreadsheet behind the same surveys.
//   Both surface to the same target model so the cockpit doesn't care
//   which stream produced a given row.
//
// Program matching — fuzzy by design:
//   The survey's "หลักสูตร" column doesn't carry a Program.id and
//   the registrar's program names don't line up word-for-word with
//   the survey's compressed labels. We:
//     1. Normalise the survey label (strip plan codes, parens, the
//        "หลักสูตรนานาชาติ" mode-marker, "วิชาเอก..." sub-major suffix)
//     2. Filter canonical Programs to (faculty, level)
//     3. Token-set Jaccard against each candidate's stripped nameTh
//     4. Keep best match if score ≥ MATCH_THRESHOLD; surface losers
//        in the run summary so an analyst can hand-link them.
//
// PDPA — the .xlsx contain citizen IDs and student codes. This
// script:
//   - reads only the columns it needs
//   - never writes per-student rows
//   - drops the PII slice after aggregation; only counts + averages
//     land in GraduateOutcome
//
// Usage:
//   pnpm outcomes:ingest-xlsx                          # dry-run all years
//   pnpm outcomes:ingest-xlsx --commit                 # actually upsert
//   pnpm outcomes:ingest-xlsx 2566 --commit            # one year
//   pnpm outcomes:ingest-xlsx --show-unmatched=20      # list unmatched
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

import * as XLSX from 'xlsx';
import { prisma, type ProgramLevel } from '@kku/db';
import { withScriptRun } from '../lib/script-run';

// ── Constants ────────────────────────────────────────────────────────────
const SOURCE_DIR = '/home/denpong/employment';
const MATCH_THRESHOLD = 0.3; // Combined jaccard / substring / specialty
                              // score. Faculty + level pre-filter keeps
                              // false positives low even at this floor.
const METHODOLOGY_VERSION = 'employment-survey-xlsx.v1';

// ── CLI ──────────────────────────────────────────────────────────────────
interface CliArgs {
  yearsBE: number[] | null;
  commit: boolean;
  showUnmatched: number;
}

function parseArgs(argv: string[]): CliArgs {
  const positionalYear = argv.find((a) => /^\d{4}$/.test(a));
  const commit = argv.includes('--commit');
  const showArg = argv.find((a) => a.startsWith('--show-unmatched'));
  const showUnmatched = showArg
    ? Math.max(0, Number((showArg.split('=')[1] ?? '50') || '50'))
    : 50;
  return {
    yearsBE: positionalYear ? [Number(positionalYear)] : null,
    commit,
    showUnmatched,
  };
}

// ── Header → column-index resolver (schemas vary by year) ────────────────
interface ColMap {
  graduationYearBE: number;
  studentCode: number;
  faculty: number;
  level: number;        // -1 if not present
  program: number;      // "หลักสูตร" — may be degree-name or program-name
  major: number;        // "สาขาวิชา" — sub-discipline
  employmentStatus: number;
  salary: number;
  salaryRange: number;  // -1 if not present
  jobRelevance: number; // -1 if not present
}

function findCol(
  headers: string[],
  predicate: (h: string) => boolean,
): number {
  for (let i = 0; i < headers.length; i++) {
    if (predicate(headers[i] ?? '')) return i;
  }
  return -1;
}

function resolveColumns(headers: string[]): ColMap {
  // Faculty: prefer "คณะ2" when both "คณะ" and "คณะ2" exist (older
  // 2562/2563 files have both — the "คณะ2" column has 689 more
  // populated rows for คณะสหวิทยาการ where "คณะ" is blank). When only
  // one exists (newer files), use it.
  const facultyExact = findCol(headers, (h) => h === 'คณะ');
  const faculty2 = findCol(headers, (h) => h === 'คณะ2');
  const facultyCol = faculty2 >= 0 ? faculty2 : facultyExact;
  // Program (curriculum) — exact "หลักสูตร", NOT "หลักสูตร(ปกติ/พิเศษ)".
  const programCol = findCol(headers, (h) => h === 'หลักสูตร');
  const majorCol = findCol(headers, (h) => h === 'สาขาวิชา');

  // Graduation year is either column 0 ("ปีที่จบ", 2566 format) or the
  // long-form Q5.1 header in older files.
  const gradYearCol = findCol(
    headers,
    (h) => h === 'ปีที่จบ' || h.includes('ปี พ.ศ. ที่สำเร็จการศึกษา'),
  );

  const stdCodeCol = findCol(
    headers,
    (h) => h === 'เลขประจำตัวนักศึกษา' || h === 'เลขบัตรประจำตัวนักศึกษา',
  );

  // "ระดับ" exact (newer files) OR "ระดับการศึกษา" (older files).
  const levelCol = findCol(headers, (h) => h === 'ระดับ' || h === 'ระดับการศึกษา');

  // Employment status — "สถานภาพการทำงานปัจจุบัน" exactly (NOT "_2" / "2" / "3").
  const empStatusCol = findCol(
    headers,
    (h) =>
      h === 'สถานภาพการทำงานปัจจุบัน' ||
      h.includes('(8) สถานภาพการทำงานปัจจุบัน'),
  );

  // Salary — header includes "เงินเดือน" or "รายได้" + "เฉลี่ยต่อเดือน",
  // exclude headers containing "ช่วง" (range buckets) — pick the numeric one.
  const salaryCol = findCol(
    headers,
    (h) =>
      (h.includes('เงินเดือน') || h.includes('รายได้')) &&
      h.includes('เฉลี่ยต่อเดือน') &&
      !h.includes('ช่วง'),
  );
  const salaryRangeCol = findCol(
    headers,
    (h) =>
      (h.includes('เงินเดือน') || h.includes('รายได้')) &&
      h.includes('ช่วง'),
  );

  // Job-relevance — newer files have "ลักษณะงานที่ทำตรงกับสาขา..."
  // (Yes/No "ตรงสาขา" / "ไม่ตรงสาขา"). Older files don't track this
  // directly; fall back to "การนำความรู้จากสาขาฯมาประยุกต์ใช้" which
  // is a 1–5 ordinal.
  const jobRelCol = findCol(
    headers,
    (h) =>
      h.includes('ลักษณะงานที่ทำตรงกับสาขา') ||
      h.includes('การนำความรู้จากสาขา'),
  );

  return {
    graduationYearBE: gradYearCol,
    studentCode: stdCodeCol,
    faculty: facultyCol,
    level: levelCol,
    program: programCol,
    major: majorCol,
    employmentStatus: empStatusCol,
    salary: salaryCol,
    salaryRange: salaryRangeCol,
    jobRelevance: jobRelCol,
  };
}

// ── Level normalisation ──────────────────────────────────────────────────
function normaliseLevel(raw: string | null): ProgramLevel | null {
  if (!raw) return null;
  const s = raw.trim();
  if (s.includes('ประกาศนียบัตรบัณฑิตชั้นสูง') || s.includes('Higher Graduate'))
    return 'HIGHER_GRAD_DIPLOMA';
  if (s.includes('ปริญญาเอก') || s.includes('ดุษฎีบัณฑิต') || s.includes('Doctor'))
    return 'DOCTORAL';
  if (s.includes('ปริญญาโท') || s.includes('มหาบัณฑิต') || s.includes('Master'))
    return 'MASTER';
  if (s.includes('ปริญญาตรี') || s.includes('บัณฑิต') || s.includes('Bachelor'))
    return 'BACHELOR';
  return null;
}

// ── String normalisation for fuzzy matching ──────────────────────────────
const STRIP_PATTERNS: RegExp[] = [
  // Plan + sub-plan codes
  /แผน\s*ก\s*แบบ\s*ก\s*1/g,
  /แผน\s*ก\s*แบบ\s*ก\s*2/g,
  /แผน\s*ก\s*แบบ\s*[1-2]/g,
  /แผน\s*ก/g,
  /แผน\s*ข/g,
  /แบบ\s*ก\s*[1-2]/g,
  // Program-mode markers
  /\(?\s*นานาชาติ\s*\)?/g,
  /หลักสูตรนานาชาติ/g,
  /\(International\s*Program\)/gi,
  /\(?\s*ภาคปกติ\s*\)?/g,
  /\(?\s*ภาคพิเศษ\s*\)?/g,
  /\(?\s*โครงการพิเศษ\s*\)?/g,
  // Sub-major prefix
  /วิชาเอก[^\s,)]*(\s|$)/g,
  // Degree-wrapper prefixes that some Program.nameTh rows include
  /หลักสูตร\s*สาขาวิชา/g,
  /หลักสูตร/g,
  /สาขาวิชา/g,
  // Trailing "บัณฑิต" suffix on degree names
  /บัณฑิต/g,
  // Punctuation
  /[()/,]/g,
];

function normaliseForMatch(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();
  for (const p of STRIP_PATTERNS) s = s.replace(p, ' ');
  // Drop Thai mai-thanthakhat (U+0E4C) — the silent-character mark.
  // The compound form `นิติศาสตรบัณฑิต` has no `์` after `ร`, but the
  // standalone `นิติศาสตร์` does. Stripping equalises them so they
  // collide on substring + token comparisons.
  s = s.replace(/์/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

function tokenize(s: string): Set<string> {
  // Thai has no word boundaries — treat whole normalised string as
  // one token AND its space-separated chunks. This way both exact-
  // contains and partial matches score above 0.
  const tokens = new Set<string>();
  if (s.length >= 2) tokens.add(s);
  for (const t of s.split(/\s+/)) if (t.length >= 2) tokens.add(t);
  return tokens;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Substring overlap — when one normalised string contains the other in
// its entirety, that's a strong signal. The survey often uses just the
// specialty ("เคมี") while the canonical nameTh wraps it in degree
// noise ("วิทยาศาสตรบัณฑิต (เคมี)"). When the shorter side is the QUERY
// (and ≥4 chars), a contains-match should score high even if the
// length ratio is small — degree-name padding is structural noise.
function substringScore(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (query.length < 3) return 0;
  if (candidate.includes(query)) {
    if (query.length >= 4) return 0.95;
    return 0.7; // 3-char queries: less confident
  }
  // Reverse direction — query CONTAINS candidate. Rare; happens when the
  // survey label is more verbose than canonical (e.g. survey carries a
  // sub-major suffix). Still a valid signal.
  if (query.includes(candidate) && candidate.length >= 4) {
    return candidate.length / query.length;
  }
  return 0;
}

function similarity(query: string, candidate: string): number {
  return Math.max(
    jaccard(tokenize(query), tokenize(candidate)),
    substringScore(query, candidate),
  );
}

// Extract the parenthesised specialty from a canonical Program.nameTh
// (e.g. "วิทยาศาสตรบัณฑิต (เคมี)" → "เคมี"). Returns null when no parens.
// Used as an extra match key so survey labels that name only the
// specialty score against the right candidate.
function extractSpecialty(nameTh: string): string | null {
  const m = /\(([^)]+)\)/.exec(nameTh);
  if (!m || !m[1]) return null;
  const inside = m[1].trim();
  if (inside.length < 2) return null;
  return inside;
}

// ── Aggregation buckets ──────────────────────────────────────────────────
interface Bucket {
  programId: string;
  graduationYear: number; // CE
  surveyYear: number;     // CE
  total: number;
  employed: number;
  furtherStudy: number;
  salaryValues: number[];
  jobRelevanceMatches: number;
  jobRelevanceTotal: number;
}

function bucketKey(programId: string, gradYear: number, surveyYear: number): string {
  return `${programId}|${gradYear}|${surveyYear}`;
}

// Status string → buckets. KKU's seven categories collapse to:
//   employed     — currently working (any of "มีงานทำ" / "มีงานทํา")
//   furtherStudy — currently studying (status contains "ศึกษาต่อ")
//   neither      — "ยังไม่มีงานทำ" without "ศึกษาต่อ"
function classifyStatus(raw: string | null | undefined): {
  employed: boolean;
  furtherStudy: boolean;
} {
  if (!raw) return { employed: false, furtherStudy: false };
  const s = String(raw);
  const hasJob = /มีงานท[ำํ]/.test(s) || /อยู่ในสายงาน/.test(s) || /เปลี่ยนสาย/.test(s);
  const studying = /ศึกษาต่อ/.test(s);
  // "ยังไม่มีงานทำ" alone = unemployed; with "ศึกษาต่อ" = studying.
  return { employed: hasJob && !studying, furtherStudy: studying };
}

function classifyJobRelevance(raw: string | null | undefined): {
  matched: boolean | null;
} {
  if (raw == null) return { matched: null };
  const s = String(raw).trim();
  if (s === 'ตรงสาขา') return { matched: true };
  if (s === 'ไม่ตรงสาขา') return { matched: false };
  // Older files: ordinal 1–5 ("การนำความรู้มาประยุกต์ใช้"). Treat ≥3 as
  // matched, <3 as not.
  const n = Number(s);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return { matched: n >= 3 };
  return { matched: null };
}

function parseSalary(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[, ฿]/g, '').trim();
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null; // sanity
  return n;
}

// ── Faculty matcher ──────────────────────────────────────────────────────
async function buildFacultyMap(): Promise<Map<string, string>> {
  const rows = await prisma.faculty.findMany({
    where: { kind: 'ACADEMIC' },
    select: { id: true, nameTh: true },
  });
  const m = new Map<string, string>();
  for (const f of rows) m.set(f.nameTh.trim(), f.id);
  return m;
}

// ── Program matcher (per faculty + level) ────────────────────────────────
interface ProgramCandidate {
  id: string;
  nameTh: string;
  nameEn: string;
  level: ProgramLevel;
  facultyId: string;
  normalised: string;
  /** Pre-normalised specialty (parenthesised tail of nameTh) — null
   *  when the program name has no `(specialty)` segment. */
  specialty: string | null;
}

class ProgramMatcher {
  private byFaculty: Map<string, ProgramCandidate[]> = new Map();

  static async build(): Promise<ProgramMatcher> {
    const m = new ProgramMatcher();
    const programs = await prisma.program.findMany({
      where: { sequenceNoFromSheet: { not: null } },
      select: {
        id: true,
        nameTh: true,
        nameEn: true,
        level: true,
        facultyId: true,
      },
    });
    for (const p of programs) {
      const specialtyRaw = extractSpecialty(p.nameTh);
      const c: ProgramCandidate = {
        id: p.id,
        nameTh: p.nameTh,
        nameEn: p.nameEn,
        level: p.level,
        facultyId: p.facultyId,
        normalised: normaliseForMatch(p.nameTh),
        specialty: specialtyRaw ? normaliseForMatch(specialtyRaw) : null,
      };
      const arr = m.byFaculty.get(p.facultyId);
      if (arr) arr.push(c);
      else m.byFaculty.set(p.facultyId, [c]);
    }
    return m;
  }

  match(
    facultyId: string,
    level: ProgramLevel | null,
    rawProgram: string,
    rawMajor: string | null,
  ): { programId: string; score: number; matched: ProgramCandidate } | null {
    const candidates = this.byFaculty.get(facultyId);
    if (!candidates || candidates.length === 0) return null;
    const filtered = level
      ? candidates.filter((c) => c.level === level)
      : candidates;
    if (filtered.length === 0) return null;

    // Combine program label with major (older files split them).
    const queryRaw = [rawProgram, rawMajor].filter(Boolean).join(' ');
    const query = normaliseForMatch(queryRaw);
    if (query.length < 2) return null;

    // Also keep a major-only normalised query — when the survey has a
    // separate "สาขาวิชา" column, that's often the cleanest specialty
    // signal and we want it to land on a (specialty) candidate.
    const majorQuery = rawMajor ? normaliseForMatch(rawMajor) : null;

    let best: { score: number; cand: ProgramCandidate } | null = null;
    for (const c of filtered) {
      // Score against three keys per candidate; take the max.
      const sFull = similarity(query, c.normalised);
      const sSpec = c.specialty ? similarity(query, c.specialty) : 0;
      const sMaj = majorQuery && c.specialty ? similarity(majorQuery, c.specialty) : 0;
      const score = Math.max(sFull, sSpec, sMaj);
      if (!best || score > best.score) best = { score, cand: c };
    }
    if (!best || best.score < MATCH_THRESHOLD) return null;
    return { programId: best.cand.id, score: best.score, matched: best.cand };
  }
}

// ── BE → CE conversion ───────────────────────────────────────────────────
function beToCe(year: number): number {
  // KKU's BE is offset by 543. Treat values < 2400 as already CE.
  if (!Number.isFinite(year)) return 0;
  if (year >= 2400 && year <= 2700) return year - 543;
  return year;
}

function fileSurveyYearBE(filePath: string): number {
  const m = /EmploymentSurvey(\d{4})\.xlsx$/.exec(path.basename(filePath));
  if (!m) throw new Error(`unrecognised filename: ${filePath}`);
  return Number(m[1]);
}

// ── Per-file pass ────────────────────────────────────────────────────────
interface FileStats {
  filePath: string;
  surveyYearCE: number;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  unknownFaculty: number;
  unknownLevel: number;
  unmatchedSamples: Array<{ faculty: string; program: string; level: string; count: number }>;
}

async function processFile(
  filePath: string,
  facultyMap: Map<string, string>,
  matcher: ProgramMatcher,
  buckets: Map<string, Bucket>,
): Promise<FileStats> {
  const surveyYearBE = fileSurveyYearBE(filePath);
  const surveyYearCE = beToCe(surveyYearBE);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
  const headers = (rows[0] ?? []).map((h) => String(h ?? ''));
  const cols = resolveColumns(headers);

  const stats: FileStats = {
    filePath,
    surveyYearCE,
    totalRows: rows.length - 1,
    matchedRows: 0,
    unmatchedRows: 0,
    unknownFaculty: 0,
    unknownLevel: 0,
    unmatchedSamples: [],
  };
  const unmatchedKey = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const facultyRaw = cols.faculty >= 0 ? String(r[cols.faculty] ?? '').trim() : '';
    const facultyId = facultyMap.get(facultyRaw);
    if (!facultyId) {
      stats.unknownFaculty++;
      stats.unmatchedRows++;
      continue;
    }

    const level = cols.level >= 0
      ? normaliseLevel(String(r[cols.level] ?? ''))
      : null;
    if (cols.level >= 0 && !level) {
      // Some rows have a non-academic level marker. Allow a fallback —
      // matcher will still try (level filter relaxed inside match()).
      stats.unknownLevel++;
    }

    const programRaw = cols.program >= 0 ? String(r[cols.program] ?? '').trim() : '';
    const majorRaw = cols.major >= 0 ? String(r[cols.major] ?? '').trim() : '';
    if (!programRaw && !majorRaw) {
      stats.unmatchedRows++;
      continue;
    }
    const m = matcher.match(facultyId, level, programRaw, majorRaw);
    if (!m) {
      stats.unmatchedRows++;
      const key = `${facultyRaw}|${programRaw || majorRaw}|${level ?? 'unknown'}`;
      unmatchedKey.set(key, (unmatchedKey.get(key) ?? 0) + 1);
      continue;
    }
    stats.matchedRows++;

    // Graduation year — if missing, fall back to surveyYearBE - 1
    // (typical Thai survey practice: surveyed ~6 mo after graduation).
    const gradYearBE = cols.graduationYearBE >= 0
      ? Number(r[cols.graduationYearBE] ?? surveyYearBE - 1)
      : surveyYearBE - 1;
    const gradYearCE = beToCe(gradYearBE);

    const status = cols.employmentStatus >= 0
      ? classifyStatus(String(r[cols.employmentStatus] ?? ''))
      : { employed: false, furtherStudy: false };

    const salary = cols.salary >= 0 ? parseSalary(r[cols.salary]) : null;
    const jr = cols.jobRelevance >= 0
      ? classifyJobRelevance(r[cols.jobRelevance] as string | null)
      : { matched: null };

    const key = bucketKey(m.programId, gradYearCE, surveyYearCE);
    let b = buckets.get(key);
    if (!b) {
      b = {
        programId: m.programId,
        graduationYear: gradYearCE,
        surveyYear: surveyYearCE,
        total: 0,
        employed: 0,
        furtherStudy: 0,
        salaryValues: [],
        jobRelevanceMatches: 0,
        jobRelevanceTotal: 0,
      };
      buckets.set(key, b);
    }
    b.total++;
    if (status.employed) b.employed++;
    if (status.furtherStudy) b.furtherStudy++;
    if (salary !== null) b.salaryValues.push(salary);
    if (jr.matched !== null) {
      b.jobRelevanceTotal++;
      if (jr.matched) b.jobRelevanceMatches++;
    }
  }

  // Top unmatched samples for the run summary
  stats.unmatchedSamples = Array.from(unmatchedKey.entries())
    .map(([k, count]) => {
      const [faculty, program, level] = k.split('|');
      return { faculty: faculty ?? '', program: program ?? '', level: level ?? '', count };
    })
    .sort((a, b) => b.count - a.count);

  return stats;
}

// ── Upsert ───────────────────────────────────────────────────────────────
async function upsertBucket(b: Bucket, freshness: Date, commit: boolean, runId: string): Promise<void> {
  if (b.total === 0) return;
  const employmentRate = b.employed / b.total;
  const furtherStudyRate = b.furtherStudy / b.total;
  const averageSalary = b.salaryValues.length > 0
    ? b.salaryValues.reduce((s, v) => s + v, 0) / b.salaryValues.length
    : 0;
  const jobRelevanceScore = b.jobRelevanceTotal > 0
    ? b.jobRelevanceMatches / b.jobRelevanceTotal
    : 0;

  if (!commit) return;
  await prisma.graduateOutcome.upsert({
    where: {
      programId_graduationYear_surveyYear: {
        programId: b.programId,
        graduationYear: b.graduationYear,
        surveyYear: b.surveyYear,
      },
    },
    update: {
      employmentRate,
      averageSalary,
      jobRelevanceScore,
      furtherStudyRate,
      sampleSize: b.total,
      freshnessDate: freshness,
      methodologyVersion: METHODOLOGY_VERSION,
      ingestionRunId: runId,
    },
    create: {
      programId: b.programId,
      graduationYear: b.graduationYear,
      surveyYear: b.surveyYear,
      employmentRate,
      averageSalary,
      jobRelevanceScore,
      furtherStudyRate,
      sampleSize: b.total,
      freshnessDate: freshness,
      methodologyVersion: METHODOLOGY_VERSION,
      ingestionRunId: runId,
    },
  });
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // List target files
  const files = readdirSync(SOURCE_DIR)
    .filter((f) => /^EmploymentSurvey\d{4}\.xlsx$/.test(f))
    .map((f) => path.join(SOURCE_DIR, f))
    .sort();
  const filtered = args.yearsBE
    ? files.filter((p) => args.yearsBE!.includes(fileSurveyYearBE(p)))
    : files;
  if (filtered.length === 0) {
    console.error(`No matching files in ${SOURCE_DIR}`);
    process.exit(1);
  }

  console.log(`━━━ Employment-survey xlsx ingest (${args.commit ? 'COMMIT' : 'DRY-RUN'}) ━━━`);
  console.log(`Files: ${filtered.length}`);
  for (const f of filtered) console.log(`  · ${path.basename(f)}`);
  console.log();

  // Build matchers once
  const facultyMap = await buildFacultyMap();
  const matcher = await ProgramMatcher.build();

  // Per-file pass → buckets keyed by (program, gradYear, surveyYear)
  const buckets = new Map<string, Bucket>();
  const stats: FileStats[] = [];
  for (const f of filtered) {
    const s = await processFile(f, facultyMap, matcher, buckets);
    stats.push(s);
    console.log(
      `${path.basename(f)}: rows=${s.totalRows.toString().padStart(5)} ` +
        `matched=${s.matchedRows.toString().padStart(5)} ` +
        `unmatched=${s.unmatchedRows.toString().padStart(5)} ` +
        `unknownFac=${s.unknownFaculty}`,
    );
  }

  console.log(`\nBuckets to upsert: ${buckets.size}`);

  // Upsert / dry-run — wrap in a tracked IngestionRun on kku-alumni so every
  // GraduateOutcome row this script writes is provenanced. Without this the
  // rows would carry NULL ingestion_run_id and be filtered out under
  // data-quality.v2 STRICT mode.
  let upserted = 0;
  await withScriptRun('kku-alumni', async ({ runId, setRecordsLoaded }) => {
    for (const b of buckets.values()) {
      const f = filtered.find((fp) => beToCe(fileSurveyYearBE(fp)) === b.surveyYear);
      const freshness = f ? statSync(f).mtime : new Date();
      await upsertBucket(b, freshness, args.commit, runId);
      upserted++;
    }
    setRecordsLoaded(upserted);
  });
  console.log(`${args.commit ? 'Upserted' : 'Would upsert'} ${upserted} GraduateOutcome rows`);

  // Per-bucket totals (sanity check)
  const totalRows = stats.reduce((s, x) => s + x.totalRows, 0);
  const totalMatched = stats.reduce((s, x) => s + x.matchedRows, 0);
  const totalUnmatched = stats.reduce((s, x) => s + x.unmatchedRows, 0);
  console.log(
    `\nGrand totals: rows=${totalRows} matched=${totalMatched} ` +
      `unmatched=${totalUnmatched} (match rate=${((totalMatched / totalRows) * 100).toFixed(1)}%)`,
  );

  // Show top unmatched samples for analyst triage
  if (args.showUnmatched > 0) {
    const all = new Map<string, number>();
    for (const s of stats) {
      for (const u of s.unmatchedSamples) {
        const key = `${u.faculty}|${u.program}|${u.level}`;
        all.set(key, (all.get(key) ?? 0) + u.count);
      }
    }
    const top = Array.from(all.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, args.showUnmatched);
    console.log(`\n━━ Top ${top.length} unmatched (faculty | program | level) ━━`);
    for (const [k, count] of top) {
      const [faculty, program, level] = k.split('|');
      console.log(
        `  ${count.toString().padStart(4)}  ${(faculty ?? '').padEnd(35)} ${level ?? ''}: ${program ?? ''}`,
      );
    }
  }

  if (!args.commit) {
    console.log('\n(Dry-run — no rows written. Pass `--commit` to actually upsert.)');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
