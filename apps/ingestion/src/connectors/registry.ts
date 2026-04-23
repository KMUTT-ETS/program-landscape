import type { Connector } from '@kku/shared';

import {
  DigitalTranscriptConnector,
  JobThaiConnector,
  JobsDbConnector,
  KkuAlumniConnector,
  KkuFinanceConnector,
  KkuHrConnector,
  KkuRegistryConnector,
  KkuResearchConnector,
  MhesiCisaConnector,
  OpenAlexConnector,
  ScopusConnector,
  WorldBankConnector,
} from './sources/kku-connectors';
import {
  AdbGmsConnector,
  BoiSectoralConnector,
  EecoReportConnector,
  MhesiPolicyConnector,
  NesdcReportConnector,
  NsoConnector,
  NxpoReportConnector,
  OecdReportConnector,
  TcasConnector,
  TpqiConnector,
  WefFutureOfJobsConnector,
} from './sources/pdf-connectors';
import { PeerProgramScraperConnector } from './sources/scrape-connectors';

// Process-wide connector registry. Keys match DataSource.slug + the
// catalog entries in @kku/shared/ingestion/catalog.ts. If you add a
// connector, you MUST:
//   1. Add a SourceCatalogEntry in @kku/shared
//   2. Add the connector class in sources/
//   3. Register it here
// Otherwise either the DB seed won't create a DataSource row, or the
// runner won't find a connector to invoke — both surface as runtime
// errors the moment the admin page loads.

export function buildRegistry(): Map<string, Connector> {
  const connectors: Connector[] = [
    // Internal KKU
    new KkuRegistryConnector(),
    new KkuFinanceConnector(),
    new KkuHrConnector(),
    new KkuAlumniConnector(),
    new KkuResearchConnector(),
    new DigitalTranscriptConnector(),
    // National Thai (API)
    new MhesiCisaConnector(),
    new JobThaiConnector(),
    new JobsDbConnector(),
    // National Thai (PDF)
    new NsoConnector(),
    new TcasConnector(),
    new TpqiConnector(),
    new MhesiPolicyConnector(),
    new NesdcReportConnector(),
    new NxpoReportConnector(),
    new BoiSectoralConnector(),
    new EecoReportConnector(),
    // International
    new WefFutureOfJobsConnector(),
    new OecdReportConnector(),
    new WorldBankConnector(),
    new AdbGmsConnector(),
    new ScopusConnector(),
    new OpenAlexConnector(),
    // Scrape
    new PeerProgramScraperConnector(),
  ];

  const map = new Map<string, Connector>();
  for (const c of connectors) {
    if (map.has(c.slug)) {
      throw new Error(`Duplicate connector slug "${c.slug}" — every connector must have a unique slug matching SOURCE_CATALOG.`);
    }
    map.set(c.slug, c);
  }
  return map;
}
