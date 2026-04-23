import type {
  ConnectorContext,
  LoadResult,
  NormalizedRecord,
  RawRecord,
} from '@kku/shared';
import { WebScrapeConnector } from '../base';

// ────────────────────────────────────────────────────────────────────────────
// Web-scrape connectors — mocked.
//
// Real wiring uses Playwright inside the ingestion container for JS-heavy
// sites; plain fetch + cheerio for static HTML. Respect robots.txt and
// stick to public catalogue pages. Downloaded brochure PDFs are routed
// through PDF intake by enqueueing a separate PdfUploadConnector job.
// ────────────────────────────────────────────────────────────────────────────

export class PeerProgramScraperConnector extends WebScrapeConnector {
  readonly slug = 'peer-programs-scraper';
  readonly mocked = true;

  async fetch(_c: ConnectorContext): Promise<RawRecord[]> {
    return [
      {
        externalId: 'PEER-CU-ENG-CE',
        sourceTimestamp: new Date('2026-04-15'),
        data: {
          university: 'Chulalongkorn University',
          programNameTh: 'วิศวกรรมคอมพิวเตอร์',
          programNameEn: 'Computer Engineering',
          level: 'BACHELOR',
          durationYears: 4,
          catalogueUrl: 'https://example.chula.ac.th/programs/computer-engineering',
          brochurePdfUrl: 'https://example.chula.ac.th/programs/computer-engineering/brochure.pdf',
        },
      },
    ];
  }

  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [
      {
        target: 'peer_programs',
        externalId: raw.externalId,
        payload: raw.data as Record<string, unknown>,
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return {
      recordsFetched: n.length,
      recordsLoaded: n.length,
      recordsFailed: 0,
      metadata: { note: 'mocked; real impl enqueues a PDF job per brochurePdfUrl' },
    };
  }
}
