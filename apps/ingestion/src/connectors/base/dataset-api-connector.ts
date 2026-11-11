import {
  IMPORT_DATASETS,
  IMPORT_MAX_ROWS,
  prepareImportRows,
  readDeclaredScopes,
  readDeclaredTerm,
  refreshMetricViewsIfNeeded,
  runImportLoad,
  type ImportDataset,
  type ParsedSheet,
} from '@kku/db';
import type {
  Connector,
  ConnectorContext,
  LoadResult,
  NormalizedRecord,
  RawRecord,
} from '@kku/shared';

import { ApiClient, connectorEnv } from './api-client';
import { ApiConnector } from './api-connector';
import { NonRetryableError } from './base-connector';
import type { ConnectorEntry } from '../registry';

/** Dataset slug → rows keyed by the dataset template's header text. */
export type DatasetRows = Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;

/** Hard ceiling for CONNECTOR_<SLUG>_MAX_ROWS. */
const MAX_ROWS_CEILING = 100_000;
const MAX_REPORTED_ERRORS = 100;

type DatasetStatus = 'LOADED' | 'REFUSED' | 'NOT_RUN';

interface DatasetOutcome {
  importRunId?: string;
  rows: number;
  inserted: number;
  updated: number;
  deleted: number;
  status: DatasetStatus;
}

interface ReportedError {
  dataset: string;
  record: number;
  column: string | null;
  message: string;
}

/**
 * Validation messages quote the offending cell ("abc" is not a number). A
 * connector's run metadata must never carry source values, so every quoted
 * span is blanked; the column name and record number say where to look.
 */
function redactValues(message: string): string {
  return message.replace(/"[^"]*"/g, '"…"');
}

/**
 * Base class for connectors that fill spreadsheet-import datasets from an
 * institution's own HTTP/JSON API. A subclass writes `fetchAll` (talk to the
 * API) and `toRows` (map records onto dataset rows); validation and loading
 * reuse the upload pipeline, so an API load obeys every rule an upload does.
 */
export abstract class DatasetApiConnector extends ApiConnector {
  readonly mocked = false;
  abstract override readonly slug: string;
  abstract readonly displayName: string;
  /** Slugs of the import datasets this connector may fill. */
  abstract readonly datasets: readonly string[];

  private records: readonly unknown[] = [];

  protected abstract fetchAll(ctx: ConnectorContext, api: ApiClient): Promise<readonly unknown[]>;
  protected abstract toRows(records: readonly unknown[]): DatasetRows;

  protected createClient(ctx: ConnectorContext): ApiClient {
    return ApiClient.forConnector(ctx, this.slug);
  }

  protected importLimits(): { maxRows: number; allowShrink: boolean } {
    const configured = Number(connectorEnv(this.slug, 'MAX_ROWS'));
    return {
      maxRows: Math.min(configured || IMPORT_MAX_ROWS, MAX_ROWS_CEILING),
      allowShrink: connectorEnv(this.slug, 'ALLOW_SHRINK') === 'true',
    };
  }

  async fetch(ctx: ConnectorContext): Promise<RawRecord[]> {
    const records = await this.fetchAll(ctx, this.createClient(ctx));
    this.records = records;
    const now = new Date();
    return records.map((data, i) => ({ externalId: String(i), data, sourceTimestamp: now }));
  }

  transform(): Promise<NormalizedRecord[]> {
    return Promise.resolve([]);
  }

  async load(ctx: ConnectorContext, _normalized: NormalizedRecord[]): Promise<LoadResult> {
    const records = this.records;
    const byDataset = this.toRows(records);

    // Refuse before touching the database: an undeclared dataset is a bug in
    // the connector, not in the data.
    for (const slug of Object.keys(byDataset)) {
      if (!this.datasets.includes(slug)) {
        throw new NonRetryableError(
          'CONFIG',
          `Connector ${this.slug} produced rows for "${slug}" but declares only: ${this.datasets.join(', ') || '(none)'}.`,
        );
      }
      if (!IMPORT_DATASETS.some((d) => d.slug === slug)) {
        throw new NonRetryableError('CONFIG', `"${slug}" is not an import dataset.`);
      }
    }

    // IMPORT_DATASETS order is dependency order: staff before the grants
    // that name them, whatever order toRows listed them in.
    const ordered: ImportDataset[] = IMPORT_DATASETS.filter((d) => d.slug in byDataset);
    const { maxRows, allowShrink } = this.importLimits();

    const report: Record<string, DatasetOutcome> = {};
    for (const d of ordered) {
      report[d.slug] = {
        rows: byDataset[d.slug]?.length ?? 0,
        inserted: 0,
        updated: 0,
        deleted: 0,
        status: 'NOT_RUN',
      };
    }

    const warnings: string[] = [];
    const errors: ReportedError[] = [];
    let totalErrors = 0;
    let loadedRows = 0;
    let refused: ImportDataset | null = null;

    for (const dataset of ordered) {
      const outcome = report[dataset.slug] as DatasetOutcome;
      const parsed: ParsedSheet = {
        sheetName: dataset.sheetName,
        headers: dataset.columns.map((c) => c.header),
        rows: byDataset[dataset.slug] ?? [],
      };

      const prepared = await prepareImportRows(dataset, parsed, { allowShrink, maxRows });
      if (!prepared.ok) {
        outcome.status = 'REFUSED';
        totalErrors = prepared.totalErrors;
        for (const e of prepared.errors.slice(0, MAX_REPORTED_ERRORS)) {
          errors.push({
            dataset: dataset.slug,
            // Spreadsheet row → 1-based record; row 0 (the whole file) stays 0.
            record: Math.max(e.row - 1, 0),
            column: e.column,
            message: redactValues(e.message),
          });
        }
        refused = dataset;
        break;
      }

      const out = await runImportLoad(
        dataset,
        prepared.rows,
        {
          via: 'api',
          connectorSlug: this.slug,
          connectorName: this.displayName,
          parentRunId: ctx.runId,
        },
        readDeclaredTerm(dataset, parsed) ?? undefined,
        readDeclaredScopes(dataset, parsed) ?? undefined,
      );
      outcome.status = 'LOADED';
      outcome.importRunId = out.runId;
      outcome.inserted = out.result.inserted;
      outcome.updated = out.result.updated;
      outcome.deleted = out.result.deleted;
      loadedRows += prepared.rows.length;
      warnings.push(...out.warnings);

      try {
        await refreshMetricViewsIfNeeded(dataset.slug);
      } catch (e) {
        ctx.log.warn(
          `Metric view refresh after ${dataset.slug} failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const metadata = { datasets: report, warnings, errors, totalErrors };

    if (refused) {
      const first = errors[0];
      throw new NonRetryableError(
        'VALIDATION',
        `${totalErrors} problems in ${refused.title}. First: record ${first?.record ?? 0}, ${first?.column ?? 'whole file'} — ${first?.message ?? ''}`,
        metadata,
      );
    }

    return {
      recordsFetched: records.length,
      recordsLoaded: loadedRows,
      recordsFailed: 0,
      metadata,
    };
  }
}

/** Registry entry for a dataset API connector: no mock, the mock API server plays the upstream. */
export function datasetApiEntry(slug: string, factory: () => Connector): ConnectorEntry {
  return { slug, mock: factory, real: factory };
}
