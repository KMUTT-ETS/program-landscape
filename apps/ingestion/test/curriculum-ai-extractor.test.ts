import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { PdfContext, AiService } from '@kku/shared';
import { createAiService } from '@kku/shared';
import { CurriculumAiExtractor } from '../src/pdf-intake/extractors/curriculum-ai-extractor';

// Smoke test against live Gemini (skipped unless GOOGLE_AI_API_KEY is set
// AND the sample PDF exists). We keep this in the test directory so it
// uses the same tsconfig (CommonJS) + monorepo alias resolution as the
// production worker.

// Minimal .env loader so vitest picks up GOOGLE_AI_API_KEY when invoked
// from the workspace root without a dotenv dep in the test-only scope.
(() => {
  const envPath = '/home/denpong/projects/program-landscape/.env';
  if (!existsSync(envPath)) return;
  const src = readFileSync(envPath, 'utf8');
  for (const line of src.split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
})();

const SAMPLES = [
  {
    label: 'Bachelor (วท.บ. เกษตรศาสตร์)',
    path: '/home/denpong/vibe_coding_temp/1 วท.บ.เกษตรศาสตร์ 2565.pdf',
    expectLevel: 'BACHELOR',
  },
  {
    label: 'Master (วท.ม. สัตวศาสตร์)',
    path: '/home/denpong/vibe_coding_temp/7 P-1 หลักสูตรวิทยาศาสตรมหาบัณฑิต สาขาวิชาสัตวศาสตร์ 2565.pdf',
    expectLevel: 'MASTER',
  },
  {
    label: 'Doctoral (ปร.ด. สัตวศาสตร์)',
    path: '/home/denpong/vibe_coding_temp/16 P-2 หลักสูตรปรัชญาดุษฎีบัณฑิต สาขาวิชาสัตวศาสตร์ 2565.pdf',
    expectLevel: 'DOCTORAL',
  },
] as const;

const samplesReady =
  !!process.env.GOOGLE_AI_API_KEY && SAMPLES.every((s) => existsSync(s.path));

const runTest = samplesReady ? it : it.skip;

async function readFull(
  pdfPath: string,
  limitPages = 14,
): Promise<{ fullText: string; pages: PdfContext['pages']; pageCount: number }> {
  // Load pdfjs-dist via createRequire so the test doesn't care about ESM
  // wrapper resolution quirks.
  const req = createRequire(import.meta.url);
  const pdfjsPath = req.resolve(
    'pdfjs-dist/legacy/build/pdf.mjs',
    { paths: ['/home/denpong/projects/program-landscape'] },
  );
  const workerPath = req.resolve(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    { paths: ['/home/denpong/projects/program-landscape'] },
  );
  const pdfjs = await import(pdfjsPath);
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = workerPath;

  const buf = readFileSync(pdfPath);
  const doc = await (pdfjs as {
    getDocument: (a: { data: Uint8Array }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }>; destroy: () => Promise<void> }> };
  }).getDocument({ data: new Uint8Array(buf) }).promise;
  const limit = Math.min(doc.numPages, limitPages);
  let fullText = '';
  const pages: PdfContext['pages'] = [];
  for (let i = 1; i <= limit; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map((it) => ('str' in it ? it.str ?? '' : '')).join(' ');
    fullText += text + '\n';
    pages.push({ pageNumber: i, textContent: text, hasImages: false, hasTables: false });
  }
  await doc.destroy();
  return { fullText, pages, pageCount: doc.numPages };
}

function makeAi(): AiService {
  const recorder = {
    async record(_input: unknown): Promise<{ id: string }> {
      return { id: 'test-' + Math.random().toString(36).slice(2) };
    },
  };
  return createAiService({
    recorder,
    providerId: 'google',
    apiKeys: { google: process.env.GOOGLE_AI_API_KEY },
  });
}

describe('CurriculumAiExtractor (Gemini live)', () => {
  for (const sample of SAMPLES) {
    runTest(
      `${sample.label} — ≥90% of core fields`,
      async () => {
        const ai = makeAi();
        const { fullText, pages, pageCount } = await readFull(sample.path);
        const extractor = new CurriculumAiExtractor();
        const ctx: PdfContext = {
          pdfDocumentId: 'test',
          originalFilename: sample.path.split('/').pop() ?? '',
          pageCount,
          fullText,
          pages,
          language: 'TH',
          ai,
        };
        const records = await extractor.extract(ctx);
        expect(records.length).toBe(1);
        const rec = records[0];

        const p = rec.payload as Record<string, unknown>;
        // Print for eyeball inspection BEFORE any assertion so failures
        // still leave a trace.
        // eslint-disable-next-line no-console
        console.log(
          `\n${sample.label} → confidence ${rec.confidence.toFixed(2)}\n` +
            `reasoning: ${rec.reasoning}\n` +
            JSON.stringify(p, null, 2),
        );

        // Confidence is nondeterministic across Gemini runs; set a floor
        // that catches silent fallback-to-heuristic (<0.5) without
        // flaking on a run that missed 3-4 fields.
        expect(rec.confidence).toBeGreaterThanOrEqual(0.5);
        expect(p.level).toBe(sample.expectLevel);
        expect(typeof p.programNameTh).toBe('string');
        expect((p.programNameTh as string).length).toBeGreaterThan(5);
        expect(p.curriculumYear).toBe(2565);
        // Thai name should contain proper tone marks (at least one
        // character in the U+0E47..U+0E4E range) — this is what the
        // heuristic extractor can't produce on sample-1-like fonts.
        const th = `${p.programNameTh ?? ''}${p.degreeNameTh ?? ''}${p.facultyNameTh ?? ''}`;
        expect(/[็-๎]/.test(th)).toBe(true);
      },
      90_000,
    );
  }
});
