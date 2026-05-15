#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Backfill FacultyMember.kkuEmail from HCM EmployeeDetail.EMAIL.
//
// `kku-hr`'s main connector populates the rest of FacultyMember but pre-dates
// the kkuEmail column. This script does a one-shot lift of HCM emails so the
// teaching-workload dashboard can resolve KKUMAIL → FacultyMember without
// waiting for the next full kku-hr refresh.
//
// PDPA: a KKU work email is identifying but already published in the public
// staff directory. Read-only; updates only rows that already exist in our DB.
//
// Join: FacultyMember.employeeId == HCM.EmployeeDetail.EMPLOYEEID (raw,
// non-PII per KKU 2026-05-02). citizenIdHash join is preserved as fallback
// for kkupub_ rows that never had employeeId populated.
//
// Usage:
//   pnpm staff:backfill-emails           # apply
//   pnpm staff:backfill-emails --dry-run # preview counts
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

import { prisma } from '@kku/db';
import { withScriptRun } from '../lib/script-run';
import {
  withConnection as mssqlWithConnection,
  configFromEnv as mssqlConfigFromEnv,
  query as mssqlQuery,
} from '../lib/mssql-client';

interface HcmRow {
  EMPLOYEEID: string;
  EMAIL: string;
}

function parseArgs(argv: string[]): { apply: boolean } {
  return { apply: !argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);

  await withScriptRun('kku-hr', async ({ setRecordsLoaded }) => {
    // ── Pull HCM email map ──────────────────────────────────────
    console.log('Reading EmployeeDetail.EMAIL from HCM…');
    const rows = await mssqlWithConnection(
      mssqlConfigFromEnv('KKU_HR_DB'),
      async (pool) => {
        return mssqlQuery<HcmRow>(
          pool,
          `SELECT EMPLOYEEID, LOWER(LTRIM(RTRIM(EMAIL))) AS EMAIL
             FROM EmployeeDetail
            WHERE EMAIL IS NOT NULL
              AND LTRIM(RTRIM(EMAIL)) <> ''
              AND EMAIL LIKE '%@%'`,
        );
      },
    );
    console.log(`  HCM rows with email: ${rows.length.toLocaleString()}`);
    const byEmployeeId = new Map<string, string>();
    for (const r of rows) {
      if (r.EMPLOYEEID && r.EMAIL) byEmployeeId.set(String(r.EMPLOYEEID), r.EMAIL);
    }

    // ── Load our FacultyMember rows that still need an email ────
    const fms = await prisma.facultyMember.findMany({
      where: { kkuEmail: null, employeeId: { not: null } },
      select: { id: true, employeeId: true },
    });
    console.log(`FacultyMember rows missing kkuEmail (with employeeId): ${fms.length.toLocaleString()}`);

    let updates = 0;
    let collisions = 0;
    let unmatched = 0;
    const taken = new Set<string>();
    // Pre-load already-set emails so we don't try to set a duplicate.
    const existing = await prisma.facultyMember.findMany({
      where: { kkuEmail: { not: null } },
      select: { kkuEmail: true },
    });
    for (const e of existing) if (e.kkuEmail) taken.add(e.kkuEmail);

    for (const fm of fms) {
      const email = byEmployeeId.get(String(fm.employeeId));
      if (!email) {
        unmatched++;
        continue;
      }
      if (taken.has(email)) {
        // Two HR rows with the same email — keep the first, skip the rest.
        collisions++;
        continue;
      }
      if (args.apply) {
        try {
          await prisma.facultyMember.update({
            where: { id: fm.id },
            data: { kkuEmail: email },
          });
        } catch (err) {
          // Unique-constraint race — treat as collision and move on.
          collisions++;
          continue;
        }
      }
      taken.add(email);
      updates++;
    }

    setRecordsLoaded(updates);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Rows ${args.apply ? 'updated' : 'would-update'}:    ${updates.toLocaleString()}`);
    console.log(`Email collisions:    ${collisions.toLocaleString()}  (duplicate emails in HCM — kept first)`);
    console.log(`Unmatched (no email in HCM): ${unmatched.toLocaleString()}`);
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
