#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Manual program ↔ PDF pairings for the residual cases the auto-linker can't
// confidently match. Each entry is operator-approved; the script applies them
// idempotently with content-hash dedup.
//
// Three operation kinds:
//   • create     — link program to PDF (new ProgramDocument with isCurrent=true)
//   • replace    — unlink program's current CURRENT_CURRICULUM, create new link
//                  (used when the existing auto-match was wrong)
//   • supersede  — flip existing link's isCurrent=false (keep as historical),
//                  create new link with isCurrent=true (used for newer revision)
//
// Usage:
//   pnpm tsx apps/ingestion/src/scripts/link-program-pdf-manual.ts            # dry-run
//   pnpm tsx apps/ingestion/src/scripts/link-program-pdf-manual.ts --apply    # commit
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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

import { prisma } from '@kku/db';
import { S3Storage } from '@kku/shared';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const KKU_PROGRAMS_DIR = '/home/denpong/kku_programs';

interface ManualLink {
  label: string;
  programCode: string;
  pdfRelPath: string;
  operation: 'create' | 'replace' | 'supersede';
  reason: string;
}

const LINKS: ManualLink[] = [
  {
    label: 'A',
    programCode: 'KKU-SEQ-0090',
    pdfRelPath: 'ป.ตรี/คณะสหวิทยาการ/155-นิติศาสตรบัณฑิต-2565-IS.pdf',
    operation: 'create',
    reason: 'Exact faculty/level/discipline (สหวิทยาการ Bachelor Law); -IS suffix = สหวิทยาการ campus',
  },
  {
    label: 'B',
    programCode: 'KKU-SEQ-0182',
    pdfRelPath: 'ป.โท/คณะวิทยาศาสตร์/257 P-1 วิทยาศาสตรมหาบัณฑิต สาขาวิชาสถิติประยุกต์ 2564.pdf',
    operation: 'create',
    reason: 'Column E rename history: "สถิติประยุกต์ เปลียนเป็น สถิติและวิทยาการข้อมูล"',
  },
  {
    label: 'C',
    programCode: 'KKU-SEQ-0286',
    pdfRelPath: 'ป.โท/คณะสัตวแพทยศาสตร์/285-หลักสูตรวิทยาศาสตรมหาบัณฑิต (หลักสูตรนานาชาติ) 2565.pdf',
    operation: 'create',
    reason: 'Column E says "วิทยาศาสตรมหาบัณฑิต หลักสูตรนานาชาติ แยกเป็น 3 กลุ่ม…" (matches PDF)',
  },
  {
    label: 'D',
    programCode: 'KKU-SEQ-0290',
    pdfRelPath: 'ป.เอก/คณะสัตวแพทยศาสตร์/287-หลักสูตรปรัชญาดุษฎีบัณฑิต(คณะสัตวแพทยศาสตร์)2565.pdf',
    operation: 'create',
    reason: 'Doctoral Vet faculty match',
  },
  {
    label: 'E',
    programCode: 'KKU-SEQ-0285',
    pdfRelPath: 'ป.เอก/คณะศึกษาศาสตร์/79-ปร.ด.นวัตกรรมเทคโนโลยีฯ 2565.pdf',
    operation: 'create',
    reason: 'Column E rename: "นวัตกรรม เทคโนโลยี และวิทยาการเรียนรู้" matches PDF discipline',
  },
  {
    label: 'F',
    programCode: 'KKU-SEQ-0129',
    pdfRelPath: 'ป.โท/คณะพยาบาลศาสตร์/เล่มหลักสูตรโทจิตเวชมขส่งสภาการพยาบาล(แก้ไขรอบ2 วันที่10มิ.ย.68).pdf',
    operation: 'create',
    reason: 'Only candidate (informal draft, "โทจิตเวช" = Master Psychiatric Nursing)',
  },
  {
    label: 'G',
    programCode: 'KKU-SEQ-0018',
    pdfRelPath: 'ป.ตรี/คณะบริหารธุรกิจและการบัญชี/หลักสูตรบริหารธุรกิจบันฑิต สาขาวิชาเทคโนโลยีการตลาด-2569.pdf',
    operation: 'replace',
    reason: 'Auto-linker matched wrong PDF; column E says SEQ-0018 was renamed to "เทคโนโลยีการตลาด". Old "ดิจิตอล" link goes to SEQ-0021 (already correct).',
  },
  {
    label: 'I',
    programCode: 'KKU-SEQ-0294',
    pdfRelPath: 'ป.โท/คณะแพทยศาสตร์/หลักสูตรวิทยาศาสตรมหาบัณฑิต สาขาวิชาชีววิท~าสตร์เชิงระบบ (หลักสูตรนานาชาติ)2568 แก้ไข 27ต.ค.68.pdf',
    operation: 'supersede',
    reason: '2568 revision supersedes the existing curriculum (kept as historical via isCurrent=false)',
  },
];

async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const storage = APPLY
    ? new S3Storage({
        endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
        accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minio_dev',
        secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minio_dev_password',
        region: process.env.MINIO_REGION ?? 'us-east-1',
      })
    : null;
  const rawBucket = process.env.MINIO_BUCKET_PDF_RAW ?? 'pdf-raw';

  let applied = 0;
  let failed = 0;

  for (const link of LINKS) {
    const fullPath = path.join(KKU_PROGRAMS_DIR, link.pdfRelPath);
    if (!existsSync(fullPath)) {
      console.error(`  ✗ ${link.label} ${link.programCode}: PDF not found at ${fullPath}`);
      failed++;
      continue;
    }

    const program = await prisma.program.findUnique({
      where: { code: link.programCode },
      select: { id: true, code: true, level: true, faculty: { select: { nameTh: true } } },
    });
    if (!program) {
      console.error(`  ✗ ${link.label} ${link.programCode}: program not found in DB`);
      failed++;
      continue;
    }

    console.log(`\n[${link.label}] ${link.programCode} (${program.level}, ${program.faculty.nameTh})`);
    console.log(`     op=${link.operation}`);
    console.log(`     pdf=${link.pdfRelPath}`);
    console.log(`     reason: ${link.reason}`);

    if (!APPLY) {
      applied++;
      continue;
    }

    try {
      // Compute content hash for dedup
      const bytes = await readFile(fullPath);
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const filename = path.basename(link.pdfRelPath);

      // Upsert PdfDocument by content hash
      const existingPdf = await prisma.pdfDocument.findUnique({
        where: { contentHash },
        select: { id: true },
      });
      let pdfDocId: string;
      if (existingPdf) {
        pdfDocId = existingPdf.id;
        console.log(`     PdfDocument: existing (${pdfDocId})`);
      } else {
        const key = `curriculum/${contentHash}.pdf`;
        await storage!.putObject({
          bucket: rawBucket,
          key,
          body: bytes,
          contentType: 'application/pdf',
          metadata: {
            'original-filename-utf8': encodeURIComponent(filename),
            uploader: 'link-program-pdf-manual',
            'program-id': program.id,
          },
        });
        const created = await prisma.pdfDocument.create({
          data: {
            originalFilename: filename,
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
        console.log(`     PdfDocument: created (${pdfDocId})`);
      }

      // Operation logic
      if (link.operation === 'replace') {
        // Hard-replace the wrong auto-link: delete existing CURRENT_CURRICULUM
        // for this program, then create the right one. The replaced PDF row
        // survives — only the program ↔ pdf relationship is updated.
        const deleted = await prisma.programDocument.deleteMany({
          where: { programId: program.id, role: 'CURRENT_CURRICULUM', isCurrent: true },
        });
        console.log(`     Removed ${deleted.count} wrong-attribution link(s)`);
      } else if (link.operation === 'supersede') {
        // Mark all existing CURRENT_CURRICULUM links as isCurrent=false
        // (kept as historical reference). Then create the new one.
        const updated = await prisma.programDocument.updateMany({
          where: { programId: program.id, role: 'CURRENT_CURRICULUM', isCurrent: true },
          data: { isCurrent: false },
        });
        console.log(`     Superseded ${updated.count} prior curriculum(s) (now historical)`);
      }
      // 'create' = no pre-step

      // Upsert the new ProgramDocument
      await prisma.programDocument.upsert({
        where: { programId_pdfDocumentId: { programId: program.id, pdfDocumentId: pdfDocId } },
        update: {
          role: 'CURRENT_CURRICULUM',
          isCurrent: true,
          notes: `Manually linked [${link.label}]: ${link.reason}`,
        },
        create: {
          programId: program.id,
          pdfDocumentId: pdfDocId,
          role: 'CURRENT_CURRICULUM',
          isCurrent: true,
          notes: `Manually linked [${link.label}]: ${link.reason}`,
        },
      });
      applied++;
      console.log(`     ✓ Applied`);
    } catch (err) {
      failed++;
      console.error(`     ✗ Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`${APPLY ? 'Applied' : 'Would apply'}: ${applied} / ${LINKS.length}`);
  if (failed > 0) console.log(`Failed: ${failed}`);

  if (APPLY) {
    const linkCount = await prisma.programDocument.count({ where: { role: 'CURRENT_CURRICULUM', isCurrent: true } });
    const programCount = await prisma.program.count();
    const programsWithoutPdf = await prisma.program.count({
      where: { documents: { none: { role: 'CURRENT_CURRICULUM', isCurrent: true } } },
    });
    console.log(`\nFinal: ${linkCount} CURRENT_CURRICULUM links across ${programCount} programs`);
    console.log(`Programs without curriculum PDF: ${programsWithoutPdf}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
