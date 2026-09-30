// DSAR — Data Subject Access Request exporter.
//
// Thai PDPA §30 grants every data subject the right to receive every
// piece of personal data we hold about them. This script answers that
// request by dumping every row across every personal-data table that
// references either:
//   --citizen-hash <sha256-hex>  — covers HR / staff / DS2003 surfaces
//   --user-id <uuid>             — covers user-bound surfaces
//                                  (audit log, AI inference, notifications,
//                                   scenarios, decisions, profile cache, etc.)
// Either key also reaches the person's staff record(s), and through them the
// staff-profile publications cache and the external staff-profile API's call
// log (which KKU system looked the person up, and when).
// The row collectors live in ./dsar-dump.ts.
// Both can be passed together for the full personal-data footprint.
//
// Output: a single deterministic JSON envelope (sorted keys, sorted row
// arrays). Default destination is stdout; pass `--out <path>` to write
// to a file. Read-only — never mutates the database.
//
// Usage:
//   pnpm tsx scripts/pdpa/dsar.ts --citizen-hash <hash>
//   pnpm tsx scripts/pdpa/dsar.ts --user-id <uuid> --out dsar.json
//   pnpm tsx scripts/pdpa/dsar.ts --citizen-hash <hash> --user-id <uuid>
//
// Versioned via DSAR_SCHEMA_VERSION below — bump on shape change so
// downstream PDPA tooling can branch on it.

import { writeFileSync } from 'node:fs';
import { prisma, resolveFacultyMemberForUser } from '@kku/db';
import { dumpByCitizenHash, dumpByUserId } from './dsar-dump';

// v2: adds staffPublicationsCache + apiRequestLogs (both keys) and
// byUserId.staffRecord (which staff records the user resolved to, and how).
const DSAR_SCHEMA_VERSION = 'dsar.v2';

// ── CLI parsing ──────────────────────────────────────────────────────
interface Args {
  citizenHash: string | null;
  userId: string | null;
  outPath: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { citizenHash: null, userId: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--citizen-hash' && next) {
      args.citizenHash = next.toLowerCase();
      i++;
    } else if (a === '--user-id' && next) {
      args.userId = next;
      i++;
    } else if (a === '--out' && next) {
      args.outPath = next;
      i++;
    } else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage(): void {
  process.stdout.write(
    [
      'DSAR — Data Subject Access Request exporter',
      '',
      'Usage:',
      '  pnpm tsx scripts/pdpa/dsar.ts --citizen-hash <sha256-hex>',
      '  pnpm tsx scripts/pdpa/dsar.ts --user-id <uuid>',
      '  pnpm tsx scripts/pdpa/dsar.ts --citizen-hash <hash> --user-id <uuid> --out dsar.json',
      '',
      'At least one of --citizen-hash or --user-id is required.',
      '',
      'Output: deterministic JSON envelope; sorted keys; sorted row arrays.',
      'Reads only; no DB mutation.',
      '',
    ].join('\n'),
  );
}

// ── Deterministic JSON serialiser (sorts keys recursively) ──────────
type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [k: string]: JsonValue };

function sortKeysDeep(v: unknown): JsonValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
    return v;
  }
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (typeof v === 'object') {
    const out: { [k: string]: JsonValue } = {};
    const keys = Object.keys(v as Record<string, unknown>).sort();
    for (const k of keys) {
      out[k] = sortKeysDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return String(v);
}

// ── Main ────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.citizenHash && !args.userId) {
    printUsage();
    process.exit(1);
  }

  const generatedAt = new Date().toISOString();
  const envelope: Record<string, unknown> = {
    schemaVersion: DSAR_SCHEMA_VERSION,
    generatedAt,
    request: {
      citizenIdHash: args.citizenHash,
      userId: args.userId,
    },
    data: {},
  };

  const data = envelope.data as Record<string, unknown>;
  if (args.citizenHash) {
    data.byCitizenHash = await dumpByCitizenHash(prisma, args.citizenHash);
  }
  if (args.userId) {
    data.byUserId = await dumpByUserId(prisma, args.userId, resolveFacultyMemberForUser);
  }

  const sorted = sortKeysDeep(envelope);
  const json = JSON.stringify(sorted, null, 2);

  if (args.outPath) {
    writeFileSync(args.outPath, json + '\n');
    process.stdout.write(`DSAR written to ${args.outPath}\n`);
  } else {
    process.stdout.write(json + '\n');
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  process.stderr.write(`DSAR failed: ${err instanceof Error ? err.message : String(err)}\n`);
  await prisma.$disconnect();
  process.exit(2);
});
