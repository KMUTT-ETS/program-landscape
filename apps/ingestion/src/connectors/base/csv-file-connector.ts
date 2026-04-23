import type { DataSourceInputFormat } from '@kku/shared';
import { BaseConnector } from './base-connector';

// Connector kind: CSV_FILE. For manual uploads of CSV/XLSX (NSO tables,
// registrar exports, cost-allocation worksheets). The file lives in
// MinIO under the `csv-uploads` bucket — this connector's fetch()
// enumerates unprocessed files, transform() parses rows, load() writes
// to the target table.
//
// Not wired to a real bucket yet; the mocks return inline fixture rows.
export abstract class CsvFileConnector extends BaseConnector {
  readonly inputFormat: DataSourceInputFormat = 'CSV';
}
