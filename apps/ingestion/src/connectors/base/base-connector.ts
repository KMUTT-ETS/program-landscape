import type {
  Connector,
  ConnectorContext,
  DataSourceInputFormat,
  HealthStatus,
  LoadResult,
  NormalizedRecord,
  RawRecord,
} from '@kku/shared';

// Abstract root for every connector. Subclasses override one or more of
// healthCheck / fetch / transform / load. The `kind` axis (below) adds
// behaviour you'd otherwise have to rewrite per connector (e.g., PDF
// connectors' load() shouldn't touch domain tables — it should route the
// bytes to the PDF intake pipeline).
//
// The ingestion runner invokes the lifecycle in order:
//   healthCheck → fetch(since) → transform(...) per record → load([...])
//
// If any step throws, the runner writes a FAILED IngestionRun row with
// the error message + stack, and BullMQ's retry policy (3 attempts,
// exponential backoff) kicks in. Deterministic failures (ValidationError,
// SchemaError) should NOT retry — subclasses throw NonRetryable to
// short-circuit.
export abstract class BaseConnector implements Connector {
  abstract readonly slug: string;
  abstract readonly mocked: boolean;
  abstract readonly inputFormat: DataSourceInputFormat;

  // Default health check for connectors that don't override it — returns
  // ok. Subclasses that hit a real HTTP endpoint should do so here.
  healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    return Promise.resolve({ ok: true, message: this.mocked ? 'mocked' : 'no health check implemented' });
  }

  abstract fetch(ctx: ConnectorContext, since?: Date): Promise<RawRecord[]>;
  abstract transform(ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]>;
  abstract load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult>;
}

// Thrown by a connector when the failure is deterministic (bad schema,
// validation error, auth permanently broken) and retrying would just
// waste time. The runner catches this and marks FAILED without calling
// BullMQ's retry machinery.
export class NonRetryableError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'NonRetryableError';
  }
}
