/** One check `pnpm connector:verify` runs, in the order it runs them. */
export type CheckId =
  | 'registered'
  | 'env'
  | 'sources'
  | 'latest-run'
  | 'provenance'
  | 'visible'
  | 'reaches-programme';

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

/**
 * One line of the report. `reason` and `next` carry names and counts only —
 * never env values or row values.
 */
export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  /** Set for the per-dataset checks (provenance, visible, reaches-programme). */
  dataset?: string;
  reason: string;
  /** The command or action that moves this check forward. */
  next?: string;
}

export interface RunSummary {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  startedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  recordsFetched: number;
  recordsLoaded: number;
  recordsFailed: number;
  metadata: unknown;
}

export interface RowCounts {
  /** Rows carrying the import run's id. */
  stamped: number;
  /** Of those, rows `realDataWhere()` lets through. */
  visible: number;
  /** Of those, rows linked to a programme or faculty; null when the dataset has no such key. */
  linked: number | null;
}

/** Everything `connector:verify` reads from the database. Read-only. */
export interface VerifyReader {
  dataSources(
    slugs: readonly string[],
  ): Promise<ReadonlyArray<{ slug: string; mocked: boolean; baseUrl: string | null }>>;
  latestRun(sourceSlug: string): Promise<RunSummary | null>;
  /** Null when there is no visibility check for this dataset yet. */
  rowCounts(dataset: string, importRunId: string): Promise<RowCounts | null>;
}

/** A dataset API connector resolved from the registry. */
export interface VerifyTarget {
  slug: string;
  datasets: readonly string[];
}
