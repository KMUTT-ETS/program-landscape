import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import {
  finishImportRun,
  findLiveBatchByHash,
  getImportDataset,
  importDatasetStatus,
  listImportBatches,
  listImportDatasets,
  markImportBatchFailed,
  markImportBatchSucceeded,
  prisma,
  readDeclaredTerm,
  recordImportBatch,
  startImportRun,
  startOverDataset,
  validateSheet,
  type ImportBatchView,
  type ImportCellValue,
  type ImportDataset,
  type ImportLoadResult,
  type ImportRow,
  type ImportValidationError,
  type PrefillOptions,
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
  runLoad: (
    dataset: ImportDataset,
    rows: readonly ImportRow[],
    userId: string | null,
    batch: { filename: string; contentHash: string; storageKey: string; fileSize: number },
    /** The period a term-scoped file covers; the loader deletes it first. */
    term?: Readonly<Record<string, ImportCellValue>>,
  ) => Promise<{ batchId: string; result: ImportLoadResult }>;
  startOver: (slug: string) => Promise<{ rowsDeleted: number; batchesCleared: number }>;
  prefill: (dataset: ImportDataset, opts: PrefillOptions) => Promise<readonly ImportRow[]>;
}

export interface ImportUploadResult {
  batchId: string;
  deduplicated: boolean;
  rowCount: number;
  inserted: number;
  updated: number;
  deleted: number;
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

/**
 * A hard ceiling, not a fallback to async. A file above this is a sign the
 * dataset wants splitting — by term, for the term-scoped ones.
 *
 * 5,000 is set by what the loaders can actually finish, not by taste: each
 * does a sequential findUnique + update/create per row inside one
 * transaction with a 120 s timeout. At a realistic 1-2 ms per round-trip,
 * 50,000 rows would need 100-300 s — past that timeout and past most reverse
 * proxies' read timeout, leaving the operator with a hung request and a
 * failed batch. Raise this only together with batched loaders.
 */
export const IMPORT_MAX_ROWS = 5_000;

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
      loadReferences: deps?.loadReferences ?? ((dataset) => this.defaultLoadReferences(dataset)),
      heldCount: deps?.heldCount ?? ((dataset) => dataset.count(prisma)),
      heldCountForTerm:
        deps?.heldCountForTerm ??
        ((dataset, term) =>
          dataset.countForTerm ? dataset.countForTerm(prisma, term) : Promise.resolve(undefined)),
      runLoad: deps?.runLoad ?? ((dataset, rows, userId, batch, term) => this.defaultRunLoad(dataset, rows, userId, batch, term)),
      startOver: deps?.startOver ?? startOverDataset,
      prefill: deps?.prefill ?? ((dataset, opts) => (dataset.prefill ? dataset.prefill(prisma, opts) : Promise.resolve([]))),
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

  /** Resolves the key values each referenced dataset currently holds. */
  private async defaultLoadReferences(dataset: ImportDataset): Promise<Map<string, Set<string>>> {
    const references = new Map<string, Set<string>>();
    const slugs = [...new Set(dataset.columns.flatMap((c) => (c.references ? [c.references.dataset] : [])))];

    for (const slug of slugs) {
      // Tier 0 references are always a `code` column; a later tier that
      // references something else adds its own branch here.
      if (slug === 'faculties') {
        const rows = await prisma.faculty.findMany({ select: { code: true } });
        references.set(slug, new Set(rows.map((r) => r.code)));
      } else if (slug === 'departments') {
        const rows = await prisma.department.findMany({ select: { code: true } });
        references.set(slug, new Set(rows.map((r) => r.code)));
      } else if (slug === 'programmes') {
        const rows = await prisma.program.findMany({ select: { code: true } });
        references.set(slug, new Set(rows.map((r) => r.code)));
      } else if (slug === 'faculty-members') {
        // The first reference that is not a `code` column: staff are named
        // by the employer-assigned code the adopter chose.
        const rows = await prisma.facultyMember.findMany({ select: { employeeCode: true } });
        references.set(slug, new Set(rows.map((r) => r.employeeCode)));
      }
    }
    return references;
  }

  private async defaultRunLoad(
    dataset: ImportDataset,
    rows: readonly ImportRow[],
    userId: string | null,
    batch: { filename: string; contentHash: string; storageKey: string; fileSize: number },
    term?: Readonly<Record<string, ImportCellValue>>,
  ): Promise<{ batchId: string; result: ImportLoadResult }> {
    const { runId } = await startImportRun(dataset.slug, userId);

    let created: { id: string };
    try {
      created = await recordImportBatch({
        datasetSlug: dataset.slug,
        filename: batch.filename,
        contentHash: batch.contentHash,
        storageKey: batch.storageKey,
        fileSize: batch.fileSize,
        rowCount: rows.length,
        uploadedByUserId: userId,
        ingestionRunId: runId,
      });
    } catch (e) {
      // Without this the run is left RUNNING forever, counted by the data
      // source dashboard and by the readiness green-history gate.
      const message = e instanceof Error ? e.message : String(e);
      await this.finishQuietly(runId, rows.length, message);
      throw e;
    }

    try {
      const result = await prisma.$transaction(
        (tx) => dataset.load({ tx, ingestionRunId: runId, term }, rows),
        { timeout: 120_000 },
      );
      // Order matters: the batch becomes SUCCEEDED — and therefore live for
      // dedupe — only once the rows are committed.
      await markImportBatchSucceeded(created.id);
      await finishImportRun(runId, { loaded: rows.length, failed: 0, status: 'SUCCEEDED' });
      return { batchId: created.id, result };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Mark the batch FIRST. If finishImportRun throws (a concurrent
      // start-over may have deleted the run), the batch would otherwise be
      // left LOADING with no record of why.
      await markImportBatchFailed(created.id, message).catch(() => undefined);
      await this.finishQuietly(runId, rows.length, message);
      throw e;
    }
  }

  /** Closes a run on the failure path without masking the original error. */
  private async finishQuietly(runId: string, rowCount: number, message: string): Promise<void> {
    try {
      await finishImportRun(runId, {
        loaded: 0,
        failed: rowCount,
        status: 'FAILED',
        errorMessage: message,
      });
    } catch (e) {
      this.logger.error(`import: could not close run ${runId}: ${String(e)}`);
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

    const [references, heldRowCount] = await Promise.all([
      this.deps.loadReferences(dataset),
      this.deps.heldCount(dataset),
    ]);

    // A term-scoped file is compared against its own term, not the table.
    // The term is read from the file here only to pick that baseline;
    // validateSheet is still what refuses a file whose rows disagree.
    const declaredTerm = readDeclaredTerm(dataset, parsed.parsed);
    const heldRowCountForTerm = declaredTerm
      ? await this.deps.heldCountForTerm(dataset, declaredTerm)
      : undefined;

    const validated = validateSheet(dataset, parsed.parsed, {
      references,
      heldRowCount,
      heldRowCountForTerm,
      allowShrink: args.allowShrink,
      maxRows: IMPORT_MAX_ROWS,
    });

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
    }, validated.term ?? undefined);

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
    this.logger.warn(
      `import ${dataset.slug}: start-over by ${userId ?? 'unknown'} — ` +
        `${result.rowsDeleted} rows deleted, ${result.batchesCleared} batches cleared`,
    );
    return result;
  }
}
