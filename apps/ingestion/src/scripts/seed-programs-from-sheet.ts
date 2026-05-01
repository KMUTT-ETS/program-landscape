#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// One-shot seed: wipe mock programs → pull KKU master programs sheet →
// upsert real Program rows → walk /home/denpong/kku_programs and link each
// PDF to its Program via ProgramDocument.
//
// Sheet columns (8):
//   ลำดับหลักสูตร | สถานะ | คณะ | ชื่อปริญญา | ชื่อสาขา | ระดับ | ปี พ.ศ. | รหัสหลักสูตร อว.
//
// Faculty match: Sheet drops the "คณะ"/"วิทยาลัย" prefix on most rows; we
// normalise by prepending "คณะ" unless the name already starts with one of
// the institutional prefixes ("วิทยาลัย", "บัณฑิตวิทยาลัย").
//
// PDF→Program match: walk /home/denpong/kku_programs/<level>/<faculty>/*.pdf
// and substring-match the major name (ชื่อสาขา) against the filename.
// Unmatched PDFs and unmatched programs both surface in the final report.
//
// Usage:  pnpm programs:seed-from-sheet [--dry-run]
//
// PDF storage path:
//   - SHA-256 content-hash dedup (matches the existing intake pipeline)
//   - Uploaded to MinIO bucket pdf-raw under curriculum/<hash>.pdf
//   - One PdfDocument row per unique-hash PDF
//   - One ProgramDocument link per (program, pdf) with role=CURRENT_CURRICULUM
//     and isCurrent=true
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

import { prisma, type ProgramLevel, type ProgramStatus } from '@kku/db';
import { S3Storage } from '@kku/shared';

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1d_JxDNNCtgnFEwRAhmQy64npYYRAAclAdwNK_pYFsEg/export?format=csv&gid=0';
const CSV_CACHE_PATH = '/tmp/kku-programs-sheet.csv';
const KKU_PROGRAMS_DIR = '/home/denpong/kku_programs';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');

// ─── CSV parsing ─────────────────────────────────────────────────────────────

interface SheetRow {
  sequenceNo: number;
  statusFromSheet: string; // 'Active' | 'Inactive'
  facultyShort: string;
  degreeName: string;
  majorName: string;
  level: string; // ป.ตรี / ป.โท / ป.เอก / ป.บัณฑิตชั้นสูง
  curriculumYearBe: number | null;
  mhesiCode: string;
}

function parseCsv(csv: string): SheetRow[] {
  const lines = csv.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
  const out: SheetRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    if (cells.length < 8) continue;
    const [seq, status, fac, degree, major, level, year, mhesi] = cells;
    const sequenceNo = Number((seq ?? '').trim());
    if (!Number.isInteger(sequenceNo)) continue;
    out.push({
      sequenceNo,
      statusFromSheet: (status ?? '').trim(),
      facultyShort: (fac ?? '').trim(),
      degreeName: (degree ?? '').trim(),
      majorName: (major ?? '').trim(),
      level: (level ?? '').trim(),
      curriculumYearBe: parseYear(year ?? ''),
      mhesiCode: (mhesi ?? '').trim(),
    });
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let inQuotes = false;
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
      } else if (c === '"') {
        inQuotes = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

function parseYear(s: string): number | null {
  const n = Number(s.trim());
  return Number.isInteger(n) && n >= 2400 && n <= 2700 ? n : null;
}

// ─── Faculty + level normalisation ───────────────────────────────────────────

// Sheet sometimes uses abbreviated faculty names with the Pai-yan-noi (ฯ)
// marker. Map back to the canonical full names registered in the Faculty
// table. Other ad-hoc shortenings get added here over time.
const FACULTY_ALIAS_MAP: Record<string, string> = {
  'คณะมนุษยศาสตร์ฯ': 'คณะมนุษยศาสตร์และสังคมศาสตร์',
  'คณะบริหารธุรกิจฯ': 'คณะบริหารธุรกิจและการบัญชี',
};

function normaliseFacultyName(short: string): string {
  const s = short.trim();
  if (!s) return s;
  // Skip rows that are clearly sheet notes / footers, not real faculties.
  if (s.startsWith('หมายเหตุ') || s.length > 60) return '';
  const candidate =
    s.startsWith('วิทยาลัย') || s.startsWith('บัณฑิตวิทยาลัย') ? s : `คณะ${s}`;
  return FACULTY_ALIAS_MAP[candidate] ?? candidate;
}

function normaliseLevel(thaiLevel: string): ProgramLevel | null {
  switch (thaiLevel.trim()) {
    case 'ป.ตรี':
      return 'BACHELOR';
    case 'ป.โท':
      return 'MASTER';
    case 'ป.เอก':
      return 'DOCTORAL';
    case 'ป.บัณฑิตชั้นสูง':
      return 'HIGHER_GRAD_DIPLOMA';
    default:
      return null;
  }
}

function normaliseStatus(sheetStatus: string): ProgramStatus {
  // Sheet uses Active/Inactive; we keep ACTIVE as-is, map Inactive → PAUSED
  // (most analogous of the three enum values; user kept all rows per Q1).
  return sheetStatus.toLowerCase() === 'active' ? 'ACTIVE' : 'PAUSED';
}

// Internal `code`: derived from sequenceNoFromSheet — guaranteed unique per
// sheet row. We don't use mhesiCode here because the sheet has duplicate
// mhesi codes (same code reused across Bachelor + Master variants).
function deriveCode(row: SheetRow): string {
  return `KKU-SEQ-${row.sequenceNo.toString().padStart(4, '0')}`;
}

function deriveNameTh(row: SheetRow): string {
  // The most "program name"-ish column. Sheet's ชื่อปริญญา is sometimes the
  // bare degree title with the major in parens; ชื่อสาขา sometimes carries
  // historical-rename notes. Prefer the degree name if it already contains
  // the major in parens; otherwise concatenate them.
  if (!row.majorName) return row.degreeName || row.facultyShort;
  if (row.degreeName.includes(`(${row.majorName})`)) return row.degreeName;
  if (row.degreeName.includes(row.majorName)) return row.degreeName;
  return `${row.degreeName} (${row.majorName})`;
}

// ─── Phase A: wipe mock programs ─────────────────────────────────────────────

async function wipeMockPrograms(): Promise<void> {
  const existing = await prisma.program.count();
  if (existing === 0) {
    console.log('No existing Program rows to wipe.');
    return;
  }
  console.log(`Wiping ${existing} existing Program rows + cascade-dependent rows…`);
  if (DRY_RUN) {
    console.log('  (dry-run, skipping)');
    return;
  }
  // Manual cascade for arrays / relations Prisma's cascade doesn't cover:
  // CouncilDecision.affectedProgramIds and Scenario.affectedProgramIds are
  // String[] columns — orphan IDs are cosmetic, leave as-is.
  // Annotation rows referencing programs cascade via FK.
  // ProgramSkill / Course / Curriculum / ProgramDocument / metrics all
  // cascade from Program via onDelete: Cascade in the schema.
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
  console.log(`Fetching ${SHEET_URL} (with redirect-follow)…`);
  const res = await fetch(SHEET_URL, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Sheet fetch failed: ${res.status} ${res.statusText}`);
  }
  const csv = await res.text();
  await import('node:fs/promises').then((fs) => fs.writeFile(CSV_CACHE_PATH, csv, 'utf8'));
  return csv;
}

// ─── Phase C: seed programs ──────────────────────────────────────────────────

interface SeedReport {
  totalRowsInSheet: number;
  upserted: number;
  skipped: { reason: string; count: number; samples: string[] }[];
  facultyMisses: string[];
}

async function seedProgramsFromCsv(rows: SheetRow[]): Promise<SeedReport> {
  // Build Faculty.nameTh → id map once.
  const faculties = await prisma.faculty.findMany({ select: { id: true, nameTh: true } });
  const facultyByNameTh = new Map(faculties.map((f) => [f.nameTh, f.id]));

  const report: SeedReport = {
    totalRowsInSheet: rows.length,
    upserted: 0,
    skipped: [],
    facultyMisses: [],
  };

  const skipReasons = new Map<string, { count: number; samples: string[] }>();
  const noteSkip = (reason: string, sample: string) => {
    if (!skipReasons.has(reason)) skipReasons.set(reason, { count: 0, samples: [] });
    const r = skipReasons.get(reason)!;
    r.count++;
    if (r.samples.length < 5) r.samples.push(sample);
  };

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

    const data = {
      code: deriveCode(row),
      mhesiCode: row.mhesiCode || null,
      sequenceNoFromSheet: row.sequenceNo,
      nameTh: deriveNameTh(row),
      nameEn: '', // PDF digest will fill this in Phase 2
      facultyId,
      level,
      status: normaliseStatus(row.statusFromSheet),
      degreeNameTh: row.degreeName || null,
      majors: row.majorName ? [row.majorName] : [],
      curriculumYearBE: row.curriculumYearBe,
    };

    if (DRY_RUN) {
      report.upserted++;
      continue;
    }

    try {
      // Upsert key is sequenceNoFromSheet (guaranteed unique per sheet row).
      // mhesiCode is NOT unique — KKU's master sheet has duplicates between
      // Bachelor + Master variants of some programs.
      await prisma.program.upsert({
        where: { sequenceNoFromSheet: row.sequenceNo },
        update: data,
        create: data,
      });
      report.upserted++;
    } catch (err) {
      noteSkip(`upsert_failed`, `seq=${row.sequenceNo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const [reason, { count, samples }] of skipReasons) {
    report.skipped.push({ reason, count, samples });
  }
  return report;
}

// ─── Phase D: walk folder + upload PDFs ──────────────────────────────────────

interface PdfReport {
  pdfsFound: number;
  pdfsUploaded: number;
  pdfsDeduplicated: number;
  programsLinked: number;
  pdfsOrphan: { filename: string; level: string; faculty: string; reason: string }[];
}

async function uploadAndLinkPdfs(): Promise<PdfReport> {
  const report: PdfReport = {
    pdfsFound: 0,
    pdfsUploaded: 0,
    pdfsDeduplicated: 0,
    programsLinked: 0,
    pdfsOrphan: [],
  };

  if (DRY_RUN) {
    console.log('  (dry-run, skipping PDF upload)');
    return report;
  }

  const storage = new S3Storage({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minio_dev',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minio_dev_password',
    region: process.env.MINIO_REGION ?? 'us-east-1',
  });
  const rawBucket = process.env.MINIO_BUCKET_PDF_RAW ?? 'pdf-raw';

  const levelDirs = await readdir(KKU_PROGRAMS_DIR);
  for (const levelDir of levelDirs) {
    const levelEnum = normaliseLevel(levelDir);
    if (!levelEnum) {
      console.log(`Skipping unknown level dir: ${levelDir}`);
      continue;
    }
    const facultyDirs = await readdir(path.join(KKU_PROGRAMS_DIR, levelDir));
    for (const facultyDir of facultyDirs) {
      const facultyPath = path.join(KKU_PROGRAMS_DIR, levelDir, facultyDir);
      const stats = await stat(facultyPath);
      if (!stats.isDirectory()) continue;

      const faculty = await prisma.faculty.findUnique({
        where: { code: facultyDir },
        select: { id: true },
      }).catch(() => null);
      const facultyByName = await prisma.faculty.findFirst({
        where: { nameTh: facultyDir },
        select: { id: true },
      });
      const facultyId = faculty?.id ?? facultyByName?.id ?? null;

      // Programs in this (level, faculty) bucket
      const programs = facultyId
        ? await prisma.program.findMany({
            where: { level: levelEnum, facultyId },
            select: { id: true, nameTh: true, majors: true, code: true },
          })
        : [];

      const files = await readdir(facultyPath);
      for (const file of files) {
        if (!file.toLowerCase().endsWith('.pdf')) continue;
        report.pdfsFound++;
        const fullPath = path.join(facultyPath, file);

        if (!facultyId) {
          report.pdfsOrphan.push({ filename: file, level: levelDir, faculty: facultyDir, reason: 'unknown_faculty' });
          continue;
        }

        // Match PDF to program — by major-name (ชื่อสาขา) substring on filename.
        // Pick the longest-major match (more specific wins).
        const lowerFile = file;
        const matches = programs
          .filter((p) => {
            const major = p.majors?.[0] ?? '';
            return major.length > 0 && lowerFile.includes(major);
          })
          .sort((a, b) => (b.majors[0]?.length ?? 0) - (a.majors[0]?.length ?? 0));

        const program = matches[0];
        if (!program) {
          report.pdfsOrphan.push({ filename: file, level: levelDir, faculty: facultyDir, reason: 'no_major_match' });
          continue;
        }

        // Upload to MinIO + create PdfDocument with content-hash dedup
        const bytes = await readFile(fullPath);
        const contentHash = createHash('sha256').update(bytes).digest('hex');

        const existing = await prisma.pdfDocument.findUnique({
          where: { contentHash },
          select: { id: true },
        });
        let pdfDocId: string;
        if (existing) {
          pdfDocId = existing.id;
          report.pdfsDeduplicated++;
        } else {
          const key = `curriculum/${contentHash}.pdf`;
          // S3/MinIO metadata headers must be ASCII-safe — Thai filenames
          // raise ERR_INVALID_CHAR. URL-encode non-ASCII before sending.
          await storage.putObject({
            bucket: rawBucket,
            key,
            body: bytes,
            contentType: 'application/pdf',
            metadata: {
              'original-filename-utf8': encodeURIComponent(file),
              uploader: 'seed-programs-from-sheet',
              'program-id': program.id,
            },
          });
          const created = await prisma.pdfDocument.create({
            data: {
              originalFilename: file,
              storageUrl: `s3://${rawBucket}/${key}`,
              fileSize: bytes.byteLength,
              pageCount: 0, // filled by intake worker later
              sourceCategory: 'CURRICULUM',
              sourceCategoryHint: 'CURRICULUM',
              sourceOrg: 'KKU',
              language: 'TH',
              contentHash,
              processingStatus: 'PENDING',
            },
          });
          pdfDocId = created.id;
          report.pdfsUploaded++;
        }

        // Link via ProgramDocument (unique on (programId, pdfDocumentId))
        await prisma.programDocument.upsert({
          where: { programId_pdfDocumentId: { programId: program.id, pdfDocumentId: pdfDocId } },
          update: {
            role: 'CURRENT_CURRICULUM',
            isCurrent: true,
            notes: `Seeded from ${levelDir}/${facultyDir}/${file}`,
          },
          create: {
            programId: program.id,
            pdfDocumentId: pdfDocId,
            role: 'CURRENT_CURRICULUM',
            isCurrent: true,
            notes: `Seeded from ${levelDir}/${facultyDir}/${file}`,
          },
        });
        report.programsLinked++;
      }
    }
  }

  return report;
}

// ─── Main orchestrator ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n[1/4] Wiping mock programs…');
  await wipeMockPrograms();

  console.log('\n[2/4] Fetching KKU master programs sheet…');
  const csv = await fetchSheetCsv();
  const rows = parseCsv(csv);
  console.log(`  Parsed ${rows.length} rows`);

  console.log('\n[3/4] Seeding Program rows…');
  const seedReport = await seedProgramsFromCsv(rows);
  console.log(`  Upserted: ${seedReport.upserted} / ${seedReport.totalRowsInSheet}`);
  for (const s of seedReport.skipped) {
    console.log(`  Skipped (${s.reason}): ${s.count} — samples: ${s.samples.slice(0, 3).join(' | ')}`);
  }
  if (seedReport.facultyMisses.length > 0) {
    console.log(`  Faculty names not found in DB:`);
    for (const f of seedReport.facultyMisses) console.log(`    ${f}`);
  }

  console.log('\n[4/4] Walking folder + uploading PDFs to MinIO…');
  const pdfReport = await uploadAndLinkPdfs();
  console.log(`  PDFs found: ${pdfReport.pdfsFound}`);
  console.log(`  PDFs uploaded (new): ${pdfReport.pdfsUploaded}`);
  console.log(`  PDFs dedup (already in MinIO): ${pdfReport.pdfsDeduplicated}`);
  console.log(`  Programs linked: ${pdfReport.programsLinked}`);
  console.log(`  Orphan PDFs (no program match): ${pdfReport.pdfsOrphan.length}`);
  if (pdfReport.pdfsOrphan.length > 0) {
    const byReason = new Map<string, number>();
    for (const o of pdfReport.pdfsOrphan) byReason.set(o.reason, (byReason.get(o.reason) ?? 0) + 1);
    for (const [reason, count] of byReason) console.log(`    ${reason}: ${count}`);
    console.log(`  First 10 orphans:`);
    for (const o of pdfReport.pdfsOrphan.slice(0, 10)) {
      console.log(`    [${o.reason}] ${o.level}/${o.faculty}/${o.filename}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Final DB state:');
  const programCount = await prisma.program.count();
  const pdfCount = await prisma.pdfDocument.count({ where: { sourceCategory: 'CURRICULUM' } });
  const linkCount = await prisma.programDocument.count();
  console.log(`  Programs: ${programCount}`);
  console.log(`  PdfDocuments (CURRICULUM): ${pdfCount}`);
  console.log(`  ProgramDocument links: ${linkCount}`);
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
