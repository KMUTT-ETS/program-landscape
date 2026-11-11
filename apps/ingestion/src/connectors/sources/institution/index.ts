import type { ConnectorEntry } from '../../registry';

/**
 * Connectors an institution adds to fill import datasets from its own API.
 * Each entry is `datasetApiEntry('<slug>', () => new MyConnector())`.
 */
export const INSTITUTION_CONNECTORS: readonly ConnectorEntry[] = [
  // connector:new entries
];
