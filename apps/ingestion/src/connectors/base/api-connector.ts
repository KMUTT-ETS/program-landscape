import type { DataSourceInputFormat } from '@kku/shared';
import { BaseConnector } from './base-connector';

// Connector kind: API. Hits an HTTP/JSON endpoint. Default inputFormat
// is JSON; subclasses that pull XML or XLSX via an API override.
//
// Real connectors here should:
//   - use `this.baseUrl` (threaded via ctx.dataSource.baseUrl) rather
//     than hard-coding the URL
//   - respect `since` to pass an Updated-After / If-Modified-Since
//     parameter when the upstream supports it
//   - write pagination state to the IngestionRun `metadata` JSON so the
//     admin UI shows progress
//
// Mocks simply return a small batch of sample records regardless of `since`.
export abstract class ApiConnector extends BaseConnector {
  readonly inputFormat: DataSourceInputFormat = 'JSON';
}
