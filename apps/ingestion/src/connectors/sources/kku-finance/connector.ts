// ─────────────────────────────────────────────────────────────────────────────
// Real KkuFinanceConnector — flips kku-finance from mock to live.
//
// Two sources, one run:
//   - Q1 (Oracle, KKU_REGISTRY_DB_*): tuition revenue per (program ×
//     ACADYEAR) by joining VIEWSTUDENTENROLLFEE × VIEW_STUDENT_DETAIL_ALL
//     on STUDENTCODE. Server-side GROUP BY + HAVING >= 5 students
//     suppression. Resolves to programId via existing
//     RegistryProgramMapping (no fuzzy match).
//   - Q2 (MSSQL, KKU_HR_DB_*): budget allocation per (DIVISION × FUND ×
//     FISCAL_YEAR) from ERPPowerBI.dbo.BudgetData. DIVISION_NAME →
//     facultyId via stripped-name match against existing Faculty.nameTh
//     (best-effort; null facultyId is allowed for central-admin /
//     hospital-only divisions).
//
// Partial upsert on FinancialMetric: this connector only fills
// `tuitionRevenue` (and on first-create defaults the cost columns to 0).
// Cost-allocated columns (directCost, allocatedFacultyCost, etc.) are
// filled by the cost-allocation methodology downstream — never touched
// by this connector.
//
// Full upsert on FacultyBudget: connector is the authoritative source
// for raw budget allocations. BudgetData upstream is current-year-only,
// so each ingestion run over-writes the latest snapshot for the same
// (division, fund, year) tuple via the unique constraint.
//
// PDPA: Q1's server-side GROUP BY + HAVING ensures the connector never
// sees per-student fee rows; Q2 has no per-person info at all. The two
// SQL queries are the only place this rule lives.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma, type PrismaClient } from '@kku/db';
import type {
  ConnectorContext,
  HealthStatus,
  LoadResult,
  NormalizedRecord,
  RawRecord,
} from '@kku/shared';

import { ApiConnector } from '../../base/api-connector';
import { NonRetryableError } from '../../base/base-connector';
import {
  configFromEnv as oracleConfigFromEnv,
  type OracleConfig,
  query as oracleQuery,
  withConnection as oracleWithConnection,
} from '../../../lib/oracle-client';
import {
  configFromEnv as mssqlConfigFromEnv,
  type MssqlConfig,
  query as mssqlQuery,
  withConnection as mssqlWithConnection,
} from '../../../lib/mssql-client';
import {
  buddhistToCommonEra,
  extractRootFacultyName,
  type MappingKey,
  mappingKeyToString,
  normaliseMappingKey,
  Q1RowSchema,
  type Q1Row,
  Q2RowSchema,
  type Q2Row,
} from './transforms';

// DIVISION_NAME → Faculty.nameTh is a live re-match on every run (unlike
// HrOrgMapping / RegistryProgramMapping, which are persisted bridges keyed
// on a stable FK and survive a rename untouched). When KKU renames a
// faculty on our side, KKU Finance's own BudgetData.DIVISION_NAME may still
// carry the old name for an unknown period — their system update timing is
// outside our control. List old→current nameTh pairs here for any faculty
// renamed on the platform so the match keeps resolving regardless of when
// (or whether) Finance's own system catches up. Safe to remove an entry
// once a live run confirms DIVISION_NAME has moved to the new name.
//   วิทยาลัยการปกครองท้องถิ่น → วิทยาลัยนโยบายและกิจการสาธารณะ (COLA → COPA, 2026-08-28)
const RENAMED_FACULTY_ALIASES: Record<string, string> = {
  วิทยาลัยการปกครองท้องถิ่น: 'วิทยาลัยนโยบายและกิจการสาธารณะ',
};

// ─────────────────────────────────────────────────────────────────────────
// SQL queries — see docs/data-sources/kku-finance.md "Aggregation contract"
// ─────────────────────────────────────────────────────────────────────────

// Q1: tuition aggregate per (program × ACADYEAR). Server-side GROUP BY
// + HAVING >= 5 — connector never sees per-student fee rows.
const Q1_TUITION_AGGREGATE = `
SELECT
  s.FACULTYNAME    AS FACULTY_NAME,
  s.PROGRAMNAME    AS PROGRAM_NAME,
  s.PROGRAMLEVEL   AS PROGRAM_LEVEL,
  s.MAJOR          AS MAJOR,
  f.ACADYEAR       AS COHORT_YEAR_BE,
  COUNT(DISTINCT f.STUDENTCODE) AS STUDENT_COUNT,
  SUM(f.AMOUNT)    AS TUITION_SUM
FROM POWERBI.VIEWSTUDENTENROLLFEE f
INNER JOIN (
  SELECT DISTINCT STUDENTCODE, FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL, MAJOR
  FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
) s ON s.STUDENTCODE = f.STUDENTCODE
WHERE s.FACULTYNAME IS NOT NULL AND s.PROGRAMNAME IS NOT NULL
GROUP BY s.FACULTYNAME, s.PROGRAMNAME, s.PROGRAMLEVEL, s.MAJOR, f.ACADYEAR
HAVING COUNT(DISTINCT f.STUDENTCODE) >= 5
`;

// Q2: budget aggregate per (DIVISION × FUND × FISCAL_YEAR_BE). No
// suppression — these are non-personal financials.
const Q2_BUDGET_AGGREGATE = `
SELECT
  DIVISION_NAME,
  FUND_NAME,
  CAST(BUDGET_PERIOD AS int)              AS FISCAL_YEAR_BE,
  BUDGET_PERIOD_NAME                       AS SNAPSHOT_NAME,
  SUM(TRY_CAST(TOTAL_BUDGET      AS decimal(18,2))) AS TOTAL_BUDGET,
  SUM(TRY_CAST(TOTAL_COMMITMENT  AS decimal(18,2))) AS TOTAL_COMMITMENT,
  SUM(TRY_CAST(TOTAL_OBLIGATION  AS decimal(18,2))) AS TOTAL_OBLIGATION,
  SUM(TRY_CAST(TOTAL_EXPENDITURE AS decimal(18,2))) AS TOTAL_EXPENDITURE,
  SUM(TRY_CAST(FUNDS_AVAILABLE   AS decimal(18,2))) AS FUNDS_AVAILABLE
FROM [ERPPowerBI].[dbo].[BudgetData]
WHERE DIVISION_NAME IS NOT NULL AND DIVISION_NAME != ''
GROUP BY DIVISION_NAME, FUND_NAME, BUDGET_PERIOD, BUDGET_PERIOD_NAME
`;

// ─────────────────────────────────────────────────────────────────────────
// Per-run state — populated during fetch, surfaced via load metadata
// ─────────────────────────────────────────────────────────────────────────

interface RunState {
  capturedAt: string;
  fetchTimestamp: Date;
  // Tuition side: (faculty | program | level | major) → programId
  programMappings: Map<string, string>;
  // Budget side: stripped faculty name → facultyId
  facultyByName: Map<string, string>;
  // Tally — for IngestionRun.metadata
  tuitionUnmappedTuples: { tupleKey: string; year: number; tuitionSum: number }[];
  budgetUnmappedDivisions: { divisionName: string; rootName: string; totalBudget: number }[];
  totalTuitionThbByYear: Record<number, number>;
  totalBudgetThbByFund: Record<string, number>;
}

interface FinanceRawTuition {
  kind: 'tuition';
  q1: Q1Row;
}

interface FinanceRawBudget {
  kind: 'budget';
  q2: Q2Row;
}

type FinanceRawPayload = FinanceRawTuition | FinanceRawBudget;

export class KkuFinanceRealConnector extends ApiConnector {
  readonly slug = 'kku-finance';
  readonly mocked = false;

  private runState?: RunState;

  constructor(
    private readonly oracleCfg: () => OracleConfig = () => oracleConfigFromEnv('KKU_REGISTRY_DB'),
    private readonly mssqlCfg: () => MssqlConfig = () => mssqlConfigFromEnv('KKU_HR_DB'),
    private readonly db: PrismaClient = prisma,
  ) {
    super();
  }

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    const issues: string[] = [];
    try {
      await oracleWithConnection(this.oracleCfg(), async (conn) => {
        await oracleQuery(conn, 'SELECT 1 AS OK FROM DUAL');
      });
    } catch (err) {
      issues.push(`oracle: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      await mssqlWithConnection(this.mssqlCfg(), async (pool) => {
        await mssqlQuery(pool, 'SELECT 1 AS OK');
      });
    } catch (err) {
      issues.push(`mssql: ${err instanceof Error ? err.message : String(err)}`);
    }
    return issues.length === 0
      ? { ok: true }
      : { ok: false, message: issues.join(' | ') };
  }

  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const fetchTimestamp = new Date();
    const capturedAt = fetchTimestamp.toISOString();

    // 1. Batch-load both bridges once.
    const [allMappings, allFaculties] = await Promise.all([
      this.db.registryProgramMapping.findMany({
        select: {
          registryFacultyName: true,
          registryProgramName: true,
          registryLevel: true,
          registryMajor: true,
          programId: true,
        },
      }),
      this.db.faculty.findMany({ select: { id: true, nameTh: true } }),
    ]);

    const programMappings = new Map<string, string>();
    for (const m of allMappings) {
      programMappings.set(
        mappingKeyToString({
          registryFacultyName: m.registryFacultyName,
          registryProgramName: m.registryProgramName,
          registryLevel: m.registryLevel,
          registryMajor: m.registryMajor,
        }),
        m.programId,
      );
    }
    const facultyByName = new Map<string, string>();
    for (const f of allFaculties) {
      facultyByName.set(f.nameTh.trim(), f.id);
    }
    // Also register any old name still in RENAMED_FACULTY_ALIASES against
    // the faculty currently holding the new name, so a DIVISION_NAME that
    // hasn't caught up to the rename on KKU's side still resolves.
    for (const [oldName, currentName] of Object.entries(RENAMED_FACULTY_ALIASES)) {
      const facultyId = facultyByName.get(currentName);
      if (facultyId) facultyByName.set(oldName, facultyId);
    }
    ctx.log.info(
      `bridges loaded: ${programMappings.size} program mappings, ${facultyByName.size} faculty-name lookups`,
    );

    // 2. Fetch from both sources in parallel — they're independent.
    const oracleCfg = this.oracleCfg();
    const mssqlCfg = this.mssqlCfg();
    const [q1Raw, q2Raw] = await Promise.all([
      oracleWithConnection(oracleCfg, async (conn) => {
        ctx.log.info('Q1 — running tuition aggregate on Oracle');
        const r = await oracleQuery(conn, Q1_TUITION_AGGREGATE);
        ctx.log.info(`Q1 returned ${r.length.toLocaleString()} rows`);
        return r;
      }),
      mssqlWithConnection(mssqlCfg, async (pool) => {
        ctx.log.info('Q2 — running budget aggregate on MSSQL');
        const r = await mssqlQuery(pool, Q2_BUDGET_AGGREGATE);
        ctx.log.info(`Q2 returned ${r.length.toLocaleString()} rows`);
        return r;
      }),
    ]);

    // 3. Validate.
    const q1Rows = q1Raw.map((r, i): Q1Row => {
      const parsed = Q1RowSchema.safeParse(r);
      if (!parsed.success) {
        throw new NonRetryableError(
          'Q1_VALIDATION',
          `Q1 row ${i} failed schema validation: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    });
    const q2Rows = q2Raw.map((r, i): Q2Row => {
      const parsed = Q2RowSchema.safeParse(r);
      if (!parsed.success) {
        throw new NonRetryableError(
          'Q2_VALIDATION',
          `Q2 row ${i} failed schema validation: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    });

    // 4. Init run state.
    this.runState = {
      capturedAt,
      fetchTimestamp,
      programMappings,
      facultyByName,
      tuitionUnmappedTuples: [],
      budgetUnmappedDivisions: [],
      totalTuitionThbByYear: {},
      totalBudgetThbByFund: {},
    };

    // 5. Emit one RawRecord per Q1 row + one per Q2 row.
    const records: RawRecord[] = [];
    for (const q1 of q1Rows) {
      records.push({
        externalId: `kku-finance:tuition:${tupleKey(q1)}`,
        sourceTimestamp: fetchTimestamp,
        data: { kind: 'tuition', q1 } satisfies FinanceRawPayload,
      });
    }
    for (const q2 of q2Rows) {
      records.push({
        externalId: `kku-finance:budget:${q2.DIVISION_NAME}|${q2.FUND_NAME ?? 'NULL'}|${q2.FISCAL_YEAR_BE}`,
        sourceTimestamp: fetchTimestamp,
        data: { kind: 'budget', q2 } satisfies FinanceRawPayload,
      });
    }
    return records;
  }

  async transform(
    _ctx: ConnectorContext,
    raw: RawRecord,
  ): Promise<NormalizedRecord[]> {
    const state = this.runState;
    if (!state) {
      throw new Error('transform() called before fetch() — connector lifecycle violated');
    }
    const data = raw.data as FinanceRawPayload;
    if (data.kind === 'tuition') {
      return this.transformTuition(state, data.q1, raw.sourceTimestamp);
    }
    return this.transformBudget(state, data.q2, raw.sourceTimestamp);
  }

  private transformTuition(
    state: RunState,
    q1: Q1Row,
    freshnessDate: Date,
  ): NormalizedRecord[] {
    const mk = normaliseMappingKey(q1);
    const programId = state.programMappings.get(mappingKeyToString(mk));
    if (!programId) {
      // Cap surfaced samples; always count.
      if (state.tuitionUnmappedTuples.length < 50) {
        state.tuitionUnmappedTuples.push({
          tupleKey: mappingKeyToString(mk),
          year: q1.COHORT_YEAR_BE,
          tuitionSum: q1.TUITION_SUM,
        });
      }
      return [];
    }
    const fiscalYear = buddhistToCommonEra(q1.COHORT_YEAR_BE);
    state.totalTuitionThbByYear[fiscalYear] =
      (state.totalTuitionThbByYear[fiscalYear] ?? 0) + q1.TUITION_SUM;
    return [
      {
        target: 'financial_metrics',
        externalId: `financial_metric:${programId}:${fiscalYear}`,
        payload: {
          programId,
          fiscalYear,
          tuitionRevenue: q1.TUITION_SUM,
          studentCount: q1.STUDENT_COUNT,
        },
        freshnessDate,
      },
    ];
  }

  private transformBudget(
    state: RunState,
    q2: Q2Row,
    freshnessDate: Date,
  ): NormalizedRecord[] {
    const fiscalYear = buddhistToCommonEra(q2.FISCAL_YEAR_BE);
    // Strip ` - <suffix>` to roll a hospital / sub-unit up to its
    // parent faculty name. The original DIVISION_NAME is preserved in
    // FacultyBudget.divisionName for transparency.
    const rootName = extractRootFacultyName(q2.DIVISION_NAME);
    const facultyId = state.facultyByName.get(rootName) ?? null;
    if (!facultyId) {
      // Track for run metadata but still emit the row — central
      // admin / external research centres still need to be reflected
      // in the total spend record.
      if (state.budgetUnmappedDivisions.length < 50) {
        state.budgetUnmappedDivisions.push({
          divisionName: q2.DIVISION_NAME,
          rootName,
          totalBudget: q2.TOTAL_BUDGET,
        });
      }
    }
    const fundCategory = q2.FUND_NAME?.trim() || '(unknown)';
    state.totalBudgetThbByFund[fundCategory] =
      (state.totalBudgetThbByFund[fundCategory] ?? 0) + q2.TOTAL_BUDGET;
    return [
      {
        target: 'faculty_budgets',
        externalId: `faculty_budget:${q2.DIVISION_NAME}|${fundCategory}|${fiscalYear}`,
        payload: {
          facultyId,
          divisionName: q2.DIVISION_NAME,
          fundCategory,
          fiscalYear,
          snapshotName: q2.SNAPSHOT_NAME,
          totalBudget: q2.TOTAL_BUDGET,
          totalCommitment: q2.TOTAL_COMMITMENT,
          totalObligation: q2.TOTAL_OBLIGATION,
          totalExpenditure: q2.TOTAL_EXPENDITURE,
          fundsAvailable: q2.FUNDS_AVAILABLE,
        },
        freshnessDate,
      },
    ];
  }

  async load(
    ctx: ConnectorContext,
    normalized: NormalizedRecord[],
  ): Promise<LoadResult> {
    const state = this.runState;
    if (!state) {
      throw new Error('load() called before fetch() — connector lifecycle violated');
    }
    let loaded = 0;
    let failed = 0;

    for (const rec of normalized) {
      try {
        if (rec.target === 'financial_metrics') {
          const p = rec.payload as {
            programId: string;
            fiscalYear: number;
            tuitionRevenue: number;
            studentCount: number;
          };
          // Partial upsert: only `tuitionRevenue` is touched on
          // update. Cost-allocated columns are owned by the methodology
          // layer downstream and must survive this connector's runs.
          await this.db.financialMetric.upsert({
            where: {
              programId_fiscalYear: {
                programId: p.programId,
                fiscalYear: p.fiscalYear,
              },
            },
            create: {
              programId: p.programId,
              fiscalYear: p.fiscalYear,
              tuitionRevenue: p.tuitionRevenue,
              otherRevenue: 0,
              directCost: 0,
              allocatedFacultyCost: 0,
              allocatedFacilityCost: 0,
              allocatedOverhead: 0,
              netContribution: p.tuitionRevenue,
              freshnessDate: rec.freshnessDate,
              methodologyVersion: 'kku-finance.v1',
              ingestionRunId: ctx.runId,
            },
            update: {
              tuitionRevenue: p.tuitionRevenue,
              freshnessDate: rec.freshnessDate,
              ingestionRunId: ctx.runId,
              // methodologyVersion intentionally not updated on partial
              // upsert — the existing value reflects whatever the
              // cost-allocation methodology stamped, and we don't want
              // to clobber that.
            },
          });
          loaded++;
        } else if (rec.target === 'faculty_budgets') {
          const p = rec.payload as {
            facultyId: string | null;
            divisionName: string;
            fundCategory: string;
            fiscalYear: number;
            snapshotName: string | null;
            totalBudget: number;
            totalCommitment: number;
            totalObligation: number;
            totalExpenditure: number;
            fundsAvailable: number;
          };
          await this.db.facultyBudget.upsert({
            where: {
              divisionName_fundCategory_fiscalYear: {
                divisionName: p.divisionName,
                fundCategory: p.fundCategory,
                fiscalYear: p.fiscalYear,
              },
            },
            create: {
              facultyId: p.facultyId,
              divisionName: p.divisionName,
              fundCategory: p.fundCategory,
              fiscalYear: p.fiscalYear,
              snapshotName: p.snapshotName,
              totalBudget: p.totalBudget,
              totalCommitment: p.totalCommitment,
              totalObligation: p.totalObligation,
              totalExpenditure: p.totalExpenditure,
              fundsAvailable: p.fundsAvailable,
              freshnessDate: rec.freshnessDate,
              methodologyVersion: 'kku-finance.v1',
              ingestionRunId: ctx.runId,
            },
            update: {
              facultyId: p.facultyId,
              snapshotName: p.snapshotName,
              totalBudget: p.totalBudget,
              totalCommitment: p.totalCommitment,
              totalObligation: p.totalObligation,
              totalExpenditure: p.totalExpenditure,
              fundsAvailable: p.fundsAvailable,
              freshnessDate: rec.freshnessDate,
              methodologyVersion: 'kku-finance.v1',
              ingestionRunId: ctx.runId,
            },
          });
          loaded++;
        } else {
          ctx.log.warn(`unknown target "${rec.target}", skipping`);
          failed++;
        }
      } catch (err) {
        failed++;
        ctx.log.error(
          `failed to load ${rec.target}/${rec.externalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      recordsFetched: normalized.length,
      recordsLoaded: loaded,
      recordsFailed: failed,
      metadata: {
        connectorMode: 'real',
        capturedAt: state.capturedAt,
        programMappingTableRowCount: state.programMappings.size,
        facultyLookupRowCount: state.facultyByName.size,
        tuitionUnmappedTuplesCount: state.tuitionUnmappedTuples.length,
        tuitionUnmappedSamples: state.tuitionUnmappedTuples.slice(0, 50),
        budgetUnmappedDivisionsCount: state.budgetUnmappedDivisions.length,
        budgetUnmappedSamples: state.budgetUnmappedDivisions.slice(0, 50),
        totalTuitionThbByYear: state.totalTuitionThbByYear,
        totalBudgetThbByFund: state.totalBudgetThbByFund,
        deferredFields: [
          'otherRevenue',
          'directCost',
          'allocatedFacultyCost',
          'allocatedFacilityCost',
          'allocatedOverhead',
          'costPerStudent',
        ],
        notes:
          'kku-finance.v1: tuition revenue from Oracle (HAVING >= 5 students); budget allocation from MSSQL ERPPowerBI.BudgetData. ' +
          'Cost-allocated FinancialMetric columns are owned by the cost-allocation methodology layer — never written by this connector.',
      },
    };
  }
}

function tupleKey(row: {
  FACULTY_NAME: string;
  PROGRAM_NAME: string;
  PROGRAM_LEVEL: string | null;
  MAJOR: string | null;
  COHORT_YEAR_BE: number;
}): string {
  return `${mappingKeyToString(normaliseMappingKey(row))}|${row.COHORT_YEAR_BE}`;
}
