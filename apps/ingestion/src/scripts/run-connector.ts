#!/usr/bin/env tsx
// ────────────────────────────────────────────────────────────────────────────
// Run a single connector synchronously, bypassing BullMQ.
//
// Usage:
//   pnpm connector:run kku-registry
//   pnpm connector:run kku-registry --trigger BACKFILL
//
// Calls ConnectorRunner.run() directly — useful for the "3 green runs"
// gate of prompt-14 sessions and for iterating on a real connector
// without spinning up the worker. The registry resolves real-vs-mock
// from env at boot, so flip CONNECTOR_<SLUG>_MODE=real before invoking.
//
// Exits non-zero on failure so it slots into shell scripts cleanly.
// ────────────────────────────────────────────────────────────────────────────

import { loadOrganization } from '@kku/db';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Load .env from cwd before anything reads process.env.
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
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

import type { IngestionRunTrigger } from '@kku/shared';
import { buildRegistry } from '../connectors/registry';
import { ConnectorRunner } from '../connectors/runner';

const HELP = `
Usage: pnpm connector:run <slug> [--trigger SCHEDULED|MANUAL|BACKFILL]

Bypasses BullMQ and runs the connector synchronously through
ConnectorRunner — same path the worker uses, just direct.

Slug must match a SOURCE_CATALOG entry. The registry resolves
real-vs-mock from CONNECTOR_<SLUG>_MODE / CONNECTOR_MODE env.

Exit codes: 0 success, 2 failed run, 3 invocation error.
`.trim();

async function main(): Promise<number> {
  await loadOrganization();
  const slug = process.argv[2];
  if (!slug || slug.startsWith('-')) {
    console.error(HELP);
    return 3;
  }

  const triggerIdx = process.argv.indexOf('--trigger');
  const trigger: IngestionRunTrigger =
    triggerIdx >= 0
      ? (process.argv[triggerIdx + 1] as IngestionRunTrigger)
      : 'MANUAL';

  const registry = buildRegistry();
  const runner = new ConnectorRunner(registry);

  console.log(`[connector:run] running "${slug}" (trigger=${trigger})…`);
  const t0 = Date.now();
  const outcome = await runner.run({ dataSourceSlug: slug, trigger });
  const ms = Date.now() - t0;

  console.log(`[connector:run] outcome=${outcome.status}  duration=${ms}ms`);
  console.log(`[connector:run] runId=${outcome.runId}`);
  console.log(`[connector:run] recordsLoaded=${outcome.recordsLoaded} recordsFailed=${outcome.recordsFailed}`);
  return outcome.status === 'SUCCEEDED' ? 0 : 2;
}

void main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('[connector:run] uncaught:', err);
    process.exit(2);
  });
