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
import { prisma } from '@kku/db';

const DSAR_SCHEMA_VERSION = 'dsar.v1';

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

// ── Hash-keyed dump (covers HR / staff / DS2003 / lifecycle) ────────
async function dumpByCitizenHash(hash: string) {
  const [
    facultyMembers,
    staffEducationHistory,
    staffLifecycleDates,
    staffMasterRecords,
    staffProgramAssignments,
    studentProgramRecords,
  ] = await Promise.all([
    prisma.facultyMember.findMany({
      where: { citizenIdHash: hash },
      orderBy: { id: 'asc' },
    }),
    prisma.staffEducationHistory.findMany({
      where: { citizenIdHash: hash },
      orderBy: [{ id: 'asc' }],
    }),
    prisma.staffLifecycleDates.findMany({
      where: { citizenIdHash: hash },
      orderBy: { citizenIdHash: 'asc' },
    }),
    prisma.staffMasterRecord.findMany({
      where: { citizenIdHash: hash },
      orderBy: [{ academicYear: 'asc' }, { semester: 'asc' }],
    }),
    prisma.staffProgramAssignment.findMany({
      where: { citizenIdHash: hash },
      orderBy: [{ academicYear: 'asc' }, { semester: 'asc' }, { id: 'asc' }],
    }),
    prisma.studentProgramRecord.findMany({
      where: { citizenIdHash: hash },
      orderBy: [{ academicYear: 'asc' }, { semester: 'asc' }],
    }),
  ]);

  return {
    facultyMembers,
    staffEducationHistory,
    staffLifecycleDates,
    staffMasterRecords,
    staffProgramAssignments,
    studentProgramRecords,
  };
}

// ── User-keyed dump (covers session-bound personal surfaces) ────────
async function dumpByUserId(userId: string) {
  const [
    user,
    userScopes,
    auditLogs,
    aiInferences,
    annotations,
    analystConversations,
    analystFeedback,
    councilDecisions,
    decisionApprovers,
    notifications,
    pdfDocumentsUploaded,
    pdfExtractionsReviewed,
    savedCockpitViews,
    scenarios,
    signalSubscriptions,
    userExpertiseNarratives,
    userPublicationsCache,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.userScope.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.aiInference.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.annotation.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.analystConversation.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    }),
    prisma.analystFeedback.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.councilDecision.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.decisionApprover.findMany({
      where: { userId },
      orderBy: { addedAt: 'asc' },
    }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.pdfDocument.findMany({
      where: { uploadedByUserId: userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.pdfExtraction.findMany({
      where: { reviewedByUserId: userId },
      orderBy: { reviewedAt: 'asc' },
    }),
    prisma.savedCockpitView.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.scenario.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.signalSubscription.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
    }),
    prisma.userExpertiseNarrative.findMany({
      where: { userId },
      orderBy: { generatedAt: 'asc' },
    }),
    prisma.userPublicationsCache.findUnique({ where: { userId } }),
  ]);

  return {
    user,
    userScopes,
    auditLogs,
    aiInferences,
    annotations,
    analystConversations,
    analystFeedback,
    councilDecisions,
    decisionApprovers,
    notifications,
    pdfDocumentsUploaded,
    pdfExtractionsReviewed,
    savedCockpitViews,
    scenarios,
    signalSubscriptions,
    userExpertiseNarratives,
    userPublicationsCache,
  };
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
    data.byCitizenHash = await dumpByCitizenHash(args.citizenHash);
  }
  if (args.userId) {
    data.byUserId = await dumpByUserId(args.userId);
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
