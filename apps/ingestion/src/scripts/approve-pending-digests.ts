#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Approve every PROGRAM_DIGEST extraction in PENDING_REVIEW and run
// materialiseProgramDigest on each. Mirrors POST /ai/extractions/:id/approve
// but bypasses HTTP for bulk operator-driven sign-off.
//
// Per-row try/catch so a single materialise failure (e.g., orphan FK,
// concurrent edit) doesn't abort the remaining rows. Reports per-row
// outcomes and aggregate totals.
//
// Idempotent: rows already APPROVED are skipped. Re-running is safe.
//
// Usage:
//   pnpm programs:approve-pending                           # approve all
//   pnpm programs:approve-pending --reviewer <email>        # override default
// ─────────────────────────────────────────────────────────────────────────────

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import { prisma, materialiseProgramDigest } from '@kku/db';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}
const REVIEWER_EMAIL = flag('reviewer') ?? 'admin@kku.ac.th';
const REVIEW_NOTE = 'Bulk operator sign-off via approve-pending-digests script.';

interface RowOutcome {
  extractionId: string;
  programId: string;
  status: 'approved' | 'failed';
  programFieldsUpdated?: number;
  skillsLinked?: number;
  skillsProposed?: number;
  error?: string;
}

async function main(): Promise<void> {
  const reviewer = await prisma.user.findUnique({
    where: { email: REVIEWER_EMAIL },
    select: { id: true, email: true },
  });
  if (!reviewer) throw new Error(`Reviewer user not found: ${REVIEWER_EMAIL}`);
  console.log(`Reviewer: ${reviewer.email}`);

  const pending = await prisma.aiExtraction.findMany({
    where: { extractionKind: 'PROGRAM_DIGEST', reviewStatus: 'PENDING_REVIEW' },
    select: { id: true, sourceEntityId: true, confidence: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Pending PROGRAM_DIGEST extractions: ${pending.length}\n`);
  if (pending.length === 0) {
    console.log('Nothing to approve.');
    return;
  }

  const outcomes: RowOutcome[] = [];
  let totalFields = 0;
  let totalSkillsLinked = 0;
  let totalSkillsProposed = 0;

  for (let i = 0; i < pending.length; i++) {
    const ext = pending[i]!;
    process.stdout.write(`[${(i + 1).toString().padStart(3)}/${pending.length}] ${ext.id} `);
    try {
      await prisma.aiExtraction.update({
        where: { id: ext.id },
        data: {
          reviewStatus: 'APPROVED',
          reviewedByUserId: reviewer.id,
          reviewedAt: new Date(),
          reviewNotes: REVIEW_NOTE,
        },
      });
      const result = await materialiseProgramDigest(ext.id);
      outcomes.push({
        extractionId: ext.id,
        programId: ext.sourceEntityId,
        status: 'approved',
        programFieldsUpdated: result.programFieldsUpdated,
        skillsLinked: result.skillsLinked,
        skillsProposed: result.skillsProposed,
      });
      totalFields += result.programFieldsUpdated;
      totalSkillsLinked += result.skillsLinked;
      totalSkillsProposed += result.skillsProposed;
      console.log(`✓ fields=${result.programFieldsUpdated} linked=${result.skillsLinked} proposed=${result.skillsProposed}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({
        extractionId: ext.id,
        programId: ext.sourceEntityId,
        status: 'failed',
        error: msg,
      });
      console.log(`✗ ${msg.slice(0, 100)}`);
    }
  }

  const successes = outcomes.filter((o) => o.status === 'approved').length;
  const failures = outcomes.filter((o) => o.status === 'failed').length;
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Approved: ${successes}`);
  console.log(`Failed:   ${failures}`);
  console.log(`Program fields updated:  ${totalFields}`);
  console.log(`ProgramSkill rows linked: ${totalSkillsLinked}`);
  console.log(`PROPOSED_SKILL queued:    ${totalSkillsProposed}`);
  if (failures > 0) {
    console.log('\nFailures:');
    for (const o of outcomes.filter((o) => o.status === 'failed').slice(0, 10)) {
      console.log(`  ${o.extractionId} ${o.error}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
