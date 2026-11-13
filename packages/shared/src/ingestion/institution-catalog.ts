import type { SourceCatalogEntry } from './types';

/**
 * Data-source catalogue entries for an institution's own dataset API
 * connectors. Appended to SOURCE_CATALOG, so the seed and
 * `pnpm data-sources:sync` create the DataSource row each connector runs under.
 */
export const INSTITUTION_SOURCES: readonly SourceCatalogEntry[] = [
  // connector:new entries
];
