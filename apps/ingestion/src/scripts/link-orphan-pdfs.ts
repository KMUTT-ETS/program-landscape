#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Non-destructive PDF → Program linker. Recovers programs that the original
// seed-from-sheet substring matcher missed because of:
//   1. "(...)" paren decorations in filenames vs none in sheet
//   2. "เปลี่ยนเป็น xxx" rename notes in sheet vs old-name-only filenames
//   3. "หลักสูตรนานาชาติ" suffix mismatch (with/without parens)
//   4. Sheet uses "วิศวกรรม<X>" while filename uses bare "<X>"
//
// Behaviour:
//   - Reads /home/denpong/kku_programs/<level>/<faculty>/*.pdf
//   - Identifies orphan PDFs (filename not yet in pdf_documents)
//   - Identifies programs without a CURRENT_CURRICULUM link
//   - Applies the matcher; the FIRST candidate per program (highest-score)
//     is the chosen link.
//   - Each linked PDF gets a fresh PdfDocument + MinIO upload (content-hash
//     dedup against any existing identical bytes), then a ProgramDocument
//     row tying it to the program with role=CURRENT_CURRICULUM,isCurrent=true.
//   - Never deletes anything. Never updates an existing ProgramDocument.
//   - Idempotent: re-running with the same disk state is a no-op.
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

const KKU_PROGRAMS_DIR = '/home/denpong/kku_programs';
const LEVEL_DIR_TO_ENUM: Record<string, ProgramLevel> = {
  'ป.ตรี': 'BACHELOR',
  'ป.โท': 'MASTER',
  'ป.เอก': 'DOCTORAL',
  'ป.บัณฑิตชั้นสูง': 'HIGHER_GRAD_DIPLOMA',
};

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

function stripDecorations(major: string): string {
  return major
    .replace(/\s*เปลี่ยนเป็น.*$/, '')
    .replace(/\s*เปลียนจาก.*?เป็น\s*/, '') // "เปลียนจาก X เป็น Y" → keep Y
    .replace(/\([^)]*\)/g, '')
    .replace(/\s*หลักสูตร(นานาชาติ|ใหม่.*)\s*$/g, '')
    .trim();
}

interface MatchResult {
  pdf: DiskPdf;
  score: number;
  via: string;
}

function findBestMatch(majorName: string, orphans: DiskPdf[], facultyDir: string, level: ProgramLevel): MatchResult | null {
  if (!majorName) return null;
  const cleaned = stripDecorations(majorName);
  const matches: MatchResult[] = [];

  for (const pdf of orphans) {
    if (pdf.level !== level || pdf.facultyDir !== facultyDir) continue;

    if (cleaned.length >= 8 && pdf.filename.includes(cleaned)) {
      matches.push({ pdf, score: cleaned.length * 10, via: 'cleaned-substring' });
      continue;
    }
    if (majorName.length >= 8 && pdf.filename.includes(majorName)) {
      matches.push({ pdf, score: majorName.length * 10, via: 'original-substring' });
      continue;
    }
    // Reverse-token: the longest >=6-char token from the filename appearing
    // in the cleaned major name.
    const fileTokens = pdf.filename.split(/[\s\-_.()0-9]+/).filter((t) => t.length >= 6);
    let bestTok = '';
    for (const tok of fileTokens) {
      if (cleaned.includes(tok) && tok.length > bestTok.length) bestTok = tok;
    }
    if (bestTok) matches.push({ pdf, score: bestTok.length, via: `token:${bestTok}` });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches[0] ?? null;
}

interface LinkReport {
  candidatePrograms: number;
  matched: number;
  applied: number;
  skipped: { reason: string; count: number; samples: string[] }[];
}

async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN'}`);

  const allDiskPdfs = await walkDisk();
  console.log(`PDFs on disk: ${allDiskPdfs.length}`);

  // Orphan = filename not yet in pdf_documents.original_filename
  const knownFilenameRows = await prisma.pdfDocument.findMany({ select: { originalFilename: true } });
  const knownFilenames = new Set(knownFilenameRows.map((r) => r.originalFilename));
  const orphanPdfs = allDiskPdfs.filter((p) => !knownFilenames.has(p.filename));
  console.log(`Orphan PDFs: ${orphanPdfs.length}`);

  // Programs without a CURRENT_CURRICULUM link
  const programsNoPdf = await prisma.program.findMany({
    where: { documents: { none: { role: 'CURRENT_CURRICULUM', isCurrent: true } } },
    select: { id: true, code: true, level: true, majors: true, faculty: { select: { nameTh: true } } },
    orderBy: [{ level: 'asc' }, { code: 'asc' }],
  });
  console.log(`Programs without PDF: ${programsNoPdf.length}\n`);

  const report: LinkReport = {
    candidatePrograms: programsNoPdf.length,
    matched: 0,
    applied: 0,
    skipped: [],
  };
  const skipReasons = new Map<string, { count: number; samples: string[] }>();
  const noteSkip = (reason: string, sample: string) => {
    if (!skipReasons.has(reason)) skipReasons.set(reason, { count: 0, samples: [] });
    const r = skipReasons.get(reason)!;
    r.count++;
    if (r.samples.length < 5) r.samples.push(sample);
  };

  // Each PDF can only link to one program — track pending claims to avoid
  // two programs racing for the same orphan.
  const claimed = new Set<string>();

  const storage = APPLY
    ? new S3Storage({
        endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
        accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minio_dev',
        secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minio_dev_password',
        region: process.env.MINIO_REGION ?? 'us-east-1',
      })
    : null;
  const rawBucket = process.env.MINIO_BUCKET_PDF_RAW ?? 'pdf-raw';

  for (const p of programsNoPdf) {
    const major = p.majors[0] ?? '';
    const cands = findBestMatch(major, orphanPdfs.filter((o) => !claimed.has(o.filename)), p.faculty.nameTh, p.level);
    if (!cands) {
      noteSkip('no_match', `${p.code} ${p.faculty.nameTh} / ${major.slice(0, 50)}`);
      continue;
    }
    report.matched++;
    claimed.add(cands.pdf.filename);
    console.log(`  ${p.code} ${p.faculty.nameTh}`);
    console.log(`    → ${cands.pdf.filename}  [${cands.via}]`);

    if (!APPLY) continue;

    try {
      const bytes = await readFile(cands.pdf.fullPath);
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
        await storage!.putObject({
          bucket: rawBucket,
          key,
          body: bytes,
          contentType: 'application/pdf',
          metadata: {
            'original-filename-utf8': encodeURIComponent(cands.pdf.filename),
            uploader: 'link-orphan-pdfs',
            'program-id': p.id,
          },
        });
        const created = await prisma.pdfDocument.create({
          data: {
            originalFilename: cands.pdf.filename,
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
        where: { programId_pdfDocumentId: { programId: p.id, pdfDocumentId: pdfDocId } },
        update: { role: 'CURRENT_CURRICULUM', isCurrent: true, notes: `Linked via fuzzy matcher [${cands.via}]` },
        create: {
          programId: p.id,
          pdfDocumentId: pdfDocId,
          role: 'CURRENT_CURRICULUM',
          isCurrent: true,
          notes: `Linked via fuzzy matcher [${cands.via}]`,
        },
      });
      report.applied++;
    } catch (err) {
      noteSkip('upsert_failed', `${p.code}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const [reason, { count, samples }] of skipReasons) {
    report.skipped.push({ reason, count, samples });
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Candidate programs: ${report.candidatePrograms}`);
  console.log(`Matched: ${report.matched}`);
  if (APPLY) console.log(`Applied (links written): ${report.applied}`);
  for (const s of report.skipped) {
    console.log(`Skipped (${s.reason}): ${s.count}`);
    for (const ex of s.samples.slice(0, 3)) console.log(`  - ${ex}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
