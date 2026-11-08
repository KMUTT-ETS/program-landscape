import { z } from 'zod';
import { DataSourceKindSchema, type DataSourceDto } from '../api/schemas';

// ──────────────────────────────────────────────────────────────────────────
// Mirror of Prisma enums. Shared here so consumers outside the db package
// don't have to pull in @prisma/client. DataSourceKindSchema lives in
// api/schemas.ts and is re-used here — keep in sync with the Prisma
// `DataSourceKind` enum.
// ──────────────────────────────────────────────────────────────────────────

export type DataSourceKind = z.infer<typeof DataSourceKindSchema>;

// Extended admin DTO — adds the fields introduced in prompt 03 to the
// existing DataSourceDto from api/schemas.ts. The admin UI consumes this.
export interface DataSourceAdminDto extends DataSourceDto {
  slug: string;
  inputFormat: DataSourceInputFormat;
  cadenceCron: string | null;
  scheduleEnabled: boolean;
  ownerContact: string | null;
}

export const DataSourceInputFormatSchema = z.enum([
  'JSON',
  'CSV',
  'XML',
  'HTML',
  'PDF',
  'XLSX',
  'MIXED',
]);
export type DataSourceInputFormat = z.infer<typeof DataSourceInputFormatSchema>;

export const IngestionRunTriggerSchema = z.enum(['SCHEDULED', 'MANUAL', 'BACKFILL']);
export type IngestionRunTrigger = z.infer<typeof IngestionRunTriggerSchema>;

export const IngestionRunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
]);
export type IngestionRunStatus = z.infer<typeof IngestionRunStatusSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Source catalog entry — the SOURCE_CATALOG list in catalog.ts is typed
// against this shape. Seed + connector registry both read from it so the
// DB rows, the connector classes, and docs/data-sources.md stay aligned.
// ──────────────────────────────────────────────────────────────────────────

export interface SourceCatalogEntry {
  // Stable, lowercase-kebab identifier. DataSource.slug matches this.
  // Connectors key off this at boot — don't rename without migration.
  slug: string;
  name: string;
  kind: DataSourceKind;
  inputFormat: DataSourceInputFormat;
  baseUrl?: string;
  // Standard 5-field cron — honoured by the BullMQ scheduler when
  // scheduleEnabled is true. Null/undefined = manual-only.
  cadenceCron?: string;
  scheduleEnabled?: boolean;
  acceptsPdfUploads?: boolean;
  ownerContact?: string;
  notes?: string;
  // True when the connector is a stub returning sample data. Flip to
  // false only when the connector actually hits the real source. The
  // admin UI shows a "mocked" badge to make it obvious to operators.
  mocked: boolean;
  // True when the source is being phased out — kept in the catalog so
  // historical IngestionRun rows don't orphan, but the registry skips
  // scheduling it. Removal happens after the replacement source has
  // 30 days of green history (per docs/readiness-checklist.md gate 11).
  deprecated?: boolean;
  // True for connectors that only work against KKU's internal systems;
  // they are examples for an adopting university, not defaults.
  kkuExample?: boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// Connector runtime contract. Implemented by every concrete connector in
// apps/ingestion/src/connectors/. The runner in apps/ingestion invokes
// these in order: healthCheck → fetch → transform → load.
// ──────────────────────────────────────────────────────────────────────────

export interface HealthStatus {
  ok: boolean;
  message?: string;
  latencyMs?: number;
}

export interface RawRecord {
  // Connector-local stable id for the raw record. Used for dedup on
  // re-runs. Real connectors use the upstream id; mocks use a hash.
  externalId: string;
  // Raw payload — shape is connector-specific.
  data: unknown;
  // When the record was created/updated upstream. Falls back to the
  // fetch time if the source doesn't provide one.
  sourceTimestamp: Date;
}

export interface NormalizedRecord {
  // Target table + primary key inside our schema (e.g., "programs",
  // "policy_documents"). The loader uses this to dispatch to the right
  // Prisma model.
  target: string;
  externalId: string;
  payload: Record<string, unknown>;
  // When the data was observed by the upstream source (not when we
  // fetched it). Used to populate freshnessDate on metric rows.
  freshnessDate: Date;
  // For PDF-routed connectors: the PdfDocument.id the record came from.
  // Undefined for non-PDF connectors.
  sourcePdfId?: string;
}

export interface LoadResult {
  recordsFetched: number;
  recordsLoaded: number;
  recordsFailed: number;
  // Connector-specific metadata — counts per sub-type, sample IDs,
  // diagnostic info. Rendered as a JSON tree in the admin UI.
  metadata?: Record<string, unknown>;
  // For PDF-flagged connectors: the PdfDocument row they created, so
  // the IngestionRun row can cross-reference.
  pdfDocumentId?: string;
}

export interface ConnectorContext {
  // The IngestionRun row this invocation runs under — connectors that
  // tag persisted rows with `ingestion_run_id` read this value. Always
  // present (the runner creates the row before invoking the connector).
  runId: string;
  // The DataSource row matched by slug at boot — the runner hands this
  // to every step in case the connector needs baseUrl / notes / etc.
  dataSource: {
    id: string;
    slug: string;
    name: string;
    baseUrl: string | null;
    lastSyncedAt: Date | null;
  };
  // Logger the connector should write to instead of console. Writes are
  // routed to the ingestion service's structured log + the runner
  // surfaces errors in the IngestionRun row.
  log: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface Connector {
  readonly slug: string;
  readonly mocked: boolean;
  readonly inputFormat: DataSourceInputFormat;
  healthCheck(ctx: ConnectorContext): Promise<HealthStatus>;
  // `since` is lastSyncedAt from the DataSource row — connectors should
  // fetch only records updated since then when the upstream supports it.
  // Mocks ignore `since` and return a fresh small batch.
  fetch(ctx: ConnectorContext, since?: Date): Promise<RawRecord[]>;
  transform(ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]>;
  load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult>;
}

// ──────────────────────────────────────────────────────────────────────────
// Provenance — returned by getProvenance() and consumed by both the
// in-app drawer and the PDF provenance appendix.
// ──────────────────────────────────────────────────────────────────────────

export interface ProvenanceEntry {
  sourceId: string;
  sourceSlug: string;
  sourceName: string;
  freshnessDate: Date | null;
  lastSyncedAt: Date | null;
  sourcePdfId: string | null;
  methodologyVersion: string | null;
}
