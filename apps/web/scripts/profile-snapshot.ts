// Dev-only characterisation harness for the staff-profile refactor
// (docs/superpowers/plans/2026-09-30-staff-profile-api.md, Tasks 1 and 5).
//
//   pnpm exec tsx apps/web/scripts/profile-snapshot.ts <out.json>
//
// Picks a fixed set of dev users who resolve to a staff record with research
// rows (plus the one Scholar-bound person, if any), forces their publications
// cache cold so the live pipeline runs, and writes getProfileData() output as
// key-sorted JSON. Run before and after the refactor and `diff` the files.
//
// `source` and `scholarPaperId` are stripped from publications because the
// refactor ADDS them — every other field must match.
import { writeFileSync } from 'node:fs';
import { prisma } from '@kku/db';
import { getProfileData } from '../src/lib/profile-data';

const SAMPLE = 5;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

async function pickUsers(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    (SELECT u.id FROM users u
       JOIN faculty_members fm ON fm.employee_id = u.employee_id AND fm.is_active
      WHERE EXISTS (SELECT 1 FROM research_outputs r WHERE r.faculty_member_id = fm.id)
      ORDER BY u.id LIMIT ${SAMPLE})
    UNION
    (SELECT u.id FROM users u
       JOIN faculty_members fm ON fm.employee_id = u.employee_id
      WHERE fm.scholar_profile_id IS NOT NULL
      LIMIT 1)`;
  return rows.map((r) => r.id).sort();
}

async function forceCold(): Promise<void> {
  // Whichever cache table exists — the refactor replaces one with the other.
  for (const table of ['user_publications_cache', 'staff_publications_cache']) {
    const exists = await prisma.$queryRawUnsafe<Array<{ t: string | null }>>(
      `SELECT to_regclass('public.${table}')::text AS t`,
    );
    if (exists[0]?.t) {
      await prisma.$executeRawUnsafe(`UPDATE ${table} SET fetched_at = to_timestamp(0)`);
    }
  }
}

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error('usage: profile-snapshot.ts <out.json>');
  const userIds = await pickUsers();
  await forceCold();
  const snapshot: Record<string, unknown> = {};
  for (const id of userIds) {
    const profile = await getProfileData(id);
    if (profile) {
      for (const p of profile.publications as Array<Record<string, unknown>>) {
        delete p.source;
        delete p.scholarPaperId;
      }
    }
    snapshot[id] = profile;
  }
  writeFileSync(out, JSON.stringify(sortKeys(snapshot), null, 2) + '\n');
  console.log(`wrote ${userIds.length} profiles to ${out}`);
  await prisma.$disconnect();
}

void main();
