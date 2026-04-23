import type { DataSourceInputFormat } from '@kku/shared';
import { BaseConnector } from './base-connector';

// Connector kind: WEB_SCRAPE. For sources that don't expose an API —
// peer university program pages, brochure-link aggregators, ministry
// press-release indexes. Real wiring will use Playwright (in the
// ingestion container — headless Chromium) for JS-rendered pages, or
// plain fetch + cheerio for static HTML.
//
// Respect `robots.txt` and the source's terms of service. If a peer
// university says "no automated access," we don't scrape that one —
// we fall back to manual PDF upload (PdfUploadConnector below).
export abstract class WebScrapeConnector extends BaseConnector {
  readonly inputFormat: DataSourceInputFormat = 'HTML';
}
