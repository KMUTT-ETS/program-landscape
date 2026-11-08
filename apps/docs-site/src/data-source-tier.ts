import * as catalogNamespace from '../../../packages/shared/src/ingestion/catalog';

/**
 * packages/shared is a CommonJS package. Vite (the site build, Vitest) exposes its exports by name,
 * while tsx running check-site.ts as ESM puts them all on `default`. Accept either shape.
 */
type CatalogModule = typeof catalogNamespace;
const catalog: CatalogModule =
  (catalogNamespace as unknown as { default?: CatalogModule }).default ?? catalogNamespace;

/** How an adopting institution relates to a data source. */
export type DataSourceTier = 'public' | 'institution' | 'deprecated';

/**
 * Read from the source catalogue, so the site and the ingestion registry never disagree.
 * A spec with no catalogue entry counts as public: it must still appear in the sidebar.
 */
export function dataSourceTier(slug: string): DataSourceTier {
  if (catalog.getCatalogEntry(slug)?.deprecated === true) return 'deprecated';
  if (catalog.isKkuExample(slug)) return 'institution';
  return 'public';
}
