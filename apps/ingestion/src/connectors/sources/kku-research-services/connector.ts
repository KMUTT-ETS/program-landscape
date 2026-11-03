// KKU Research & Academic Services — externally funded research and
// academic-service projects, with their leads and co-investigators.
// Source: MySQL 5.7 at KKU_RESEARCH_SERVICES_DB_* (read-only login).
// Daily snapshot replace: both tables are rewritten in ONE transaction, and
// only after both views were fetched, so a failed fetch never deletes data.
// Rows are validated one by one: a malformed row is skipped and counted, and
// only when more than 1 % of a view fails is the run refused as schema drift.
// Pure logic + SQL live in transforms.ts.

import type {
  Connector,
  ConnectorContext,
  HealthStatus,
  LoadResult,
  NormalizedRecord,
  RawRecord,
} from '@kku/shared';
import { IMPORTED_GRANT_KEY_PREFIX, prisma } from '@kku/db';

// Spreadsheet-imported grants share these tables; the snapshot replace and its
// shrink guard only ever see the connector's own rows.
const OWN_PROJECTS = { sourceProposalKey: { not: { startsWith: IMPORTED_GRANT_KEY_PREFIX } } } as const;
const OWN_MEMBERS = { project: OWN_PROJECTS } as const;

import { ApiConnector } from '../../base/api-connector';
import { NonRetryableError } from '../../base/base-connector';
import { configFromEnv, query, withConnection } from '../../../lib/mysql-client';
import {
  CO_INVESTIGATORS_SQL,
  CoRowSchema,
  PROJECTS_SQL,
  ProjectRowSchema,
  driftMessage,
  partitionRows,
  planSnapshot,
  shrinkGuardMessage,
  type CoRow,
  type IdentityIndex,
  type InvalidRowSample,
  type ProjectRow,
  type StaffRef,
} from './transforms';

const ENV_PREFIX = 'KKU_RESEARCH_SERVICES_DB';
const CHUNK = 1000;

interface Fetched {
  projects: ProjectRow[];
  cos: CoRow[];
  projectRowsFetched: number;
  coRowsFetched: number;
  invalidProjects: number;
  invalidCoRows: number;
  invalidProjectSamples: InvalidRowSample[];
  invalidCoSamples: InvalidRowSample[];
}

export class KkuResearchServicesRealConnector extends ApiConnector implements Connector {
  readonly slug = 'kku-research-services';
  readonly mocked = false;

  private fetched: Fetched | null = null;

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    try {
      const cfg = configFromEnv(ENV_PREFIX);
      await withConnection(cfg, async (conn) => query(conn, 'SELECT 1 AS ok'));
      return { ok: true, message: `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async fetch(ctx: ConnectorContext): Promise<RawRecord[]> {
    const cfg = configFromEnv(ENV_PREFIX);
    const { rawProjects, rawCos } = await withConnection(cfg, async (conn) => {
      // insert_date is a TIMESTAMP column, which MySQL renders in the SESSION
      // time zone; transforms.parseBangkokDateTime reads it as +07:00, so pin
      // the session to Bangkok rather than trusting the server default.
      // accept_date is DATETIME and is unaffected by this setting.
      await conn.query("SET time_zone = '+07:00'");
      return {
        rawProjects: await query(conn, PROJECTS_SQL),
        rawCos: await query(conn, CO_INVESTIGATORS_SQL),
      };
    });

    const projects = partitionRows(rawProjects, ProjectRowSchema, 'proposal_id');
    const cos = partitionRows(rawCos, CoRowSchema, 'co_id');
    const drift =
      driftMessage('project', projects.invalidCount, rawProjects.length) ??
      driftMessage('co-investigator', cos.invalidCount, rawCos.length);
    if (drift) {
      const sample = [...projects.invalidSamples, ...cos.invalidSamples][0];
      throw new NonRetryableError(
        'SCHEMA_DRIFT',
        `research-services: ${drift} (projects ${projects.invalidCount}/${rawProjects.length}, ` +
          `co-investigators ${cos.invalidCount}/${rawCos.length}; first issue at ${sample?.path ?? '?'})`,
      );
    }
    if (projects.valid.length === 0) {
      throw new NonRetryableError(
        'EMPTY_DATA',
        'project view returned 0 valid rows — refusing to wipe the snapshot',
      );
    }
    if (projects.invalidCount + cos.invalidCount > 0) {
      ctx.log.warn(
        `skipped ${projects.invalidCount} invalid project rows and ${cos.invalidCount} invalid co-investigator rows`,
      );
    }
    this.fetched = {
      projects: projects.valid,
      cos: cos.valid,
      projectRowsFetched: rawProjects.length,
      coRowsFetched: rawCos.length,
      invalidProjects: projects.invalidCount,
      invalidCoRows: cos.invalidCount,
      invalidProjectSamples: projects.invalidSamples,
      invalidCoSamples: cos.invalidSamples,
    };
    ctx.log.info(
      `fetched ${projects.valid.length} projects, ${cos.valid.length} co-investigator rows`,
    );
    // One synthetic record: the snapshot is planned and loaded as a whole in load().
    return [{ externalId: 'snapshot', data: {}, sourceTimestamp: new Date() }];
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [
      {
        target: 'research_service_snapshot',
        externalId: raw.externalId,
        payload: {},
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(ctx: ConnectorContext, _normalized: NormalizedRecord[]): Promise<LoadResult> {
    if (!this.fetched) throw new Error('fetch() must run before load()');
    // The instance lives for the worker's lifetime: drop the fetched rows once
    // this run is done so they are not held between runs or seen by a later one.
    try {
      const f = this.fetched;
      const { projects, cos } = f;

      const current = await prisma.researchServiceProject.count({ where: OWN_PROJECTS });
      const refusal = shrinkGuardMessage(projects.length, current);
      if (refusal) throw new NonRetryableError('SNAPSHOT_SHRANK', refusal);

      const plan = planSnapshot(projects, cos, await buildIdentityIndex(projects, cos));

      await prisma.$transaction(
        async (tx) => {
          await tx.researchServiceProjectMember.deleteMany({ where: OWN_MEMBERS });
          await tx.researchServiceProject.deleteMany({ where: OWN_PROJECTS });
          for (let i = 0; i < plan.projects.length; i += CHUNK) {
            await tx.researchServiceProject.createMany({
              data: plan.projects
                .slice(i, i + CHUNK)
                .map((p) => ({ ...p, ingestionRunId: ctx.runId })),
            });
          }
          for (let i = 0; i < plan.members.length; i += CHUNK) {
            await tx.researchServiceProjectMember.createMany({
              data: plan.members
                .slice(i, i + CHUNK)
                .map((m) => ({ ...m, ingestionRunId: ctx.runId })),
            });
          }
        },
        { timeout: 120_000, maxWait: 10_000 },
      );

      const s = plan.stats;
      return {
        recordsFetched: f.projectRowsFetched + f.coRowsFetched,
        recordsLoaded: plan.projects.length + plan.members.length,
        recordsFailed: f.invalidProjects + f.invalidCoRows,
        metadata: {
          projectsFetched: f.projectRowsFetched,
          coRowsFetched: f.coRowsFetched,
          invalidProjects: f.invalidProjects,
          invalidCoRows: f.invalidCoRows,
          invalidProjectSamples: f.invalidProjectSamples,
          invalidCoSamples: f.invalidCoSamples,
          membersLoaded: plan.members.length,
          projectsWithMatchedLead: s.projectsWithMatchedLead,
          // Per-person rates, comparable to the spec's measured match rates.
          leadPeople: s.leadPeople,
          leadPeopleMatched: s.leadPeopleMatched,
          leadMatchRate: s.leadPeople ? s.leadPeopleMatched / s.leadPeople : null,
          coSixDigit: s.coSixDigit,
          coMatched: s.coMatched,
          coPeopleSixDigit: s.coPeopleSixDigit,
          coPeopleMatched: s.coPeopleMatched,
          coMatchRate: s.coPeopleSixDigit ? s.coPeopleMatched / s.coPeopleSixDigit : null,
          coOtherIds: s.coOtherIds,
          coOrphansNotInView: s.coOrphans,
          unmatchedUnitSamples: s.unmatchedUnitSamples,
        },
      };
    } finally {
      this.fetched = null;
    }
  }
}

/** Batch lookups only — never one query per row. */
async function buildIdentityIndex(projects: ProjectRow[], cos: CoRow[]): Promise<IdentityIndex> {
  const hashes = [
    ...new Set(projects.map((p) => p.head_citizen_hash).filter((h): h is string => !!h)),
  ];
  const emails = [...new Set(projects.map((p) => p.lead_email).filter((e): e is string => !!e))];
  const empIds = [
    ...new Set(cos.map((c) => c.kku_id?.trim() ?? '').filter((k) => /^\d{6}$/.test(k))),
  ];
  const sel = {
    id: true,
    facultyId: true,
    citizenIdHash: true,
    kkuEmail: true,
    employeeId: true,
  } as const;
  const [byHash, byEmail, byEmp, faculties] = await Promise.all([
    prisma.facultyMember.findMany({ where: { citizenIdHash: { in: hashes } }, select: sel }),
    prisma.facultyMember.findMany({
      where: { kkuEmail: { in: emails, mode: 'insensitive' } },
      select: sel,
    }),
    // Prefer an active record when an employee id appears on more than one row.
    prisma.facultyMember.findMany({
      where: { employeeId: { in: empIds } },
      select: sel,
      orderBy: [{ isActive: 'desc' }, { id: 'asc' }],
    }),
    prisma.faculty.findMany({ select: { id: true, nameTh: true } }),
  ]);
  const ref = (m: { id: string; facultyId: string | null }): StaffRef => ({
    id: m.id,
    facultyId: m.facultyId,
  });
  const idx: IdentityIndex = {
    byCitizenHash: new Map(),
    byEmail: new Map(),
    byEmployeeId: new Map(),
    facultyIdByName: new Map(faculties.map((f) => [f.nameTh, f.id])),
    facultyNameById: new Map(faculties.map((f) => [f.id, f.nameTh])),
  };
  for (const m of byHash) if (m.citizenIdHash) idx.byCitizenHash.set(m.citizenIdHash, ref(m));
  for (const m of byEmail) if (m.kkuEmail) idx.byEmail.set(m.kkuEmail.toLowerCase(), ref(m));
  for (const m of byEmp)
    if (m.employeeId && !idx.byEmployeeId.has(m.employeeId))
      idx.byEmployeeId.set(m.employeeId, ref(m));
  return idx;
}
