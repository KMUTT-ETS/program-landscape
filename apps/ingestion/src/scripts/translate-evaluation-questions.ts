#!/usr/bin/env tsx
// ────────────────────────────────────────────────────────────────────────
// Translate the EvaluationQuestion catalog from Thai → English.
//
// One-shot operator command. Run AFTER the kku-evaluations connector has
// populated the question catalog from POWERBI.EVALUATE_INSTRUCTOR.
//
// Usage:
//   pnpm evaluations:translate-questions          # translate all rows
//                                                 # where questionTextEn IS NULL
//                                                 # AND questionTextEnOverride IS NULL
//   pnpm evaluations:translate-questions --force  # re-translate everything
//                                                 # (preserves DEAN overrides)
//
// Cost: single Gemini call for the whole catalog (~40 questions × ~30
// Thai tokens each ≈ 3K-5K total tokens). Pennies per run. Tracked as
// one AiInference row with prompt-version=evaluation-question-translate.v1.
// ────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import { prisma } from '@kku/db';
import {
  buildEvaluationQuestionTranslateMessages,
  EVALUATION_QUESTION_TRANSLATE_VERSION,
  EvaluationQuestionTranslateSchema,
} from '@kku/shared';
import { createIngestionAiService } from '../lib/ai-service';

async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  const where = force
    ? { questionTextEnOverride: null }
    : { questionTextEn: null, questionTextEnOverride: null };

  const rows = await prisma.evaluationQuestion.findMany({
    where,
    select: {
      id: true,
      questionIdRegistrar: true,
      questionTextTh: true,
      themeTag: true,
    },
    orderBy: [{ questionIdRegistrar: 'asc' }, { createdAt: 'asc' }],
  });

  console.log(`Found ${rows.length} questions to translate.`);
  if (rows.length === 0) {
    console.log('Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  const ai = createIngestionAiService();

  const messages = buildEvaluationQuestionTranslateMessages({
    questions: rows.map((r) => ({
      questionIdRegistrar: r.questionIdRegistrar,
      questionTextTh: r.questionTextTh,
      themeTag: r.themeTag,
    })),
  });

  console.log(`Calling AI (${ai.providerId}) — ${EVALUATION_QUESTION_TRANSLATE_VERSION}…`);
  const response = await ai.extractStructured(
    {
      ctx: {
        module: 'kku-evaluations',
        kind: 'translate-questions',
      },
      messages,
      methodVersion: EVALUATION_QUESTION_TRANSLATE_VERSION,
      maxOutputTokens: 8000,
    },
    EvaluationQuestionTranslateSchema,
  );
  console.log(`  → cost ~$${response.cost.usd.toFixed(4)}  tokens=${response.tokens.input}+${response.tokens.output}`);

  const payload = response.parsed;
  console.log(`Received ${payload.translations.length} translations  confidence=${payload.confidence}`);
  if (payload.caveats.length > 0) {
    console.log(`Caveats:`);
    for (const c of payload.caveats) console.log(`  - ${c}`);
  }

  // Build a lookup map and update each row. We update by id rather than by
  // questionIdRegistrar alone because drift-versioned rows share QID.
  const byQid = new Map<string, string>();
  for (const t of payload.translations) {
    byQid.set(t.questionIdRegistrar, t.questionTextEn);
  }

  const model = process.env.AI_PROVIDER ?? 'google';
  const now = new Date();
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const en = byQid.get(row.questionIdRegistrar);
    if (!en) {
      skipped++;
      continue;
    }
    await prisma.evaluationQuestion.update({
      where: { id: row.id },
      data: {
        questionTextEn: en,
        translatedAt: now,
        translationModel: model,
      },
    });
    updated++;
  }

  console.log(`Updated ${updated} rows  skipped ${skipped} (no translation returned).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
