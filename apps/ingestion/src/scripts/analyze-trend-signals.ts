import { prisma, PrismaAiInferenceRecorder, getAiModelOverrideStore } from '@kku/db';
import { createAiService, type AiProviderId } from '@kku/shared';
import { analyzeTrendSignal } from '../trend-signals/analyze';

// Per-signal AI analysis runner.
//   pnpm trends:analyze <signalId>          # one signal
//   pnpm trends:analyze --all [--limit=N]   # every signal (idempotent)
//   pnpm trends:analyze --all --only-empty  # only signals not yet analysed

async function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes('--all');
  const onlyEmpty = argv.includes('--only-empty');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1] ?? '0', 10) : null;
  const positional = argv.find((a) => !a.startsWith('--')) ?? null;

  if (!all && !positional) {
    console.error('Usage: pnpm trends:analyze <signalId> | --all [--limit=N] [--only-empty]');
    process.exit(1);
  }

  const recorder = new PrismaAiInferenceRecorder();
  const ai = createAiService({
    recorder,
    providerId: (process.env.AI_PROVIDER ?? 'google') as AiProviderId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
    modelOverrideResolver: getAiModelOverrideStore(),
  });

  let ids: string[];
  if (positional) {
    ids = [positional];
  } else {
    const rows = await prisma.trendSignal.findMany({
      where: onlyEmpty ? { aiInferenceId: null } : undefined,
      select: { id: true },
      orderBy: { detectedDate: 'desc' },
      ...(limit ? { take: limit } : {}),
    });
    ids = rows.map((r) => r.id);
  }

  console.log(`Analysing ${ids.length} trend signal(s)…`);
  let ok = 0;
  let failed = 0;
  let cost = 0;
  for (const id of ids) {
    const r = await analyzeTrendSignal({ signalId: id, ai });
    if (r.status === 'SUCCEEDED') {
      ok++;
      cost += r.costUsd;
      console.log(`  ✓ ${id} — ${r.affectedPrograms} programs · ${r.affectedSkills} skills · ${r.recommendedActions} actions (conf ${r.confidence}, $${r.costUsd.toFixed(4)})`);
    } else {
      failed++;
      console.log(`  ✗ ${id} — ${r.status}: ${'reason' in r ? r.reason : ''}`);
    }
  }
  console.log(`\nDone. ${ok} succeeded, ${failed} failed. Total AI cost: $${cost.toFixed(3)}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
