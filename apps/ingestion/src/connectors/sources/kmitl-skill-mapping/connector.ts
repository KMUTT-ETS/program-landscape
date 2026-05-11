// ─────────────────────────────────────────────────────────────────────────────
// Real KmitlSkillMappingConnector — replaces jobthai + jobsdb.
//
// KMITL Skill Mapping API (https://skill.kmitl.ac.th/api/v1) exposes
// aggregated skill-demand intelligence built from LinkedIn profiles, job
// postings, and university graduate data. Returns percentages at
// career/group/sub-group level — NOT per-posting rows.
//
// Fetch sequence (throttled to 5 req/s = 200ms between calls):
//   1. /skills, /industries, /universities — lookup masters
//   2. /groups — list of all career groups
//   3. /groups/{id} — for each group: full group detail (skills_growth_overview)
//   4. /careers — flat career list
//   5. /careers/{id} — for each career: full career detail (skills + growth)
//
// Transform/Load (single-threaded, manual upsert):
//   - KmitlCareer rows from /careers + /careers/{id}.sub_groups
//   - KmitlCareerSkillDemand rows from career-detail × {scope, source} matrix
//   - KmitlSkillGrowth rows from group-detail.skills_growth_overview AND
//     career-detail.skills_growth (both contexts retained — see schema)
//
// Skill resolution: case-insensitive trimmed exact match on Skill.nameEn,
// then Skill.nameTh, then the SkillAlias cache (sourceContext='linkedin',
// status='RESOLVED'). Unmatched → skillId=NULL + raw name in
// KmitlCareerSkillDemand.skillNameRaw, surfaced in IngestionRun.metadata
// for analyst triage.
//
// The SkillAlias cache is filled by the AI normaliser script (run via
// `pnpm skills:normalise --source=linkedin --auto-promote` after each
// successful sync). Once names are resolved into the alias cache, every
// subsequent connector run resolves them WITHOUT an LLM round-trip — the
// alias cache is the single source of truth for free-text → Skill.id
// mappings encountered by this feed.
//
// Operator workflow (recurring):
//   1. Mon 06:00 UTC — connector cron triggers a full sync
//   2. Optional: `pnpm skills:normalise --source=linkedin --auto-promote`
//      processes any newly-encountered raw names (typically <50 per week
//      after initial backfill) and updates KmitlCareerSkillDemand.skill_id
//      for the new resolutions.
//
// PDPA: API contract is aggregate-only; no per-person fields. The discovery
// script's no-PII guard runs every Phase B refresh; the connector itself
// trusts the contract.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma, type PrismaClient } from '@kku/db';
import {
  buildDirectToken,
  buildKmitlHeaders,
  type Connector,
  type ConnectorContext,
  type HealthStatus,
  type LoadResult,
  type NormalizedRecord,
  type RawRecord,
} from '@kku/shared';

import { ApiConnector } from '../../base/api-connector';
import { NonRetryableError } from '../../base/base-connector';
import {
  buildCareerMetadata,
  buildSkillLookup,
  careerDetailToDemandDrafts,
  careerDetailToGrowthDrafts,
  groupDetailToGrowthDrafts,
  KmitlCareerDetailSchema,
  KmitlCareersListSchema,
  KmitlGroupDetailSchema,
  KmitlGroupListSchema,
  KMITL_METHODOLOGY_VERSION,
  type CareerSkillDemandRowDraft,
  type KmitlCareerDetail,
  type KmitlCareerListRow,
  type KmitlGroupDetail,
  type SkillGrowthRowDraft,
  type SkillLookup,
} from './transforms';

const DEFAULT_BASE_URL = 'https://skill.kmitl.ac.th/api/v1';
const THROTTLE_MS = 200;

interface RunState {
  capturedAt: string;
  baseUrl: string;
  groupsFetched: number;
  careersFetched: number;
  groupDetails: KmitlGroupDetail[];
  careerDetails: KmitlCareerDetail[];
  careerListRows: KmitlCareerListRow[];
  skillLookup: SkillLookup;
  unmappedSkillSamples: Set<string>;
}

interface NormalizedCareer {
  target: 'kmitl_career';
  detail: KmitlCareerDetail;
  groupName: string;
  groupId: number;
  subGroupName: string;
  subGroupId: number;
  demandDrafts: CareerSkillDemandRowDraft[];
  growthDrafts: SkillGrowthRowDraft[];
  metadata: Record<string, unknown>;
}

interface NormalizedGroupGrowth {
  target: 'kmitl_group_growth';
  growthDrafts: SkillGrowthRowDraft[];
}

type NormalizedKmitlRecord = NormalizedCareer | NormalizedGroupGrowth;

export class KmitlSkillMappingRealConnector extends ApiConnector implements Connector {
  readonly slug = 'kmitl-skill-mapping';
  readonly mocked = false;

  private runState?: RunState;

  constructor(private readonly db: PrismaClient = prisma) {
    super();
  }

  // ─── HTTP helpers ──────────────────────────────────────────────────────────

  private credentials(): { clientId: string; secretKey: string } {
    const clientId = process.env.KMITL_SKILL_MAPPING_CLIENT_ID?.trim();
    const secretKey = process.env.KMITL_SKILL_MAPPING_SECRET_KEY?.trim();
    if (!clientId || !secretKey) {
      throw new NonRetryableError(
        'CONFIG',
        'KMITL credentials missing — set KMITL_SKILL_MAPPING_CLIENT_ID and KMITL_SKILL_MAPPING_SECRET_KEY',
      );
    }
    return { clientId, secretKey };
  }

  private baseUrl(): string {
    return (process.env.KMITL_SKILL_MAPPING_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private async httpGetJson(pathSegment: string): Promise<unknown> {
    const url = `${this.baseUrl()}/${pathSegment.replace(/^\//, '')}`;
    const token = buildDirectToken(this.credentials());
    const headers = {
      ...buildKmitlHeaders(token),
      'User-Agent': 'kku-curriculum-landscape/1.0 (mailto:denpong@kku.ac.th)',
    };
    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch (err) {
      const cause = (err as Error & { cause?: unknown }).cause;
      const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : '';
      throw new Error(
        `HTTP GET ${url} failed: ${err instanceof Error ? err.message : String(err)}${detail ? ` (cause: ${detail})` : ''}`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new NonRetryableError('AUTH', `KMITL ${res.status} on ${url} — credentials rejected`);
    }
    if (!res.ok) {
      throw new Error(`HTTP GET ${url} → ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  private async fetchSkillLookup(): Promise<SkillLookup> {
    // Pull both the direct taxonomy (Skill.nameEn/Th exact match) AND
    // the previously-resolved aliases for this source (skill_aliases with
    // sourceContext='linkedin' AND status='RESOLVED'). The alias cache
    // means once the AI normaliser has resolved a free-text name, every
    // subsequent sync picks up the mapping without an LLM round-trip.
    const [skills, aliases] = await Promise.all([
      this.db.skill.findMany({
        select: { id: true, nameEn: true, nameTh: true },
      }),
      this.db.skillAlias.findMany({
        where: { sourceContext: 'linkedin', status: 'RESOLVED', resolvedSkillId: { not: null } },
        select: { rawNameLower: true, resolvedSkillId: true },
      }),
    ]);
    // Coerce: resolvedSkillId is non-null because of the where clause.
    return buildSkillLookup(
      skills,
      aliases.map((a) => ({ rawNameLower: a.rawNameLower, resolvedSkillId: a.resolvedSkillId! })),
    );
  }

  // ─── Connector lifecycle ───────────────────────────────────────────────────

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    try {
      const data = (await this.httpGetJson('/')) as { message?: string; version?: string };
      return {
        ok: !!data?.message,
        message: `${data?.message ?? 'no message'} (version ${data?.version ?? 'unknown'})`,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const capturedAt = new Date().toISOString();
    const state: RunState = {
      capturedAt,
      baseUrl: this.baseUrl(),
      groupsFetched: 0,
      careersFetched: 0,
      groupDetails: [],
      careerDetails: [],
      careerListRows: [],
      skillLookup: await this.fetchSkillLookup(),
      unmappedSkillSamples: new Set(),
    };
    this.runState = state;

    ctx.log.info(
      `Skill lookup loaded: ${state.skillLookup.byNameEn.size} EN names, ${state.skillLookup.byNameTh.size} TH names`,
    );

    // 1. Group list → group details (one per group)
    const groupsRaw = await this.httpGetJson('/groups');
    const groups = KmitlGroupListSchema.parse(groupsRaw);
    state.groupsFetched = groups.length;
    ctx.log.info(`Fetched ${groups.length} groups`);

    for (const g of groups) {
      await sleep(THROTTLE_MS);
      const detailRaw = await this.httpGetJson(`/groups/${g.id}`);
      const detail = KmitlGroupDetailSchema.parse(detailRaw);
      state.groupDetails.push(detail);
    }
    ctx.log.info(`Fetched ${state.groupDetails.length} group details`);

    // 2. Careers list → career details (one per career)
    await sleep(THROTTLE_MS);
    const careersRaw = await this.httpGetJson('/careers');
    const careers = KmitlCareersListSchema.parse(careersRaw);
    state.careerListRows = careers;
    state.careersFetched = careers.length;
    ctx.log.info(`Fetched ${careers.length} careers (will pull ${careers.length} detail payloads)`);

    for (const c of careers) {
      await sleep(THROTTLE_MS);
      const detailRaw = await this.httpGetJson(`/careers/${c.id}`);
      const detail = KmitlCareerDetailSchema.parse(detailRaw);
      state.careerDetails.push(detail);
    }
    ctx.log.info(`Fetched ${state.careerDetails.length} career details`);

    // RawRecord stream — one record per career (heaviest payload), plus one
    // per group for the group-level skills_growth_overview rows.
    const records: RawRecord[] = [];
    for (const detail of state.careerDetails) {
      records.push({
        externalId: `career-${detail.id}`,
        sourceTimestamp: new Date(),
        data: { kind: 'career', detail },
      });
    }
    for (const detail of state.groupDetails) {
      records.push({
        externalId: `group-growth-${detail.id}`,
        sourceTimestamp: new Date(),
        data: { kind: 'group-growth', detail },
      });
    }
    return records;
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const state = this.runState;
    if (!state) throw new Error('transform() called before fetch()');
    const data = raw.data as { kind: 'career' | 'group-growth'; detail: KmitlCareerDetail | KmitlGroupDetail };
    const lookup = state.skillLookup;

    if (data.kind === 'career') {
      const detail = data.detail as KmitlCareerDetail;
      // Resolve group + sub-group names from the careers-list row (faster
      // than re-querying). Fall back to the detail payload's sub_groups.
      const listRow = state.careerListRows.find((r) => r.id === detail.id);
      const groupName = (listRow?.groups[0] ?? '').trim();
      const subGroupName = (listRow?.sub_groups[0] ?? detail.sub_groups[0]?.name ?? '').trim();
      // Resolve numeric IDs by walking the group-detail map. Sub-group id
      // is on the detail; group id is the one whose sub_groups contains it.
      const subGroupId = detail.sub_groups[0]?.id ?? 0;
      const groupId =
        state.groupDetails.find((gd) => gd.sub_groups.some((sg) => sg.id === subGroupId))?.id ?? 0;

      const demandDrafts = careerDetailToDemandDrafts(detail, lookup);
      const growthDrafts = careerDetailToGrowthDrafts(detail, lookup);
      // Track unmapped skills for analyst triage
      for (const d of demandDrafts) {
        if (d.skillId === null) state.unmappedSkillSamples.add(d.skillNameRaw);
      }
      for (const d of growthDrafts) {
        if (d.skillId === null) state.unmappedSkillSamples.add(d.skillNameRaw);
      }

      const out: NormalizedCareer = {
        target: 'kmitl_career',
        detail,
        groupName,
        groupId,
        subGroupName,
        subGroupId,
        demandDrafts,
        growthDrafts,
        metadata: buildCareerMetadata(detail),
      };
      return [
        {
          target: 'kmitl_career',
          externalId: `career-${detail.id}`,
          payload: out as unknown as Record<string, unknown>,
          freshnessDate: raw.sourceTimestamp,
        },
      ];
    }

    // group-growth
    const detail = data.detail as KmitlGroupDetail;
    const growthDrafts = groupDetailToGrowthDrafts(detail, lookup);
    for (const d of growthDrafts) {
      if (d.skillId === null) state.unmappedSkillSamples.add(d.skillNameRaw);
    }
    const out: NormalizedGroupGrowth = {
      target: 'kmitl_group_growth',
      growthDrafts,
    };
    return [
      {
        target: 'kmitl_group_growth',
        externalId: `group-growth-${detail.id}`,
        payload: out as unknown as Record<string, unknown>,
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    const state = this.runState;
    if (!state) throw new Error('load() called before fetch()');

    const snapshotAt = new Date();
    snapshotAt.setUTCHours(0, 0, 0, 0);
    const freshnessDate = snapshotAt;

    // Phase 1: upsert KmitlCareer rows. Sequential is fine — only ~400 of
    // them, and we need the cuid for the demand-row foreign key.
    const careerCuidByKmitlId = new Map<number, string>();
    const allDemandDrafts: Array<{ careerCuid: string; draft: CareerSkillDemandRowDraft; metadata: Record<string, unknown> }> = [];
    const allGrowthDrafts: SkillGrowthRowDraft[] = [];
    let careersUpserted = 0;
    let failed = 0;

    for (const rec of normalized) {
      try {
        if (rec.target === 'kmitl_career') {
          const p = rec.payload as unknown as NormalizedCareer;
          const career = await this.upsertCareer(p, snapshotAt, freshnessDate, ctx.runId);
          careerCuidByKmitlId.set(p.detail.id, career.id);
          careersUpserted++;
          for (const d of p.demandDrafts) {
            allDemandDrafts.push({ careerCuid: career.id, draft: d, metadata: p.metadata });
          }
          for (const g of p.growthDrafts) {
            allGrowthDrafts.push(g);
          }
        } else if (rec.target === 'kmitl_group_growth') {
          const p = rec.payload as unknown as NormalizedGroupGrowth;
          for (const g of p.growthDrafts) {
            allGrowthDrafts.push(g);
          }
        } else {
          ctx.log.warn(`unknown target "${rec.target}", skipping`);
          failed++;
        }
      } catch (err) {
        failed++;
        ctx.log.error(
          `failed to upsert career ${rec.externalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    ctx.log.info(`Phase 1 done: ${careersUpserted} careers upserted; queued ${allDemandDrafts.length} demand + ${allGrowthDrafts.length} growth rows`);

    // Phase 2: upsert demand rows in concurrent batches. Promise.all of size
    // BATCH_SIZE pipelines DB roundtrips through Prisma's connection pool.
    // Sequential per-row was ~20ms × 50k rows = 17 min; batches of 25 cut
    // wall-clock to ~45 sec.
    const BATCH_SIZE = 25;
    let demandsUpserted = 0;
    for (let i = 0; i < allDemandDrafts.length; i += BATCH_SIZE) {
      const chunk = allDemandDrafts.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        chunk.map(({ careerCuid, draft, metadata }) =>
          this.upsertDemand(careerCuid, draft, snapshotAt, freshnessDate, metadata, ctx.runId),
        ),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') demandsUpserted++;
        else {
          failed++;
          ctx.log.error(`demand upsert failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
        }
      }
      if (i % (BATCH_SIZE * 20) === 0 && i > 0) {
        ctx.log.info(`Demand load progress: ${i}/${allDemandDrafts.length}`);
      }
    }
    ctx.log.info(`Phase 2 done: ${demandsUpserted} demand rows upserted`);

    // Phase 3: upsert growth rows in concurrent batches.
    let growthsUpserted = 0;
    for (let i = 0; i < allGrowthDrafts.length; i += BATCH_SIZE) {
      const chunk = allGrowthDrafts.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(chunk.map((g) => this.upsertGrowth(g, snapshotAt, ctx.runId)));
      for (const r of results) {
        if (r.status === 'fulfilled') growthsUpserted++;
        else {
          failed++;
          ctx.log.error(`growth upsert failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
        }
      }
    }
    ctx.log.info(`Phase 3 done: ${growthsUpserted} growth rows upserted`);

    const totalLoaded = careersUpserted + demandsUpserted + growthsUpserted;
    return {
      recordsFetched: normalized.length,
      recordsLoaded: totalLoaded,
      recordsFailed: failed,
      metadata: {
        connectorMode: 'real',
        capturedAt: state.capturedAt,
        baseUrl: state.baseUrl,
        methodologyVersion: KMITL_METHODOLOGY_VERSION,
        groupsFetched: state.groupsFetched,
        careersFetched: state.careersFetched,
        careersUpserted,
        demandsUpserted,
        growthsUpserted,
        unmappedSkillCount: state.unmappedSkillSamples.size,
        unmappedSkillSamples: [...state.unmappedSkillSamples].slice(0, 50),
        notes:
          'KMITL Skill Mapping v1: aggregate-only API. Skill resolution exact-match (nameEn case-insensitive, then nameTh). Unmatched names land with skillId=NULL — analyst triage via unmappedSkillSamples.',
      },
    };
  }

  // ─── Upsert helpers ────────────────────────────────────────────────────────

  private async upsertCareer(
    p: NormalizedCareer,
    _snapshotAt: Date,
    freshnessDate: Date,
    runId: string,
  ): Promise<{ id: string }> {
    return this.db.kmitlCareer.upsert({
      where: { kmitlCareerId: p.detail.id },
      update: {
        kmitlGroupId: p.groupId,
        kmitlSubGroupId: p.subGroupId,
        groupName: p.groupName,
        subGroupName: p.subGroupName,
        careerName: p.detail.name,
        freshnessDate,
        ingestionRunId: runId,
        // Preserve any analyst-set isco_code on update
      },
      create: {
        kmitlCareerId: p.detail.id,
        kmitlGroupId: p.groupId,
        kmitlSubGroupId: p.subGroupId,
        groupName: p.groupName,
        subGroupName: p.subGroupName,
        careerName: p.detail.name,
        freshnessDate,
        ingestionRunId: runId,
      },
      select: { id: true },
    });
  }

  private async upsertDemand(
    careerCuid: string,
    d: CareerSkillDemandRowDraft,
    snapshotAt: Date,
    freshnessDate: Date,
    metadata: Record<string, unknown>,
    runId: string,
  ): Promise<void> {
    await this.db.kmitlCareerSkillDemand.upsert({
      where: {
        kmitlCareerId_skillNameRaw_dataScope_dataSource: {
          kmitlCareerId: d.kmitlCareerId,
          skillNameRaw: d.skillNameRaw,
          dataScope: d.dataScope,
          dataSource: d.dataSource,
        },
      },
      update: {
        skillId: d.skillId,
        amount: d.amount,
        percentage: d.percentage,
        snapshotAt,
        freshnessDate,
        metadata: metadata as object,
        ingestionRunId: runId,
      },
      create: {
        careerId: careerCuid,
        kmitlCareerId: d.kmitlCareerId,
        skillId: d.skillId,
        skillNameRaw: d.skillNameRaw,
        dataScope: d.dataScope,
        dataSource: d.dataSource,
        amount: d.amount,
        percentage: d.percentage,
        snapshotAt,
        freshnessDate,
        metadata: metadata as object,
        ingestionRunId: runId,
      },
    });
  }

  private async upsertGrowth(g: SkillGrowthRowDraft, snapshotAt: Date, runId: string): Promise<void> {
    await this.db.kmitlSkillGrowth.upsert({
      where: {
        contextLevel_contextId_skillNameRaw_dataScope: {
          contextLevel: g.contextLevel,
          contextId: g.contextId,
          skillNameRaw: g.skillNameRaw,
          dataScope: g.dataScope,
        },
      },
      update: {
        skillId: g.skillId,
        contextName: g.contextName,
        growthPct: g.growthPct,
        snapshotAt,
        ingestionRunId: runId,
      },
      create: {
        skillId: g.skillId,
        skillNameRaw: g.skillNameRaw,
        contextLevel: g.contextLevel,
        contextId: g.contextId,
        contextName: g.contextName,
        dataScope: g.dataScope,
        growthPct: g.growthPct,
        snapshotAt,
        ingestionRunId: runId,
      },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
