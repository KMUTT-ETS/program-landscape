#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Fresh-install check for adopting universities. READ-ONLY.
//
// A fresh installation must hold nothing that belongs to Khon Kaen University:
// no scheduled connectors, no @kku.ac.th accounts, no synthetic skills, no
// sample demographics, no successful mock runs. This prints a count for each
// and exits 1 if any is non-zero. Faculties are reported but not judged — an
// adopter may legitimately have imported theirs already.
//
// Usage: pnpm adopter:fresh-check
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
    // Never override an already-set variable: lets a shell-local DATABASE_URL win.
    if (!(k in process.env)) process.env[k] = v;
  }
}

import { loadOrganization, prisma } from '@kku/db';

/** Synthetic skills seeded by the KKU dev seed's buildSkills(): SK-0001 … */
const SYNTHETIC_SKILL_CODE = /^SK-\d{4}$/;
/** The single KKU recruitment override shipped by migration; inert elsewhere. */
const KKU_OVERRIDE_PROGRAM_ID = '310402601169';

interface Check {
  label: string;
  count: number;
  /** Informational only — never fails the run. */
  informational?: boolean;
  note?: string;
}

async function main(): Promise<void> {
  await loadOrganization();
  const [scheduled, kkuUsers, faculties, skillCodes, demographics, mockRuns, otherOverrides, kkuOverride] =
    await Promise.all([
      prisma.dataSource.count({ where: { scheduleEnabled: true } }),
      prisma.user.count({ where: { email: { endsWith: '@kku.ac.th', mode: 'insensitive' } } }),
      prisma.faculty.count(),
      prisma.skill.findMany({ where: { code: { startsWith: 'SK-' } }, select: { code: true } }),
      prisma.demographicProjection.count({ where: { source: 'NESDC-v1' } }),
      prisma.ingestionRun.count({
        where: { status: 'SUCCEEDED', dataSource: { mocked: true } },
      }),
      prisma.recruitmentProgramOverride.count({
        where: { recruitmentProgramId: { not: KKU_OVERRIDE_PROGRAM_ID } },
      }),
      prisma.recruitmentProgramOverride.count({
        where: { recruitmentProgramId: KKU_OVERRIDE_PROGRAM_ID },
      }),
    ]);

  const checks: Check[] = [
    { label: 'data sources with scheduling enabled', count: scheduled },
    { label: 'users with an @kku.ac.th email', count: kkuUsers },
    {
      label: 'skills with a synthetic (SK-nnnn) code',
      count: skillCodes.filter((s) => SYNTHETIC_SKILL_CODE.test(s.code)).length,
    },
    { label: "demographic projections from source 'NESDC-v1'", count: demographics },
    { label: 'successful runs of mocked sources', count: mockRuns },
    { label: 'recruitment overrides other than the allowlisted KKU row', count: otherOverrides },
    {
      label: 'faculties',
      count: faculties,
      informational: true,
      note: 'not judged; an adopter may have imported theirs',
    },
    {
      label: 'allowlisted KKU recruitment override rows',
      count: kkuOverride,
      informational: true,
      note: 'inert',
    },
  ];

  let failed = false;
  for (const c of checks) {
    const bad = !c.informational && c.count > 0;
    if (bad) failed = true;
    const tag = c.informational ? 'info' : bad ? 'FAIL' : 'ok  ';
    console.log(`[${tag}] ${c.label}: ${c.count}${c.note ? ` (${c.note})` : ''}`);
  }
  console.log(failed ? '\nFresh-install check FAILED.' : '\nFresh-install check passed.');
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
