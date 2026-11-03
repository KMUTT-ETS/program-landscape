// ────────────────────────────────────────────────────────────────────
// Shared PDF prep — used by `programs-pipeline` to fetch + extract the
// curriculum PDF ONCE per program, then thread the result to every
// phase-1 extractor (digest, faculty, skills, pedagogy) + phase 2b
// (courses-extract) instead of having each one re-fetch from MinIO and
// re-run pdfjs.
//
// Behavioural change vs. the per-extractor code path: identical. Each
// run*() function accepts an optional `pdfPrep` param; when supplied it
// skips the fetch + extract, otherwise it falls back to its previous
// behaviour (so calling a single extractor standalone still works).
//
// Wins per program:
//   - MinIO download:   5× → 1× (PDF bytes ~5-50MB each)
//   - extractNativeText: 5× → 1× (~2-15s + CPU)
//   - peak memory:      5× → 1× copy of bytes + extracted text
// ────────────────────────────────────────────────────────────────────

import { prisma } from '@kku/db';
import type { S3Storage } from '@kku/shared';
import {
  extractNativeText,
  type NativeExtractionResult,
} from '../pdf-intake/pipeline/native-text-extractor';

export type ProgramPdfPrep = NativeExtractionResult;

export type LoadProgramPdfPrepOutcome =
  | { status: 'SUCCEEDED'; prep: ProgramPdfPrep; pdfDocumentId: string }
  | { status: 'NO_TEXT'; reason: string }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

/** Below this many characters a curriculum PDF cannot hold a course list. */
export const MIN_CURRICULUM_TEXT_CHARS = 2000;

export const NO_TEXT_REASON =
  'The curriculum PDF has no extractable text (scanned or image-only). OCR is not supported; upload a text PDF or load the course list spreadsheet.';

/** The reason a prepared PDF is unusable, or null when it has readable text. */
export function pdfNoTextReason(prep: ProgramPdfPrep): string | null {
  if (prep.isLikelyScanned || prep.fullText.trim().length < MIN_CURRICULUM_TEXT_CHARS) {
    return NO_TEXT_REASON;
  }
  return null;
}

export async function loadProgramPdfPrep(args: {
  programId: string;
  storage: S3Storage;
}): Promise<LoadProgramPdfPrepOutcome> {
  const program = await prisma.program.findUnique({
    where: { id: args.programId },
    include: {
      documents: {
        where: { role: 'CURRENT_CURRICULUM', isCurrent: true },
        include: { pdfDocument: { select: { id: true, storageUrl: true } } },
        take: 1,
      },
    },
  });
  if (!program) return { status: 'SKIPPED', reason: `program not found: ${args.programId}` };
  const doc = program.documents[0];
  if (!doc) return { status: 'SKIPPED', reason: 'no CURRENT_CURRICULUM PDF linked' };

  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(doc.pdfDocument.storageUrl);
  if (!m) return { status: 'FAILED', reason: `unrecognised storageUrl: ${doc.pdfDocument.storageUrl}` };
  const url = await args.storage.getSignedDownloadUrl({
    bucket: m[1]!,
    key: m[2]!,
    ttlSeconds: 300,
  });
  const res = await fetch(url);
  if (!res.ok) return { status: 'FAILED', reason: `PDF fetch ${res.status}` };
  const bytes = Buffer.from(await res.arrayBuffer());

  const prep = await extractNativeText(bytes);
  const noText = pdfNoTextReason(prep);
  if (noText) return { status: 'NO_TEXT', reason: noText };
  return { status: 'SUCCEEDED', prep, pdfDocumentId: doc.pdfDocument.id };
}
