#!/usr/bin/env tsx
// ────────────────────────────────────────────────────────────────────────────
// Check that a dataset API connector's data reaches the app.
//
// Usage:
//   pnpm connector:verify api-myuni-classes
//   pnpm connector:verify api-myuni-classes --json
//
// Read-only: never writes to the database, never runs the connector, never
// calls the upstream API. Prints env var names and row counts only — never
// env values or row values.
//
// Exit codes: 0 nothing failed, 1 at least one check failed, 3 invocation
// error (no slug, database unreachable).
// ────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { SOURCE_CATALOG, type SourceCatalogEntry } from '@kku/shared';

import type { ConnectorEntry } from '../../connectors/registry';
import { INSTITUTION_CONNECTORS } from '../../connectors/sources/institution';
import { runChecks } from './checks';
import { exitCodeFor, formatReport } from './format';
import type { VerifyReader } from './types';

const HELP = `
Usage: pnpm connector:verify <slug> [--json]

Checks that a dataset API connector is registered, configured, has run,
and that its rows are stamped, visible to the app and linked to
programmes. Read-only.

Exit codes: 0 nothing failed, 1 a check failed, 3 invocation error.
`.trim();

export interface VerifyIo {
  out(s: string): void;
  err(s: string): void;
}

export interface VerifyMainDeps {
  reader: VerifyReader;
  entries: readonly ConnectorEntry[];
  catalog: readonly SourceCatalogEntry[];
}

/** Same loader as run-connector.ts: fills unset keys from cwd's env file. */
function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
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

function isDbUnreachable(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === 'PrismaClientInitializationError' || /P1001|P1000|reach database/i.test(e.message))
  );
}

/**
 * The real reader, connected on first use: an unregistered slug is reported
 * without touching the database at all.
 */
function lazyDefaultReader(): VerifyReader {
  let ready: Promise<VerifyReader> | null = null;
  const get = (): Promise<VerifyReader> =>
    (ready ??= (async () => {
      const [{ prisma, loadOrganization }, { createPrismaReader }] = await Promise.all([
        import('@kku/db'),
        import('./prisma-reader'),
      ]);
      await loadOrganization();
      return createPrismaReader(prisma);
    })());
  return {
    dataSources: async (slugs) => (await get()).dataSources(slugs),
    latestRun: async (slug) => (await get()).latestRun(slug),
    rowCounts: async (dataset, runId) => (await get()).rowCounts(dataset, runId),
  };
}

export async function main(
  argv: readonly string[],
  io: VerifyIo,
  deps?: Partial<VerifyMainDeps>,
): Promise<0 | 1 | 3> {
  const slug = argv.find((a) => !a.startsWith('-'));
  if (!slug || argv.includes('--help') || argv.includes('-h')) {
    io.err(HELP);
    return 3;
  }
  const json = argv.includes('--json');

  try {
    const results = await runChecks(slug, {
      reader: deps?.reader ?? lazyDefaultReader(),
      entries: deps?.entries ?? INSTITUTION_CONNECTORS,
      catalog: deps?.catalog ?? SOURCE_CATALOG,
      env: process.env,
    });
    io.out(json ? JSON.stringify({ slug, results }, null, 2) : formatReport(slug, results));
    return exitCodeFor(results);
  } catch (e) {
    if (isDbUnreachable(e)) {
      io.err(
        'connector:verify: could not reach the database — is it running (pnpm db:up), and does DATABASE_URL name the right user?',
      );
      return 3;
    }
    throw e;
  }
}

if (require.main === module) {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  void main(process.argv.slice(2), {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
  })
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('[connector:verify] uncaught:', err instanceof Error ? err.message : String(err));
      process.exit(3);
    });
}
