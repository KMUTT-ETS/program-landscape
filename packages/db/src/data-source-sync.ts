import type { PrismaClient } from '@prisma/client';
import { SOURCE_CATALOG } from '@kku/shared';

import { prisma as defaultPrisma } from './index';

/**
 * Reconcile `data_sources` with the connector catalog.
 *
 * WHY THIS EXISTS AS A STANDALONE FUNCTION. `deploy.sh` runs
 * `prisma migrate deploy` but has never seeded, so a connector declared in
 * `packages/shared/src/ingestion/catalog.ts` arrived in production with no
 * `data_sources` row — and every script that resolves a source by slug failed
 * with "no DataSource with slug=…". job-108 hit it first (2026-09-30, during
 * the v1.9.8 rollout), but nothing about the failure was specific to job-108:
 * ANY new connector was dead on arrival in production.
 *
 * The upsert loop already existed, correct and idempotent, inside
 * `prisma/seed.ts` — unusable on production only because that seed also
 * writes SSO mappings, sample decisions and dev fixtures. Extracting it here
 * rather than copying it into a script is the point: a second copy would
 * drift from the catalog exactly the way the seed's own comment warns about,
 * and drift in THIS table is the `realDataWhere()` trap that has cost this
 * repository three separate incidents. The seed now calls this function, so
 * there is one implementation and it cannot disagree with itself.
 *
 * Safe to run on every deploy: it creates what is missing, corrects what has
 * drifted, and touches nothing else.
 */
export interface DataSourceSyncResult {
  /** Slugs inserted by this run. */
  created: string[];
  /** Slugs whose stored row disagreed with the catalog, and which columns. */
  updated: { slug: string; changes: string[] }[];
  /** Rows already matching the catalog in every synced column. */
  unchanged: number;
  /**
   * Slugs present in `data_sources` but absent from the catalog — a connector
   * deleted from the code while its row (and its IngestionRun history) remain.
   *
   * Reported, never deleted. Dropping them would orphan `ingestion_runs` rows
   * that point at them, and the correct disposal of a retired source is the
   * `deprecated: true` catalog flag, which preserves the audit trail.
   */
  orphaned: string[];
}

/** The columns this function owns. `lastSyncedAt` and `status` transitions
 *  made by the running system (e.g. a connector marking itself 'error') are
 *  deliberately NOT in this list for `lastSyncedAt`; `status` IS, because the
 *  catalog is the authority on mocked/deprecated/active. */
const SYNCED_COLUMNS = [
  'name',
  'kind',
  'inputFormat',
  'acceptsPdfUploads',
  'baseUrl',
  'cadenceCron',
  'scheduleEnabled',
  'ownerContact',
  'notes',
  'status',
  'mocked',
] as const;

type SyncedColumn = (typeof SYNCED_COLUMNS)[number];

/** The row shape the catalog dictates, for one entry. */
function desiredRow(entry: (typeof SOURCE_CATALOG)[number]): Record<SyncedColumn, unknown> {
  const scheduleEnabled = entry.deprecated ? false : (entry.scheduleEnabled ?? true);
  // `status` is the human-readable label the admin surfaces render, and it has
  // to account for `deprecated` as well as `mocked`: deriving it from `mocked`
  // alone re-labelled every superseded source as "active" on each seed, which
  // is how openalex + scopus kept advertising themselves as live feeds for the
  // four months after kku-research replaced them.
  const status = entry.mocked ? 'mocked' : entry.deprecated ? 'deprecated' : 'active';
  return {
    name: entry.name,
    kind: entry.kind,
    inputFormat: entry.inputFormat,
    acceptsPdfUploads: entry.acceptsPdfUploads ?? false,
    baseUrl: entry.baseUrl ?? null,
    cadenceCron: entry.cadenceCron ?? null,
    scheduleEnabled,
    ownerContact: entry.ownerContact ?? null,
    notes: entry.notes ?? null,
    status,
    // Keep `mocked` atomic with `status` — flipping a connector real in the
    // catalog must update BOTH columns (the drift-audit invariant), else the
    // connector runs real while data_sources still reads mocked=true and every
    // row it writes is silently invisible to realDataWhere().
    mocked: entry.mocked,
  };
}

export async function syncDataSourcesFromCatalog(
  client: Pick<PrismaClient, 'dataSource'> = defaultPrisma,
): Promise<DataSourceSyncResult> {
  const existing = await client.dataSource.findMany({
    select: {
      slug: true,
      name: true,
      kind: true,
      inputFormat: true,
      acceptsPdfUploads: true,
      baseUrl: true,
      cadenceCron: true,
      scheduleEnabled: true,
      ownerContact: true,
      notes: true,
      status: true,
      mocked: true,
    },
  });
  const bySlug = new Map(existing.map((r) => [r.slug, r as unknown as Record<string, unknown>]));

  const result: DataSourceSyncResult = { created: [], updated: [], unchanged: 0, orphaned: [] };

  for (const entry of SOURCE_CATALOG) {
    const desired = desiredRow(entry);
    const current = bySlug.get(entry.slug);

    if (current === undefined) {
      await client.dataSource.create({ data: { slug: entry.slug, ...desired } as never });
      result.created.push(entry.slug);
      continue;
    }

    const changes = SYNCED_COLUMNS.filter((c) => current[c] !== desired[c]);
    if (changes.length === 0) {
      result.unchanged += 1;
      continue;
    }
    await client.dataSource.update({ where: { slug: entry.slug }, data: desired as never });
    result.updated.push({ slug: entry.slug, changes: [...changes] });
  }

  const catalogSlugs = new Set(SOURCE_CATALOG.map((e) => e.slug));
  result.orphaned = existing.map((r) => r.slug).filter((s) => !catalogSlugs.has(s));

  return result;
}

/** One-line-per-fact summary, shared by the CLI and the deploy log so both
 *  read identically in an incident. */
export function formatDataSourceSync(r: DataSourceSyncResult): string[] {
  const lines = [
    `created:   ${r.created.length}${r.created.length ? ` — ${r.created.join(', ')}` : ''}`,
    `updated:   ${r.updated.length}${
      r.updated.length ? ` — ${r.updated.map((u) => `${u.slug} (${u.changes.join(', ')})`).join('; ')}` : ''
    }`,
    `unchanged: ${r.unchanged}`,
  ];
  if (r.orphaned.length > 0) {
    lines.push(
      `orphaned:  ${r.orphaned.length} — ${r.orphaned.join(', ')} ` +
        '(present in data_sources, absent from the catalog; NOT deleted — retire a source with `deprecated: true` instead)',
    );
  }
  return lines;
}
