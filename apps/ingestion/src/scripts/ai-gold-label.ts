// ─────────────────────────────────────────────────────────────────────────────
// ai:gold-label — analyst-friendly CLI for filling AiExtraction.gold_label.
//
// Closes the labelling-UX half of evaluation-pipeline.md §13 gap #3 so the
// analyst doesn't need raw psql. Reads/writes via the Prisma client so the
// DATABASE_URL `?schema=public` quirk doesn't surface.
//
// Workflow:
//   1. pnpm ai:gold-pick --apply           # mark candidates
//   2. pnpm ai:gold-label --list           # list pending candidates
//   3. pnpm ai:gold-label <id>             # export AI payload to a JSON file
//                                          # → edit the file in your editor
//   4. pnpm ai:gold-label <id> --commit    # write the file as the gold label
//   5. pnpm ai:eval-accuracy               # measure precision/recall/F1
//
// The export step writes to ./gold-labels/<extractionId>.json (created if
// absent). Edit the file with whatever editor you prefer — the script
// reads it back on --commit.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadOrganization, Prisma, prisma } from '@kku/db';

interface CliArgs {
  list: boolean;
  commit: boolean;
  extractionId: string | null;
  limit: number;
  outDir: string;
  who: string | null;
  kindFilter: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    list: false,
    commit: false,
    extractionId: null,
    limit: 20,
    outDir: 'gold-labels',
    who: process.env.GOLD_LABELLER ?? null,
    kindFilter: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--commit') args.commit = true;
    else if (a === '--limit') args.limit = Number(argv[++i] ?? args.limit);
    else if (a === '--out') args.outDir = String(argv[++i] ?? args.outDir);
    else if (a === '--by') args.who = String(argv[++i] ?? '');
    else if (a === '--kind') args.kindFilter = String(argv[++i] ?? '');
    else if (a && !a.startsWith('--')) args.extractionId = a;
  }
  return args;
}

async function listPending(limit: number, kindFilter: string | null): Promise<void> {
  const rows = await prisma.aiExtraction.findMany({
    where: {
      isGoldSample: true,
      goldLabel: { equals: Prisma.DbNull },
      ...(kindFilter ? { extractionKind: kindFilter } : {}),
    },
    select: {
      id: true,
      extractionKind: true,
      methodVersion: true,
      sourceEntityType: true,
      sourceEntityId: true,
      confidence: true,
      reviewStatus: true,
    },
    orderBy: [{ extractionKind: 'asc' }, { confidence: 'asc' }],
    take: limit,
  });

  if (rows.length === 0) {
    const labelled = await prisma.aiExtraction.count({
      where: { isGoldSample: true, goldLabel: { not: Prisma.DbNull } },
    });
    const candidates = await prisma.aiExtraction.count({ where: { isGoldSample: true } });
    if (candidates === 0) {
      console.log('No gold candidates yet. Run `pnpm ai:gold-pick --apply` first.');
    } else {
      console.log(`All ${candidates} candidates already labelled (${labelled} with gold_label set).`);
      console.log('Next step: `pnpm ai:eval-accuracy`');
    }
    return;
  }

  console.log(`Pending gold-label candidates (showing ${rows.length}):\n`);
  console.log('extraction_id'.padEnd(28) + 'kind'.padEnd(28) + 'method'.padEnd(28) + 'conf'.padStart(6) + '  source');
  console.log('─'.repeat(110));
  for (const r of rows) {
    console.log(
      r.id.padEnd(28) +
        r.extractionKind.padEnd(28) +
        r.methodVersion.padEnd(28) +
        r.confidence.toFixed(2).padStart(6) +
        `  ${r.sourceEntityType}:${r.sourceEntityId.slice(0, 32)}`,
    );
  }
  console.log('\nTo label one:');
  console.log('  pnpm ai:gold-label <extraction_id>            # export AI payload to a JSON file');
  console.log('  $EDITOR gold-labels/<extraction_id>.json      # edit the file');
  console.log('  pnpm ai:gold-label <extraction_id> --commit   # write the file as gold_label');
}

async function exportPayload(extractionId: string, outDir: string): Promise<void> {
  const row = await prisma.aiExtraction.findUnique({
    where: { id: extractionId },
    select: {
      id: true,
      extractionKind: true,
      methodVersion: true,
      sourceEntityType: true,
      sourceEntityId: true,
      confidence: true,
      payloadJson: true,
      isGoldSample: true,
      goldLabel: true,
    },
  });
  if (!row) {
    throw new Error(`No AiExtraction with id=${extractionId}`);
  }
  if (!row.isGoldSample) {
    console.warn(`⚠ AiExtraction ${extractionId} is not a gold candidate. ` +
      `Run \`pnpm ai:gold-pick --apply\` or set is_gold_sample=true manually first.`);
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${extractionId}.json`);

  const seedContent = row.goldLabel ?? row.payloadJson;
  const wrapper = {
    _meta: {
      extractionId: row.id,
      extractionKind: row.extractionKind,
      methodVersion: row.methodVersion,
      sourceEntityType: row.sourceEntityType,
      sourceEntityId: row.sourceEntityId,
      aiConfidence: row.confidence,
      aiPayload_DO_NOT_EDIT: row.payloadJson,
      instructions:
        'Edit the `goldLabel` field below to the correct payload shape ' +
        '(mirror the structure of payloadJson, but with the right values). ' +
        'Then run `pnpm ai:gold-label <id> --commit` to persist it. ' +
        'The `_meta` block is informational only — only `goldLabel` is written to the DB.',
    },
    goldLabel: seedContent,
  };
  writeFileSync(filePath, JSON.stringify(wrapper, null, 2));
  console.log(`Exported to: ${filePath}`);
  console.log(`Kind:        ${row.extractionKind} (${row.methodVersion})`);
  console.log(`Source:      ${row.sourceEntityType}:${row.sourceEntityId}`);
  console.log(`AI confidence: ${row.confidence.toFixed(2)}`);
  console.log('');
  console.log('Edit the file (the `goldLabel` field), then commit:');
  console.log(`  pnpm ai:gold-label ${extractionId} --commit`);
}

async function commitLabel(extractionId: string, outDir: string, who: string | null): Promise<void> {
  const filePath = path.join(outDir, `${extractionId}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}. Export it first with \`pnpm ai:gold-label ${extractionId}\`.`);
  }
  const raw = readFileSync(filePath, 'utf8');
  let parsed: { _meta?: unknown; goldLabel?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!('goldLabel' in parsed)) {
    throw new Error(`File ${filePath} has no \`goldLabel\` key. Re-export with \`pnpm ai:gold-label ${extractionId}\`.`);
  }
  const label = parsed.goldLabel;
  if (label === undefined) {
    throw new Error(`\`goldLabel\` in ${filePath} is undefined. Provide a value (object or array).`);
  }

  // Resolve the labeller — argv > env > skip.
  let labellerId: string | null = null;
  if (who) {
    const user = await prisma.user.findFirst({
      where: { OR: [{ id: who }, { email: who }] },
      select: { id: true, email: true },
    });
    if (!user) {
      console.warn(`⚠ --by ${who} did not match any User id/email. Storing label without labeller attribution.`);
    } else {
      labellerId = user.id;
    }
  }

  const updated = await prisma.aiExtraction.update({
    where: { id: extractionId },
    data: {
      goldLabel: label === null ? Prisma.JsonNull : (label as Prisma.InputJsonValue),
      goldLabelledAt: new Date(),
      goldLabelledByUserId: labellerId,
    },
    select: { extractionKind: true, methodVersion: true },
  });
  console.log(`✓ gold_label written for ${extractionId}`);
  console.log(`  kind=${updated.extractionKind} method=${updated.methodVersion}`);
  if (labellerId) console.log(`  labelled_by=${labellerId}`);
  console.log('\nNext: label more candidates, then `pnpm ai:eval-accuracy`.');
}

async function main(): Promise<void> {
  await loadOrganization();
  const args = parseArgs(process.argv.slice(2));

  try {
    if (args.list || (!args.extractionId && !args.commit)) {
      await listPending(args.limit, args.kindFilter);
      return;
    }
    if (!args.extractionId) {
      console.error('Usage: pnpm ai:gold-label [<extractionId>] [--commit] [--list] [--by <userId|email>]');
      process.exit(1);
    }
    if (args.commit) {
      await commitLabel(args.extractionId, args.outDir, args.who);
    } else {
      await exportPayload(args.extractionId, args.outDir);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
