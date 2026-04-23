import type {
  ConnectorContext,
  DataSourceInputFormat,
  LoadResult,
  NormalizedRecord,
  RawRecord,
} from '@kku/shared';
import { BaseConnector } from './base-connector';

// Connector kind: MANUAL_ENTRY. Represents sources that have no
// programmatic fetch — analysts type values into an admin form (e.g.,
// Council-confirmed policy decisions, one-off committee resolutions,
// data the university simply tracks manually in spreadsheets).
//
// fetch() always returns an empty array (there is nothing to pull).
// The corresponding DataSource row exists so that provenance still
// resolves cleanly, and so manual entries can be audit-logged against
// "their" source rather than a generic "manual input".
export abstract class ManualEntryConnector extends BaseConnector {
  readonly inputFormat: DataSourceInputFormat = 'JSON';

  fetch(_ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    return Promise.resolve([]);
  }
  transform(_ctx: ConnectorContext, _raw: RawRecord): Promise<NormalizedRecord[]> {
    return Promise.resolve([]);
  }
  load(_ctx: ConnectorContext, _normalized: NormalizedRecord[]): Promise<LoadResult> {
    return Promise.resolve({ recordsFetched: 0, recordsLoaded: 0, recordsFailed: 0 });
  }
}
