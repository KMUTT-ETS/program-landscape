import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import {
  findLiveBatchByHash,
  getImportDataset,
  importDatasetStatus,
  listImportBatches,
  IMPORT_MAX_ROWS,
  listImportDatasets,
  loadImportReferences,
  METRIC_VIEW_DATASETS,
  prepareImportRows,
  readDeclaredScopes,
  runImportLoad,
  prisma,
  refreshMetricViews,
  startOverAllImports,
  startOverDataset,
  type ImportBatchView,
  type ImportCellValue,
  type ImportDataset,
  type ImportLoadResult,
  type ImportRow,
  type ImportValidationError,
  type PrefillOptions,
  type StartOverAllResult,
} from '@kku/db';
import { ApiError, S3Storage } from '@kku/shared';

import { parseImportWorkbook } from './parse';
import { buildImportTemplate, importTemplateFilename } from './template';

// ─────────────────────────────────────────────────────────────────────────────
// Spreadsheet import.
//
// Validation is synchronous because the operator is standing there watching:
// accepting a wrong-columns file and failing asynchronously would send them
// to a job log. Loading is synchronous too — nothing in scope is large
// enough to need a queue, and a worker would add a polling UI and a whole
// class of "died after the response returned" failures for no gain.
// ─────────────────────────────────────────────────────────────────────────────

/** Collaborators, injected so the unit tests need no database and no MinIO. */
export interface ImportServiceDeps {
  findLiveBatchByHash: (slug: string, hash: string) => Promise<{ id: string; rowCount: number } | null>;
  putObject: (args: { bucket: string; key: string; body: Buffer; contentType: string }) => Promise<void>;
  loadReferences: (dataset: ImportDataset) => Promise<Map<string, Set<string>>>;
  heldCount: (dataset: ImportDataset) => Promise<number>;
  /** Rows held for one term; undefined unless the dataset is term-scoped. */
  heldCountForTerm: (
    dataset: ImportDataset,
    term: Readonly<Record<string, ImportCellValue>>,
  ) => Promise<number | undefined>;
  /** Rows held for the scopes a file names; undefined unless programme-scoped. */
  heldCountForScope: (
    dataset: ImportDataset,
    scopes: readonly Readonly<Record<string, ImportCellValue>>[],
  ) => Promise<number | undefined>;
  runLoad: (
    dataset: ImportDataset,
    rows: readonly ImportRow[],
    userId: string | null,
    batch: { filename: string; contentHash: string; storageKey: string; fileSize: number },
    /** The period a term-scoped file covers; the loader deletes it first. */
    term?: Readonly<Record<string, ImportCellValue>>,
    /** The programmes a programme-scoped file covers; recorded on the run. */
    scopes?: readonly Readonly<Record<string, ImportCellValue>>[],
  ) => Promise<{ batchId: string; result: ImportLoadResult }>;
  startOver: (slug: string) => Promise<{ rowsDeleted: number; batchesCleared: number }>;
  /** Empties every import in one transaction; returns the stored-file keys to delete. */
  startOverAll: () => Promise<StartOverAllResult>;
  deleteObject: (bucket: string, key: string) => Promise<void>;
  /** The organisation's full and short English names; empty before setup. */
  organizationNames: () => Promise<string[]>;
  prefill: (dataset: ImportDataset, opts: PrefillOptions) => Promise<readonly ImportRow[]>;
  /** Refreshes the scope roll-up materialised views. */
  refreshViews: () => Promise<void>;
}

export interface StartOverAllSummary {
  datasets: { slug: string; title: string; rowsDeleted: number }[];
  rowsDeleted: number;
  batchesDeleted: number;
  filesDeleted: number;
  filesFailed: number;
}

export interface ImportUploadResult {
  batchId: string;
  deduplicated: boolean;
  rowCount: number;
  inserted: number;
  updated: number;
  deleted: number;
  unresolved?: number;
}

export interface ImportDatasetSummary {
  slug: string;
  title: string;
  description: string;
  tier: 0 | 1 | 2;
  rowCount: number;
  lastUpload: Date | null;
  batchCount: number;
}

export interface ImportDatasetDetail extends ImportDatasetSummary {
  sheetName: string;
  columns: {
    header: string;
    required: boolean;
    type: string;
    guide: string;
    example: string;
    enumValues: readonly string[] | null;
  }[];
  keyColumns: string[];
  dependents: readonly string[];
  batches: ImportBatchView[];
}

/** Matches JOBTHAI_MAX_UPLOAD_BYTES: generous without inviting a year's dump. */
export const IMPORT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export { IMPORT_MAX_ROWS };

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Injectable()
export class ImportService implements OnModuleInit {
  private readonly logger = new Logger(ImportService.name);
  private storage?: S3Storage;
  private bucket = 'csv-uploads';
  private readonly deps: ImportServiceDeps;

  constructor(
    @Optional() private readonly config?: ConfigService,
    // @Optional() is load-bearing: without it Nest tries to RESOLVE this test
    // seam as a provider and the whole app fails to boot. The unit tests
    // construct the service directly, so they never exercise the injector and
    // cannot catch it.
    @Optional() deps?: Partial<ImportServiceDeps>,
  ) {
    this.deps = {
      findLiveBatchByHash: deps?.findLiveBatchByHash ?? findLiveBatchByHash,
      putObject:
        deps?.putObject ??
        ((a) => {
          if (!this.storage) throw new Error('ImportService storage not initialised');
          const storage = this.storage;
          return storage.ensureBucket(a.bucket).then(() => storage.putObject(a)).then(() => undefined);
        }),
      loadReferences: deps?.loadReferences ?? loadImportReferences,
      heldCount: deps?.heldCount ?? ((dataset) => dataset.count(prisma)),
      heldCountForTerm:
        deps?.heldCountForTerm ??
        ((dataset, term) =>
          dataset.countForTerm ? dataset.countForTerm(prisma, term) : Promise.resolve(undefined)),
      heldCountForScope:
        deps?.heldCountForScope ??
        ((dataset, scopes) =>
          dataset.countForScope ? dataset.countForScope(prisma, scopes) : Promise.resolve(undefined)),
      runLoad:
        deps?.runLoad ??
        (async (dataset, rows, userId, batch, term, scopes) => {
          const { batchId, result } = await runImportLoad(dataset, rows, { via: 'upload', userId, batch }, term, scopes);
          return { batchId, result };
        }),
      startOver: deps?.startOver ?? startOverDataset,
      startOverAll: deps?.startOverAll ?? (() => startOverAllImports()),
      deleteObject:
        deps?.deleteObject ??
        ((bucket, key) => {
          if (!this.storage) throw new Error('ImportService storage not initialised');
          return this.storage.deleteObject(bucket, key);
        }),
      organizationNames:
        deps?.organizationNames ??
        (async () => {
          const org = await prisma.organizationProfile.findUnique({
            where: { id: 'default' },
            select: { nameEn: true, shortNameEn: true },
          });
          return org ? [org.nameEn, org.shortNameEn].filter((n) => n.trim().length > 0) : [];
        }),
      prefill: deps?.prefill ?? ((dataset, opts) => (dataset.prefill ? dataset.prefill(prisma, opts) : Promise.resolve([]))),
      refreshViews: deps?.refreshViews ?? (async () => { await refreshMetricViews({ trigger: 'on-import' }); }),
    };
  }

  onModuleInit(): void {
    if (!this.config) return;
    this.storage = new S3Storage({
      endpoint: this.required('MINIO_ENDPOINT'),
      region: this.config.get<string>('MINIO_REGION') ?? 'us-east-1',
      accessKeyId: this.required('MINIO_ACCESS_KEY'),
      secretAccessKey: this.required('MINIO_SECRET_KEY'),
      publicEndpoint: this.config.get<string>('MINIO_PUBLIC_ENDPOINT') || undefined,
    });
    this.bucket = this.config.get<string>('MINIO_BUCKET_CSV_UPLOADS') ?? 'csv-uploads';
  }

  private required(key: string): string {
    const value = this.config?.get<string>(key);
    if (!value) throw new Error(`${key} is not configured`);
    return value;
  }

  /**
   * The scope roll-ups (program, department, faculty, university) are
   * materialised views over these tables, and nothing else refreshes them
   * for an adopter: without this a first upload succeeds and every program
   * score that reads a roll-up (net contribution per student, enrolment
   * trend) stays empty until someone runs `pnpm outcomes:refresh-derived`.
   * Best-effort: the rows are already committed, so a failed refresh must
   * not turn a good upload into an error.
   */
  private async refreshViewsQuietly(slug: string): Promise<void> {
    if (!METRIC_VIEW_DATASETS.has(slug)) return;
    try {
      await this.deps.refreshViews();
    } catch (e) {
      this.logger.warn(`import ${slug}: metric view refresh failed (run pnpm outcomes:refresh-derived): ${String(e)}`);
    }
  }

  async uploadFile(args: {
    datasetSlug: string;
    originalFilename: string;
    bytes: Buffer;
    uploadedByUserId: string | null;
    allowShrink: boolean;
  }): Promise<ImportUploadResult> {
    const dataset = getImportDataset(args.datasetSlug);

    const ext = (args.originalFilename.split('.').pop() ?? '').toLowerCase();
    if (ext !== 'xlsx') {
      throw new ApiError(
        'VALIDATION_FAILED',
        `Unsupported file type ".${ext || '(none)'}". Uploads must be .xlsx — download the template to start from.`,
      );
    }
    if (args.bytes.length < 4) throw new ApiError('VALIDATION_FAILED', 'Uploaded file is empty.');
    if (args.bytes.length > IMPORT_MAX_UPLOAD_BYTES) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `File exceeds the ${IMPORT_MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`,
      );
    }

    const parsed = parseImportWorkbook(args.bytes, dataset.sheetName);
    if (!parsed.ok) throw new ApiError('VALIDATION_FAILED', parsed.error);

    const declaredScopes = readDeclaredScopes(dataset, parsed.parsed) ?? undefined;
    const validated = await prepareImportRows(
      dataset,
      parsed.parsed,
      { allowShrink: args.allowShrink, maxRows: IMPORT_MAX_ROWS },
      {
        loadReferences: this.deps.loadReferences,
        heldCount: this.deps.heldCount,
        heldCountForTerm: this.deps.heldCountForTerm,
        heldCountForScope: this.deps.heldCountForScope,
      },
    );

    if (!validated.ok) {
      // Nothing is stored and no run is created: a refused file leaves no trace.
      throw new ApiError(
        'VALIDATION_FAILED',
        this.summariseErrors(validated.errors, validated.totalErrors),
        { errors: validated.errors, totalErrors: validated.totalErrors },
      );
    }

    const contentHash = createHash('sha256').update(args.bytes).digest('hex');
    const existing = await this.deps.findLiveBatchByHash(dataset.slug, contentHash);
    if (existing) {
      return {
        batchId: existing.id,
        deduplicated: true,
        rowCount: existing.rowCount,
        inserted: 0,
        updated: 0,
        deleted: 0,
      };
    }

    const storageKey = `imports/${dataset.slug}/${contentHash}.xlsx`;
    await this.deps.putObject({
      bucket: this.bucket,
      key: storageKey,
      body: args.bytes,
      contentType: XLSX_CONTENT_TYPE,
    });

    const { batchId, result } = await this.deps.runLoad(dataset, validated.rows, args.uploadedByUserId, {
      filename: args.originalFilename,
      contentHash,
      storageKey,
      fileSize: args.bytes.byteLength,
    }, validated.term ?? undefined, declaredScopes);
    // Fire-and-forget, as before: the rows are committed, the refresh is best-effort.
    void this.refreshViewsQuietly(dataset.slug);

    this.logger.log(
      `import ${dataset.slug}: batch ${batchId}, ${validated.rows.length} rows ` +
        `(+${result.inserted} ~${result.updated} -${result.deleted})`,
    );

    return {
      batchId,
      deduplicated: false,
      rowCount: validated.rows.length,
      inserted: result.inserted,
      updated: result.updated,
      deleted: result.deleted,
      ...(result.unresolved !== undefined ? { unresolved: result.unresolved } : {}),
    };
  }

  private summariseErrors(errors: readonly ImportValidationError[], total: number): string {
    const first = errors[0];
    const head = total === 1 ? '1 problem' : `${total} problems`;
    if (!first) return `${head} in this file.`;
    const where = first.row === 0 ? 'this file' : `row ${first.row}${first.column ? `, ${first.column}` : ''}`;
    const more = total > errors.length ? ` (showing the first ${errors.length})` : '';
    return `${head} in this file${more}. First: ${where} — ${first.message}`;
  }

  async getTemplate(datasetSlug: string, opts: PrefillOptions): Promise<{ filename: string; bytes: Buffer }> {
    const dataset = getImportDataset(datasetSlug);
    const rows = await this.deps.prefill(dataset, opts);
    return {
      filename: importTemplateFilename(dataset, new Date()),
      bytes: buildImportTemplate(dataset, rows),
    };
  }

  async listDatasets(): Promise<ImportDatasetSummary[]> {
    const datasets = listImportDatasets();
    return Promise.all(
      datasets.map(async (d) => {
        const status = await importDatasetStatus(d.slug);
        return {
          slug: d.slug,
          title: d.title,
          description: d.description,
          tier: d.tier,
          rowCount: status.rowCount,
          lastUpload: status.lastUpload,
          batchCount: status.batchCount,
        };
      }),
    );
  }

  async getDataset(datasetSlug: string): Promise<ImportDatasetDetail> {
    const dataset = getImportDataset(datasetSlug);
    const byKey = new Map(dataset.columns.map((c) => [c.key, c.header]));
    const [status, batches] = await Promise.all([
      importDatasetStatus(dataset.slug),
      listImportBatches(dataset.slug),
    ]);

    return {
      slug: dataset.slug,
      title: dataset.title,
      description: dataset.description,
      tier: dataset.tier,
      rowCount: status.rowCount,
      lastUpload: status.lastUpload,
      batchCount: status.batchCount,
      sheetName: dataset.sheetName,
      columns: dataset.columns.map((c) => ({
        header: c.header,
        required: c.required,
        type: c.type,
        guide: c.guide,
        example: c.example,
        enumValues: c.enumValues ?? null,
      })),
      keyColumns: dataset.strategy.match.columns.map((k) => byKey.get(k) ?? k),
      dependents: dataset.dependents ?? [],
      batches,
    };
  }

  async startOver(
    datasetSlug: string,
    confirmName: string,
    userId: string | null,
  ): Promise<{ rowsDeleted: number; batchesCleared: number }> {
    const dataset = getImportDataset(datasetSlug);
    if (confirmName.trim() !== dataset.title) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `Type the dataset name exactly ("${dataset.title}") to confirm clearing it.`,
      );
    }
    const result = await this.deps.startOver(dataset.slug);
    // Clearing a metric dataset leaves deleted rows in the roll-ups otherwise.
    void this.refreshViewsQuietly(dataset.slug);
    this.logger.warn(
      `import ${dataset.slug}: start-over by ${userId ?? 'unknown'} — ` +
        `${result.rowsDeleted} rows deleted, ${result.batchesCleared} batches cleared`,
    );
    return result;
  }
  /**
   * Empties every spreadsheet import: rows, upload history and stored files.
   * Confirmed by typing the organisation's name, since there is no single
   * dataset title to type. Files go only after the database has committed —
   * a file without its row is harmless, a row without its file is not — and
   * a file that will not delete is counted and logged, not fatal.
   */
  async startOverAll(confirmName: string, userId: string | null): Promise<StartOverAllSummary> {
    const names = await this.deps.organizationNames();
    if (names.length === 0) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'Set up the organization profile before starting over — its name is what you type to confirm.',
      );
    }
    const typed = confirmName.trim();
    if (!names.some((n) => n.trim() === typed)) {
      const shortest = [...names].sort((a, b) => a.length - b.length)[0];
      throw new ApiError(
        'VALIDATION_FAILED',
        `Type the organization's name exactly ("${shortest}") to confirm deleting all uploaded data.`,
      );
    }

    const result = await this.deps.startOverAll();

    let filesDeleted = 0;
    let filesFailed = 0;
    for (const key of result.storageKeys) {
      try {
        await this.deps.deleteObject(this.bucket, key);
        filesDeleted += 1;
      } catch (e) {
        filesFailed += 1;
        this.logger.warn(`import start-over-all: could not delete stored file ${key}: ${String(e)}`);
      }
    }

    try {
      await this.deps.refreshViews();
    } catch (e) {
      this.logger.warn(`import start-over-all: metric view refresh failed (run pnpm outcomes:refresh-derived): ${String(e)}`);
    }

    const rowsDeleted = result.datasets.reduce((sum, d) => sum + d.rowsDeleted, 0);
    this.logger.warn(
      `import start-over-all by ${userId ?? 'unknown'} — ${rowsDeleted} rows, ` +
        `${result.batchesDeleted} uploads, ${filesDeleted} files deleted (${filesFailed} failed)`,
    );
    return {
      datasets: result.datasets,
      rowsDeleted,
      batchesDeleted: result.batchesDeleted,
      filesDeleted,
      filesFailed,
    };
  }
}
