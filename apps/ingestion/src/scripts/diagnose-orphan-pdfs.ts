#!/usr/bin/env tsx
// READ-ONLY diagnostic. Walks /home/denpong/kku_programs and the DB,
// reports for each no-PDF program: best-effort fuzzy match against
// orphaned (un-linked) PDFs. Estimates recoverable count without
// touching any data.
//
// Three relaxed matchers, in priority order:
//   1. Strip "เปลี่ยนเป็น xxx" from sheet majorName + try substring
//   2. Strip "(...)" + "หลักสูตรนานาชาติ" + "หลักสูตรใหม่ พ.ศ. xxx" from sheet majorName
//   3. Reverse: short tokens of the sheet majorName found in filename
//
// Usage:  pnpm tsx apps/ingestion/src/scripts/diagnose-orphan-pdfs.ts

import { existsSync, readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
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

import { loadOrganization, prisma } from '@kku/db';

const KKU_PROGRAMS_DIR = '/home/denpong/kku_programs';
const LEVEL_DIR_TO_ENUM: Record<string, string> = {
  'ป.ตรี': 'BACHELOR',
  'ป.โท': 'MASTER',
  'ป.เอก': 'DOCTORAL',
  'ป.บัณฑิตชั้นสูง': 'HIGHER_GRAD_DIPLOMA',
};

interface DiskPdf {
  level: string;       // BACHELOR / MASTER / ...
  facultyDir: string;  // คณะแพทยศาสตร์
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

// ── Matchers ────────────────────────────────────────────────────────────────

function stripDecorations(major: string): string {
  return major
    // Strip "เปลี่ยนเป็น xxx" rename note (keep only the old name)
    .replace(/\s*เปลี่ยนเป็น.*$/, '')
    // Strip "(...)" decorations
    .replace(/\([^)]*\)/g, '')
    // Strip "หลักสูตรนานาชาติ" suffix
    .replace(/\s*หลักสูตร(นานาชาติ|ใหม่.*)\s*$/g, '')
    .trim();
}

function findCandidates(majorName: string, orphans: DiskPdf[], facultyDir: string, level: string): DiskPdf[] {
  if (!majorName) return [];

  const cleaned = stripDecorations(majorName);
  const matches: { pdf: DiskPdf; score: number; via: string }[] = [];

  for (const pdf of orphans) {
    if (pdf.level !== level || pdf.facultyDir !== facultyDir) continue;

    // Strategy 1: cleaned-major substring on filename
    if (cleaned.length >= 8 && pdf.filename.includes(cleaned)) {
      matches.push({ pdf, score: cleaned.length * 10, via: 'cleaned-substring' });
      continue;
    }

    // Strategy 2: original-major substring (for completeness)
    if (majorName.length >= 8 && pdf.filename.includes(majorName)) {
      matches.push({ pdf, score: majorName.length * 10, via: 'original-substring' });
      continue;
    }

    // Strategy 3: reverse — pull the longest Thai word from filename and
    // check if it's in the cleaned major name.
    const fileTokens = pdf.filename.split(/[\s\-_.()0-9]+/).filter((t) => t.length >= 6);
    for (const tok of fileTokens) {
      if (cleaned.includes(tok)) {
        matches.push({ pdf, score: tok.length, via: `token:${tok}` });
        break;
      }
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 3).map((m) => m.pdf);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await loadOrganization();
  const allDiskPdfs = await walkDisk();
  console.log(`PDFs on disk: ${allDiskPdfs.length}`);

  // Mark which are already linked (by content hash → in DB → linked)
  const linkedRows = await prisma.programDocument.findMany({
    where: { role: 'CURRENT_CURRICULUM', isCurrent: true },
    select: {
      pdfDocument: { select: { originalFilename: true, contentHash: true } },
    },
  });
  const linkedFilenames = new Set(linkedRows.map((r) => r.pdfDocument.originalFilename));
  const orphanPdfs = allDiskPdfs.filter((p) => !linkedFilenames.has(p.filename));
  console.log(`Linked PDFs (by filename): ${allDiskPdfs.length - orphanPdfs.length}`);
  console.log(`Orphan PDFs on disk: ${orphanPdfs.length}`);

  // Programs with no PDF link
  const programsNoPdf = await prisma.program.findMany({
    where: { documents: { none: { role: 'CURRENT_CURRICULUM', isCurrent: true } } },
    select: { id: true, code: true, level: true, majors: true, faculty: { select: { nameTh: true } } },
    orderBy: [{ level: 'asc' }, { code: 'asc' }],
  });
  console.log(`Programs without PDF: ${programsNoPdf.length}`);

  let recoverableCount = 0;
  const samples: Array<{ code: string; major: string; faculty: string; cand: string; via: string }> = [];

  for (const p of programsNoPdf) {
    const major = p.majors[0] ?? '';
    const cands = findCandidates(major, orphanPdfs, p.faculty.nameTh, p.level);
    if (cands.length > 0) {
      recoverableCount++;
      if (samples.length < 25) {
        const cleaned = stripDecorations(major);
        samples.push({
          code: p.code,
          major: major.length > 50 ? major.slice(0, 50) + '…' : major,
          faculty: p.faculty.nameTh,
          cand: cands[0]!.filename,
          via: cleaned !== major ? 'after-strip' : 'reverse-token',
        });
      }
    }
  }

  console.log(`\nRecoverable via fuzzy matcher: ${recoverableCount} of ${programsNoPdf.length} (${(100 * recoverableCount / programsNoPdf.length).toFixed(0)}%)`);
  console.log(`Genuinely missing PDFs (no candidate found): ${programsNoPdf.length - recoverableCount}`);

  console.log(`\nFirst 25 recoverable matches:`);
  for (const s of samples) {
    console.log(`  ${s.code} ${s.faculty}`);
    console.log(`    major: ${s.major}`);
    console.log(`    PDF:   ${s.cand}  [${s.via}]`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
