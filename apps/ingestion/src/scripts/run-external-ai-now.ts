// One-shot CLI: flip an ExternalAiSource to ACTIVE (if not already)
// and run it through the shared runner. Reports per-item results.
//
// Usage: pnpm tsx apps/ingestion/src/scripts/run-external-ai-now.ts <slug>

import 'dotenv/config';
import { prisma, runExternalAiSource } from '@kku/db';
import {
  createAiService,
  type AiProviderId,
} from '@kku/shared';
import { PrismaAiInferenceRecorder, getAiModelOverrideStore } from '@kku/db';
import { BrowserService } from '../external-ai/browser';

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: tsx run-external-ai-now.ts <slug>');
    process.exit(1);
  }

  const source = await prisma.externalAiSource.findUnique({ where: { slug } });
  if (!source) {
    console.error(`No source found with slug: ${slug}`);
    process.exit(1);
  }

  console.log(`▶ ${source.name} (${source.slug}) — currently ${source.status}`);
  if (source.status !== 'ACTIVE') {
    await prisma.externalAiSource.update({
      where: { id: source.id },
      data: { status: 'ACTIVE' },
    });
    console.log(`  → flipped to ACTIVE`);
  }

  const recorder = new PrismaAiInferenceRecorder();
  const providerId = (process.env.AI_PROVIDER ?? 'google') as AiProviderId;
  const ai = createAiService({
    recorder,
    providerId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
    modelOverrideResolver: getAiModelOverrideStore(),
  });

  const logger = {
    warn: (msg: string) => console.log(`  ⚠ ${msg}`),
    error: (msg: string) => console.log(`  ✖ ${msg}`),
  };

  // Lazy Playwright — only spins up when the source needs it.
  const browser = new BrowserService();
  const headlessFetch = source.fetchStrategy === 'HEADLESS'
    ? (url: string) => browser.fetchHtml(url)
    : undefined;
  if (headlessFetch) console.log(`  (using headless browser)`);

  const startedAt = Date.now();
  console.log(`  fetching + summarising…`);
  try {
    const result = await runExternalAiSource({
      sourceId: source.id,
      ai,
      googleCseApiKey: process.env.GOOGLE_CSE_API_KEY,
      googleCseCx: process.env.GOOGLE_CSE_CX,
      headlessFetch,
      logger,
    });
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\n  done in ${elapsed}s`);
    console.log(`    fetched:    ${result.fetched}`);
    console.log(`    summarised: ${result.summarised}`);
    console.log(`    skipped:    ${result.skipped}`);
    console.log(`    failures:   ${result.failures}`);
    if (result.signals.length > 0) {
      console.log(`\n  signals written:`);
      for (const s of result.signals) {
        console.log(`    • [${s.impactScore.toFixed(2)}] ${s.title}`);
      }
    }
  } catch (err) {
    console.error(`\n  ✖ run failed: ${(err as Error).message}`);
    process.exit(1);
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
