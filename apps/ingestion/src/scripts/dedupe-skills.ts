// ─────────────────────────────────────────────────────────────────────────────
// dedupe-skills — merge duplicate `skills` rows.
//
//   pnpm skills:dedupe                 # dry run, prints the full plan
//   pnpm skills:dedupe --apply         # merge
//   pnpm skills:dedupe --limit 5       # plan only the first N groups
//
// 386 groups share a name case-insensitively (456 redundant rows, 10.3% of the
// taxonomy). See packages/db/src/skill-dedupe.ts for the root cause and why it
// matters beyond tidiness.
//
// SAFETY
//   - dry run by default; --apply is required to write
//   - one transaction per group, so a failure cannot leave a half-merged group
//   - every preserved name becomes a SkillAlias, so no vocabulary is lost and
//     the matcher still resolves the discarded spelling
//   - TrendSignal.affectedSkillIds is rewritten even though it is NOT an FK;
//     a naive merge would leave dangling ids there
//   - derived tables are DELETED for dropped skills rather than merged, and
//     recomputed by `pnpm jobthai:derive --apply` afterwards: merging two
//     independently-derived aggregates would invent a number neither supports
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Inline env-file loader rather than `dotenv/config`: dotenv is not a
// dependency, and this script is esbuild-bundled for the prod ingestion image,
// where the environment comes from the container and this is a no-op.
loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
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

import {
  prisma,
  normaliseSkillName,
  planChildRemap,
  planGroupMerge,
  type MergePlan,
  type SkillRowForMerge,
} from '@kku/db';

/** Child tables whose unique constraint INCLUDES skill_id — a repoint can collide. */
const COLLIDING_TABLES = [
  { table: 'course_skills', parent: 'course_id' },
  { table: 'department_skills', parent: 'department_id' },
  { table: 'faculty_skills', parent: 'faculty_id' },
  { table: 'program_skills', parent: 'program_id' },
  { table: 'peer_program_skills', parent: 'peer_program_id' },
  { table: 'skill_sectors', parent: 'sector_id' },
  { table: 'program_demand_matches', parent: 'program_id' },
] as const;

/** Unique constraint does NOT include skill_id, so a repoint is always safe. */
const SAFE_UPDATE_TABLES = [
  { table: 'kmitl_career_skill_demands', column: 'skill_id' },
  { table: 'kmitl_skill_growths', column: 'skill_id' },
  { table: 'external_career_skill_demands', column: 'skill_id' },
  { table: 'skill_aliases', column: 'resolved_skill_id' },
] as const;

/** Derived from source data — deleted and recomputed, never merged. */
const DERIVED_TABLES = ['job_posting_skills', 'jobthai_occupation_skills'] as const;

interface Totals {
  groups: number;
  dropped: number;
  childUpdated: number;
  childDeleted: number;
  derivedDeleted: number;
  aliasesCreated: number;
  signalsRewritten: number;
}

async function loadGroups(limit: number | null): Promise<MergePlan[]> {
  const refCountSql = COLLIDING_TABLES.map((t) => `(SELECT COUNT(*) FROM ${t.table} WHERE skill_id = s.id)`)
    .concat(SAFE_UPDATE_TABLES.map((t) => `(SELECT COUNT(*) FROM ${t.table} WHERE ${t.column} = s.id)`))
    .concat(DERIVED_TABLES.map((t) => `(SELECT COUNT(*) FROM ${t} WHERE skill_id = s.id)`))
    .join(' + ');

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; code: string; name_en: string; name_th: string;
    category: string | null; created_at: Date; refs: bigint;
  }>>(`
    SELECT s.id, s.code, s.name_en, s.name_th, s.category, s.created_at,
           (${refCountSql})::bigint AS refs
    FROM skills s
    WHERE lower(trim(s.name_en)) IN (
      SELECT lower(trim(name_en)) FROM skills GROUP BY 1 HAVING COUNT(*) > 1
    )
    ORDER BY lower(trim(s.name_en)), s.created_at
  `);

  const byKey = new Map<string, SkillRowForMerge[]>();
  for (const r of rows) {
    const key = normaliseSkillName(r.name_en);
    const list = byKey.get(key) ?? [];
    list.push({
      id: r.id,
      code: r.code,
      nameEn: r.name_en,
      nameTh: r.name_th,
      category: r.category,
      createdAt: r.created_at,
      references: Number(r.refs),
    });
    byKey.set(key, list);
  }

  const plans: MergePlan[] = [];
  for (const [key, group] of byKey) {
    const plan = planGroupMerge(key, group);
    if (plan) plans.push(plan);
  }
  plans.sort((a, b) => b.drop.length - a.drop.length || a.key.localeCompare(b.key));
  return limit === null ? plans : plans.slice(0, limit);
}

async function mergeGroup(plan: MergePlan, totals: Totals): Promise<void> {
  const dropIds = plan.drop.map((d) => d.id);

  await prisma.$transaction(async (tx) => {
    // 1. Derived rows: delete, do not merge. Recomputed afterwards.
    for (const table of DERIVED_TABLES) {
      const n = await tx.$executeRawUnsafe(
        `DELETE FROM ${table} WHERE skill_id = ANY($1::text[])`,
        dropIds,
      );
      totals.derivedDeleted += n;
    }

    // 2. Tables where a repoint can violate @@unique([parent, skill_id]).
    for (const { table, parent } of COLLIDING_TABLES) {
      const droppedRows = await tx.$queryRawUnsafe<Array<{ id: string; parent_key: string }>>(
        `SELECT id, ${parent}::text AS parent_key FROM ${table} WHERE skill_id = ANY($1::text[])`,
        dropIds,
      );
      if (droppedRows.length === 0) continue;
      const survivorRows = await tx.$queryRawUnsafe<Array<{ parent_key: string }>>(
        `SELECT ${parent}::text AS parent_key FROM ${table} WHERE skill_id = $1`,
        plan.keep.id,
      );
      const remap = planChildRemap({
        droppedRows: droppedRows.map((r) => ({ id: r.id, parentKey: r.parent_key })),
        parentKeysOnSurvivor: new Set(survivorRows.map((r) => r.parent_key)),
      });
      if (remap.update.length > 0) {
        totals.childUpdated += await tx.$executeRawUnsafe(
          `UPDATE ${table} SET skill_id = $1 WHERE id = ANY($2::text[])`,
          plan.keep.id,
          remap.update,
        );
      }
      if (remap.deleteConflicting.length > 0) {
        totals.childDeleted += await tx.$executeRawUnsafe(
          `DELETE FROM ${table} WHERE id = ANY($1::text[])`,
          remap.deleteConflicting,
        );
      }
    }

    // 3. Tables whose unique key does not involve skill_id.
    for (const { table, column } of SAFE_UPDATE_TABLES) {
      totals.childUpdated += await tx.$executeRawUnsafe(
        `UPDATE ${table} SET ${column} = $1 WHERE ${column} = ANY($2::text[])`,
        plan.keep.id,
        dropIds,
      );
    }

    // 4. The self-relation: children of a dropped skill re-parent to the survivor.
    totals.childUpdated += await tx.$executeRawUnsafe(
      `UPDATE skills SET parent_skill_id = $1 WHERE parent_skill_id = ANY($2::text[])`,
      plan.keep.id,
      dropIds,
    );

    // 5. NOT an FK, so nothing would have caught a dangling id here.
    const signals = await tx.$queryRawUnsafe<Array<{ id: string; affected_skill_ids: string[] }>>(
      `SELECT id, affected_skill_ids FROM trend_signals WHERE affected_skill_ids && $1::text[]`,
      dropIds,
    );
    for (const sig of signals) {
      const rewritten = [...new Set(sig.affected_skill_ids.map((x) => (dropIds.includes(x) ? plan.keep.id : x)))];
      await tx.$executeRawUnsafe(
        `UPDATE trend_signals SET affected_skill_ids = $1::text[] WHERE id = $2`,
        rewritten,
        sig.id,
      );
      totals.signalsRewritten += 1;
    }

    // 6. Preserve every discarded name as an alias, so no vocabulary is lost
    //    and the JobThai matcher still resolves the discarded spelling.
    for (const name of plan.aliasNames) {
      const existing = await tx.$queryRawUnsafe<Array<{ id: string; status: string }>>(
        `SELECT id, status::text FROM skill_aliases WHERE raw_name_lower = $1 AND source_context = 'curriculum'`,
        name,
      );
      if (existing.length === 0) {
        await tx.$executeRawUnsafe(
          `INSERT INTO skill_aliases (id, raw_name_lower, raw_name, source_context, status, resolved_skill_id, confidence, reasoning, created_at, updated_at)
           VALUES (gen_random_uuid()::text, $1, $1, 'curriculum', 'RESOLVED', $2, 1.0, $3, NOW(), NOW())`,
          name,
          plan.keep.id,
          `Preserved during skill de-duplication of "${plan.key}" (2026-09-13).`,
        );
        totals.aliasesCreated += 1;
      } else if (existing[0]!.status !== 'REJECTED') {
        // REJECTED is an analyst saying no; never overwrite that.
        await tx.$executeRawUnsafe(
          `UPDATE skill_aliases SET resolved_skill_id = $1, status = 'RESOLVED', updated_at = NOW() WHERE id = $2`,
          plan.keep.id,
          existing[0]!.id,
        );
      }
    }

    // 7. Finally the rows themselves.
    totals.dropped += await tx.$executeRawUnsafe(
      `DELETE FROM skills WHERE id = ANY($1::text[])`,
      dropIds,
    );
    totals.groups += 1;
  }, { timeout: 60_000 });
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg === -1 ? null : Number(process.argv[limitArg + 1]);

  const before = await prisma.skill.count();
  const plans = await loadGroups(limit);
  const toDrop = plans.reduce((s, p) => s + p.drop.length, 0);

  console.log(`=== skills:dedupe (${apply ? 'APPLY' : 'DRY RUN'}) ===`);
  console.log(`skills before      : ${before}`);
  console.log(`duplicate groups   : ${plans.length}`);
  console.log(`rows to remove     : ${toDrop}`);
  console.log(`aliases to preserve: ${plans.reduce((s, p) => s + p.aliasNames.length, 0)}`);
  console.log('');
  for (const p of plans.slice(0, 12)) {
    console.log(`  "${p.key}"  keep=${p.keep.code} (refs ${p.keep.references})  drop=${p.drop.map((d) => `${d.code}[${d.references}]`).join(' ')}`);
    if (p.aliasNames.length > 0) console.log(`      preserve as aliases: ${p.aliasNames.join(' | ')}`);
  }
  if (plans.length > 12) console.log(`  … and ${plans.length - 12} more groups`);

  if (!apply) {
    console.log('\nDRY RUN — pass --apply to merge.');
    await prisma.$disconnect();
    return;
  }

  const totals: Totals = {
    groups: 0, dropped: 0, childUpdated: 0, childDeleted: 0,
    derivedDeleted: 0, aliasesCreated: 0, signalsRewritten: 0,
  };
  let failed = 0;
  for (const plan of plans) {
    try {
      await mergeGroup(plan, totals);
    } catch (e) {
      failed += 1;
      console.error(`  FAILED "${plan.key}": ${(e as Error).message.split('\n')[0]}`);
    }
  }

  const after = await prisma.skill.count();
  console.log('');
  console.log(`groups merged      : ${totals.groups}${failed > 0 ? ` (${failed} FAILED)` : ''}`);
  console.log(`skills removed     : ${totals.dropped}  (${before} -> ${after})`);
  console.log(`child rows repointed: ${totals.childUpdated}`);
  console.log(`child rows deleted as duplicates: ${totals.childDeleted}`);
  console.log(`derived rows deleted (recompute with jobthai:derive): ${totals.derivedDeleted}`);
  console.log(`aliases created    : ${totals.aliasesCreated}`);
  console.log(`trend signals rewritten: ${totals.signalsRewritten}`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
