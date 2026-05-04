#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Non-destructive PDF → Program linker.
//
// 2026-05-02 rewrite — fuzzy ≥85% match using two anchors:
//   1. "สาขาวิชา<discipline>" prefix in PDF filenames (KKU's curriculum PDF
//      naming convention) — exact + substring match wins fast.
//   2. Char-bigram Jaccard between the program's parsed-from-D discipline
//      and the filename's สาขาวิชา-anchored segment. ≥0.85 accepts.
//
// Pre-filters by faculty + level so cross-faculty bleed-through can't happen.
// One PDF can only link to one program — first program wins (sorted by
// score desc, ties broken by sequenceNoFromSheet asc).
//
// Idempotent: re-running with same disk state is a no-op.
//
// Usage:
//   pnpm tsx apps/ingestion/src/scripts/link-orphan-pdfs.ts            # dry-run
//   pnpm tsx apps/ingestion/src/scripts/link-orphan-pdfs.ts --apply    # commit
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

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

import { prisma, type ProgramLevel } from '@kku/db';
import { S3Storage } from '@kku/shared';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERBOSE = args.has('--verbose');

const KKU_PROGRAMS_DIR = '/home/denpong/kku_programs';
const FUZZY_THRESHOLD = 0.85; // char-bigram Jaccard cutoff for the fuzzy tier

const LEVEL_DIR_TO_ENUM: Record<string, ProgramLevel> = {
  'ป.ตรี': 'BACHELOR',
  'ป.โท': 'MASTER',
  'ป.เอก': 'DOCTORAL',
  'ป.บัณฑิตชั้นสูง': 'HIGHER_GRAD_DIPLOMA',
};

/** Disk uses some short-form faculty names; map back to DB's canonical
 *  Faculty.nameTh. Only one mismatch found across all four level dirs. */
const FACULTY_DIR_ALIAS: Record<string, string> = {
  'คณะทันตแพทย์': 'คณะทันตแพทยศาสตร์',
};

function normalizeFacultyDir(dir: string): string {
  return FACULTY_DIR_ALIAS[dir] ?? dir;
}

interface DiskPdf {
  level: ProgramLevel;
  facultyDir: string;
  filename: string;
  fullPath: string;
}

async function walkDisk(): Promise<DiskPdf[]> {
  const out: DiskPdf[] = [];
  const levelDirs = await readdir(KKU_PROGRAMS_DIR);
  for (const ld of levelDirs) {
    const lvl = LEVEL_DIR_TO_ENUM[ld];
    if (!lvl) continue;
    const lvlPath = path.join(KKU_PROGRAMS_DIR, ld);
    const facDirs = await readdir(lvlPath);
    for (const fd of facDirs) {
      const fp = path.join(lvlPath, fd);
      const s = await stat(fp).catch(() => null);
      if (!s || !s.isDirectory()) continue;
      const files = await readdir(fp);
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.pdf')) continue;
        out.push({ level: lvl, facultyDir: fd, filename: f, fullPath: path.join(fp, f) });
      }
    }
  }
  return out;
}

// ─── Discipline extraction ───────────────────────────────────────────────────

/** Same algorithm as seed-programs-from-sheet — pulls the first paren
 *  group out of a Thai degree string. Without parens, the whole string is
 *  the discipline. */
function extractDisciplineFromDegree(degreeName: string): string {
  const m = degreeName.match(/\(([^)]+)\)/);
  return (m?.[1] ?? degreeName).trim();
}

/** Pull the candidate discipline from a curriculum PDF filename.
 *  KKU naming convention: "...<degree-prefix> สาขาวิชา<DISCIPLINE> <year>.pdf"
 *  When "สาขาวิชา" is absent (single-discipline degrees like
 *  "เภสัชศาสตรบัณฑิต"), the discipline is the degree string itself. */
function extractDisciplineFromFilenameWithAnchor(filename: string): { discipline: string; anchored: boolean } {
  // Strip ALL trailing `.pdf` (some files end ".pdf.pdf" from accidental double-rename)
  let s = filename.replace(/(\.pdf)+$/i, '');
  // Drop leading numeric prefix (e.g., "239-..." → "...")
  s = s.replace(/^\d+\s*[-_.]?\s*/, '');
  // Strip common trailing institution codes (e.g., "-KKBS", "-KKU", "-IS", "-MED")
  s = s.replace(/[-\s](KKBS|KKU|MED|SCI|IS)\s*$/i, '');
  // Strip trailing year prefixed by hyphen, dot, or whitespace (e.g., "-2569", " 2569", ".2569")
  s = s.replace(/[-_.\s]*\d{4}\s*$/, '');
  // Iterate prefix-stripping until stable. Real filenames stack multiple
  // prefixes: "3-มคอ.2-วศ.บ.อัตโนมัติ" → drop "3-", drop "มคอ.2-", drop
  // "วศ.บ.", arrive at "อัตโนมัติ". Single-pass would only strip one.
  for (let pass = 0; pass < 6; pass++) {
    const before = s;
    // Strip abbreviated degree prefixes like "บธ.บ.", "วท.บ.", "วท.ม.", "ปร.ด.", "ศษ.ม.", "วทบ.", "วทม."
    s = s.replace(/^[ก-๙]{2,3}\.?\s?[ก-๙]{1,2}\.\s*[-_]?\s*/, '');
    // Strip "มคอ" / "มคอ.2" header tag
    s = s.replace(/^มคอ\.?\s*\d*\s*[-_]?\s*/, '');
    // Strip "หลักสูตร" / "ลักสูตร" leading word (typo "ลักสูตร" exists in real files)
    s = s.replace(/^ห?ลักสูตร\s*/, '');
    // Strip leading "P-1", "S-1", "W-1", "E-1" file-tag codes
    s = s.replace(/^[A-Z]+-?\d+\s*/, '');
    // Strip leading numeric tokens left over after previous strips
    s = s.replace(/^\s*\d+\s*[-_.]?\s*/, '');
    if (s === before) break;
  }
  // Anchor on สาขาวิชา (with or without surrounding spaces); keep what follows.
  const sakhwicha = s.match(/สาขาวิชา\s*([^()0-9]+?)(?:\s*\(|\s*$)/);
  if (sakhwicha) return { discipline: sakhwicha[1]!.trim(), anchored: true };
  // Fallback: strip leading degree-keyword tokens then return the rest.
  const fallback = s
    .replace(/^[ก-๙]+(บัณฑิต|มหาบัณฑิต|ดุษฎีบัณฑิต)\s*/, '')
    .replace(/\s*\(หลักสูตรนานาชาติ\)\s*/g, '')
    .replace(/\s*\(นานาชาติ\)\s*/g, '')
    .trim();
  return { discipline: fallback, anchored: false };
}

function extractDisciplineFromFilename(filename: string): string {
  return extractDisciplineFromFilenameWithAnchor(filename).discipline;
}

/** Strip non-discipline noise from a filename for whole-name comparison. */
function cleanFilenameForCompare(filename: string): string {
  return filename
    .replace(/\.pdf$/i, '')
    .replace(/^\d+\s*[-_.]?\s*/, '')
    .replace(/-(KKBS|KKU|MED|SCI)\s*$/i, '')
    .replace(/\s*\d{4}\s*$/, '')
    .replace(/[A-Za-z]{2,}/g, '') // drop alpha runs (file-name codes)
    .trim();
}

// ─── Char-bigram Jaccard for fuzzy matching ──────────────────────────────────

function charBigrams(s: string): Set<string> {
  const cleaned = s.replace(/\s+/g, '').toLowerCase();
  if (cleaned.length < 2) return new Set([cleaned]);
  const out = new Set<string>();
  for (let i = 0; i < cleaned.length - 1; i++) out.add(cleaned.slice(i, i + 2));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}

/** Asymmetric recall: how much of `needle`'s bigram set is contained in
 *  `haystack`'s bigram set. Robust to noisy/long haystacks (filenames
 *  with degree-prefix noise) — we only care that the discipline's
 *  bigrams are mostly present, not that the haystack is "lean". */
function bigramRecall(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0) return 0;
  let hit = 0;
  for (const x of needle) if (haystack.has(x)) hit++;
  return hit / needle.size;
}

// ─── Match scoring ───────────────────────────────────────────────────────────

interface MatchResult {
  pdf: DiskPdf;
  score: number;
  via: string;
}

interface ProgramForMatch {
  id: string;
  code: string;
  level: ProgramLevel;
  majors: string[];
  facultyNameTh: string;
  degreeNameTh: string | null;
  sequenceNoFromSheet: number | null;
}

function scoreCandidate(program: ProgramForMatch, pdf: DiskPdf): MatchResult | null {
  if (program.level !== pdf.level) return null;
  if (program.facultyNameTh !== normalizeFacultyDir(pdf.facultyDir)) return null;

  const programDiscipline =
    program.majors[0]?.trim() ||
    (program.degreeNameTh ? extractDisciplineFromDegree(program.degreeNameTh) : '');
  if (!programDiscipline) return null;

  const { discipline: filenameDiscipline, anchored: filenameAnchored } =
    extractDisciplineFromFilenameWithAnchor(pdf.filename);
  const cleanFilename = pdf.filename.replace(/\.pdf$/i, '');

  // Tier 1: exact substring of program discipline in filename
  if (programDiscipline.length >= 4 && cleanFilename.includes(programDiscipline)) {
    return { pdf, score: 1.0, via: 'exact-discipline-substring' };
  }

  // Tier 2: program discipline equals filename discipline (post-extract)
  if (programDiscipline === filenameDiscipline && filenameDiscipline.length >= 4) {
    return { pdf, score: 0.99, via: 'equal-after-extract' };
  }

  // Tier 3: filename discipline contains program discipline
  if (programDiscipline.length >= 4 && filenameDiscipline.includes(programDiscipline)) {
    return { pdf, score: 0.97, via: 'discipline-in-filename-discipline' };
  }
  if (filenameDiscipline.length >= 4 && programDiscipline.includes(filenameDiscipline)) {
    return { pdf, score: 0.95, via: 'filename-discipline-in-program' };
  }

  // Tier 4: char-bigram Jaccard on extracted disciplines (fuzzy ≥ threshold)
  const sim = jaccard(charBigrams(programDiscipline), charBigrams(filenameDiscipline));
  if (sim >= FUZZY_THRESHOLD) {
    return { pdf, score: sim, via: `bigram-jaccard:${sim.toFixed(2)}` };
  }

  // Tier 5: char-bigram Jaccard against the FULL filename (degree-only PDFs
  // sometimes carry the discipline only via the degree string itself).
  if (program.degreeNameTh) {
    const sim2 = jaccard(charBigrams(program.degreeNameTh), charBigrams(cleanFilename));
    if (sim2 >= FUZZY_THRESHOLD) {
      return { pdf, score: sim2 * 0.95, via: `bigram-jaccard-fullname:${sim2.toFixed(2)}` };
    }
  }

  // Tier 6: recall — does most of the program's discipline live somewhere
  // in the noisy filename? Threshold 0.9 + faculty/level pre-filter makes
  // false positives extremely unlikely. Picks up cases where degree
  // abbreviations / institution codes (`บธ.บ.`, `-KKBS`) bloated the
  // haystack bigram set and dragged Jaccard below 0.85.
  const cleanedHaystack = cleanFilenameForCompare(pdf.filename);
  const recall = bigramRecall(charBigrams(programDiscipline), charBigrams(cleanedHaystack));
  if (recall >= 0.9 && programDiscipline.length >= 6) {
    return { pdf, score: 0.85 + (recall - 0.9) / 2, via: `bigram-recall:${recall.toFixed(2)}` };
  }

  // Tier 7: reverse-recall — the program got renamed LONGER over time
  // ("X" → "X และ Y"), but the PDF on disk uses the older shorter name
  // (often abbreviated with the Thai "ฯ" continuation char). Ask: does
  // most of the FILENAME's discipline live in the program's discipline?
  // Strip "ฯ" from filename discipline first since it's a "etc." marker
  // that adds noise without semantic content.
  //
  // When the filename anchored on `สาขาวิชา` we know the extracted
  // fragment IS the discipline label by KKU's naming convention — the
  // anchor itself is a high-confidence signal, so we relax the bigram
  // threshold from 0.9 → 0.78 in that case. Faculty + level pre-filter
  // still bounds false positives.
  const filenameDiscClean = filenameDiscipline.replace(/ฯ+$/, '').trim();
  if (filenameDiscClean.length >= 6) {
    const reverseRecall = bigramRecall(
      charBigrams(filenameDiscClean),
      charBigrams(programDiscipline),
    );
    const relaxedThreshold = filenameAnchored ? 0.78 : 0.9;
    if (reverseRecall >= relaxedThreshold) {
      return {
        pdf,
        score: 0.78 + (reverseRecall - relaxedThreshold) / 2,
        via: `reverse-recall${filenameAnchored ? '-anchored' : ''}:${reverseRecall.toFixed(2)}`,
      };
    }
  }

  // Tier 8: same idea, forward direction with relaxed threshold for
  // anchored filenames. Catches cases where the PROGRAM grew while the
  // PDF carries the longer historical discipline.
  if (filenameAnchored && programDiscipline.length >= 6) {
    const forwardRecall = bigramRecall(
      charBigrams(programDiscipline),
      charBigrams(filenameDiscClean),
    );
    if (forwardRecall >= 0.78) {
      return { pdf, score: 0.76 + (forwardRecall - 0.78) / 2, via: `forward-recall-anchored:${forwardRecall.toFixed(2)}` };
    }
  }

  return null;
}

interface LinkReport {
  candidatePrograms: number;
  matched: number;
  applied: number;
  matchesByVia: Record<string, number>;
  unmatched: { code: string; faculty: string; level: string; major: string }[];
}

async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN'}`);
  console.log(`Fuzzy threshold: ${FUZZY_THRESHOLD}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const allDiskPdfs = await walkDisk();
  console.log(`PDFs on disk: ${allDiskPdfs.length}`);

  // Programs without a CURRENT_CURRICULUM link
  const programsRaw = await prisma.program.findMany({
    where: { documents: { none: { role: 'CURRENT_CURRICULUM', isCurrent: true } } },
    select: {
      id: true,
      code: true,
      level: true,
      majors: true,
      degreeNameTh: true,
      sequenceNoFromSheet: true,
      faculty: { select: { nameTh: true } },
    },
    orderBy: [{ level: 'asc' }, { sequenceNoFromSheet: 'asc' }],
  });
  const programs: ProgramForMatch[] = programsRaw.map((p) => ({
    id: p.id,
    code: p.code,
    level: p.level,
    majors: p.majors,
    facultyNameTh: p.faculty.nameTh,
    degreeNameTh: p.degreeNameTh,
    sequenceNoFromSheet: p.sequenceNoFromSheet,
  }));
  console.log(`Programs without CURRENT_CURRICULUM: ${programs.length}\n`);

  // Each PDF has exactly one already-known DB row keyed by content hash;
  // rather than skipping by "originalFilename in DB", we score every disk
  // PDF — duplicates collapse via content hash on insert. This lets us
  // re-link a PDF to a different program if the seed re-shaped majors.
  const claimedPdfs = new Set<string>();

  const report: LinkReport = {
    candidatePrograms: programs.length,
    matched: 0,
    applied: 0,
    matchesByVia: {},
    unmatched: [],
  };

  // For each program, find best-scoring unclaimed candidate
  const pendingLinks: { program: ProgramForMatch; match: MatchResult }[] = [];
  for (const p of programs) {
    let best: MatchResult | null = null;
    for (const pdf of allDiskPdfs) {
      if (claimedPdfs.has(pdf.fullPath)) continue;
      const candidate = scoreCandidate(p, pdf);
      if (!candidate) continue;
      if (!best || candidate.score > best.score) best = candidate;
    }
    if (!best) {
      report.unmatched.push({
        code: p.code,
        faculty: p.facultyNameTh,
        level: p.level,
        major: p.majors[0]?.slice(0, 60) ?? '',
      });
      continue;
    }
    claimedPdfs.add(best.pdf.fullPath);
    pendingLinks.push({ program: p, match: best });
    report.matched++;
    report.matchesByVia[best.via.split(':')[0]!] = (report.matchesByVia[best.via.split(':')[0]!] ?? 0) + 1;

    if (VERBOSE || best.score < 0.95) {
      console.log(`  ${p.code} ${p.facultyNameTh}  → ${best.pdf.filename}  [${best.via}]`);
    }
  }

  console.log(`\nMatched: ${report.matched} / ${report.candidatePrograms}`);
  console.log(`Match tier breakdown:`);
  for (const [via, n] of Object.entries(report.matchesByVia)) console.log(`  ${via}: ${n}`);

  if (!APPLY) {
    console.log('\n(dry-run; pass --apply to write links)');
    if (report.unmatched.length > 0) {
      console.log(`\nFirst 15 unmatched programs:`);
      for (const u of report.unmatched.slice(0, 15)) {
        console.log(`  ${u.code} ${u.faculty}/${u.level}  ${u.major}`);
      }
    }
    return;
  }

  // Apply phase: upload + link
  const storage = new S3Storage({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minio_dev',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minio_dev_password',
    region: process.env.MINIO_REGION ?? 'us-east-1',
  });
  const rawBucket = process.env.MINIO_BUCKET_PDF_RAW ?? 'pdf-raw';

  for (const { program, match } of pendingLinks) {
    try {
      const bytes = await readFile(match.pdf.fullPath);
      const contentHash = createHash('sha256').update(bytes).digest('hex');

      const existing = await prisma.pdfDocument.findUnique({
        where: { contentHash },
        select: { id: true },
      });
      let pdfDocId: string;
      if (existing) {
        pdfDocId = existing.id;
      } else {
        const key = `curriculum/${contentHash}.pdf`;
        await storage.putObject({
          bucket: rawBucket,
          key,
          body: bytes,
          contentType: 'application/pdf',
          metadata: {
            'original-filename-utf8': encodeURIComponent(match.pdf.filename),
            uploader: 'link-orphan-pdfs',
            'program-id': program.id,
          },
        });
        const created = await prisma.pdfDocument.create({
          data: {
            originalFilename: match.pdf.filename,
            storageUrl: `s3://${rawBucket}/${key}`,
            fileSize: bytes.byteLength,
            pageCount: 0,
            sourceCategory: 'CURRICULUM',
            sourceCategoryHint: 'CURRICULUM',
            sourceOrg: 'KKU',
            language: 'TH',
            contentHash,
            processingStatus: 'PENDING',
          },
        });
        pdfDocId = created.id;
      }
      await prisma.programDocument.upsert({
        where: { programId_pdfDocumentId: { programId: program.id, pdfDocumentId: pdfDocId } },
        update: { role: 'CURRENT_CURRICULUM', isCurrent: true, notes: `Linked via [${match.via}]` },
        create: {
          programId: program.id,
          pdfDocumentId: pdfDocId,
          role: 'CURRENT_CURRICULUM',
          isCurrent: true,
          notes: `Linked via [${match.via}]`,
        },
      });
      report.applied++;
    } catch (err) {
      console.error(`  ✗ ${program.code}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Applied (links written): ${report.applied}`);
  if (report.unmatched.length > 0) {
    console.log(`\nUnmatched programs (${report.unmatched.length}) — likely no PDF on disk:`);
    for (const u of report.unmatched.slice(0, 20)) {
      console.log(`  ${u.code} ${u.faculty}/${u.level}  ${u.major}`);
    }
    if (report.unmatched.length > 20) console.log(`  … and ${report.unmatched.length - 20} more`);
  }

  // Final state
  const linkCount = await prisma.programDocument.count({ where: { role: 'CURRENT_CURRICULUM', isCurrent: true } });
  const programCount = await prisma.program.count();
  console.log(`\nFinal: ${linkCount} CURRENT_CURRICULUM links across ${programCount} programs`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
