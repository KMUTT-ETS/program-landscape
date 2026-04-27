import { Logger } from '@nestjs/common';
import type { Connector } from '@kku/shared';
import { resolveConnectorMode } from '@kku/shared';

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
import { KkuRegistryRealConnector } from './sources/kku-registry';
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

// ─────────────────────────────────────────────────────────────────────
// Process-wide connector registry.
//
// Keyed by slug (matches SOURCE_CATALOG in @kku/shared + the DataSource
// row seeded into Postgres). Each connector appears as a pair:
//   - mock (always present; class with `mocked = true`)
//   - real (added during the corresponding prompt-14 mini-session;
//           class with `mocked = false`)
//
// The pair table below is the single place to register a real
// connector. When a real connector lands:
//   1. Rename the existing class → `Mocked<Name>Connector`.
//   2. Add the real `<Name>Connector` class in the same file.
//   3. Add its factory to the `real` slot below.
//   4. Flip env: CONNECTOR_<SLUG>_MODE=real (or global CONNECTOR_MODE=real).
//
// If a slug is configured as `real` but no real implementation is
// registered, the registry logs a loud warn and falls back to the
// mock — the app keeps running, and the admin page surfaces the
// mismatch via DataSource.mocked.
// ─────────────────────────────────────────────────────────────────────

type ConnectorFactory = () => Connector;

interface ConnectorEntry {
  slug: string;
  // Always present — the catalog is 100% mocked today.
  mock: ConnectorFactory;
  // Populated during the corresponding prompt-14 mini-session.
  real?: ConnectorFactory;
}

const ENTRIES: readonly ConnectorEntry[] = [
  // Internal KKU ─────────────────────────────────────────────────────
  {
    slug: 'kku-registry',
    mock: () => new KkuRegistryConnector(),
    real: () => new KkuRegistryRealConnector(),
  },
  { slug: 'kku-finance',        mock: () => new KkuFinanceConnector() },
  { slug: 'kku-hr',             mock: () => new KkuHrConnector() },
  { slug: 'kku-alumni',         mock: () => new KkuAlumniConnector() },
  { slug: 'kku-research',       mock: () => new KkuResearchConnector() },
  { slug: 'digital-transcript', mock: () => new DigitalTranscriptConnector() },

  // National Thai (API) ──────────────────────────────────────────────
  { slug: 'mhesi-cisa',         mock: () => new MhesiCisaConnector() },
  { slug: 'jobthai',            mock: () => new JobThaiConnector() },
  { slug: 'jobsdb',             mock: () => new JobsDbConnector() },

  // National Thai (PDF) ──────────────────────────────────────────────
  { slug: 'nso-labor-force',    mock: () => new NsoConnector() },
  { slug: 'tcas',               mock: () => new TcasConnector() },
  { slug: 'tpqi',               mock: () => new TpqiConnector() },
  { slug: 'mhesi-policy',       mock: () => new MhesiPolicyConnector() },
  { slug: 'nesdc-reports',      mock: () => new NesdcReportConnector() },
  { slug: 'nxpo-reports',       mock: () => new NxpoReportConnector() },
  { slug: 'boi-sectoral',       mock: () => new BoiSectoralConnector() },
  { slug: 'eeco-reports',       mock: () => new EecoReportConnector() },

  // International ────────────────────────────────────────────────────
  { slug: 'wef-future-of-jobs', mock: () => new WefFutureOfJobsConnector() },
  { slug: 'oecd-reports',       mock: () => new OecdReportConnector() },
  { slug: 'world-bank',         mock: () => new WorldBankConnector() },
  { slug: 'adb-gms',            mock: () => new AdbGmsConnector() },
  { slug: 'scopus',             mock: () => new ScopusConnector() },
  { slug: 'openalex',           mock: () => new OpenAlexConnector() },

  // Scrape ───────────────────────────────────────────────────────────
  { slug: 'peer-programs-scraper', mock: () => new PeerProgramScraperConnector() },
];

const logger = new Logger('ConnectorRegistry');

export function buildRegistry(): Map<string, Connector> {
  const map = new Map<string, Connector>();
  let chosenReal = 0;
  let chosenMock = 0;
  let fellBack = 0;

  for (const entry of ENTRIES) {
    const resolution = resolveConnectorMode(entry.slug);

    let connector: Connector;
    if (resolution.mode === 'real' && entry.real) {
      connector = entry.real();
      chosenReal++;
    } else {
      if (resolution.mode === 'real' && !entry.real) {
        logger.warn(
          `Connector ${entry.slug}: mode=real (via ${resolution.envKey ?? 'unknown'}) but no real implementation registered — using mock.`,
        );
        fellBack++;
      }
      connector = entry.mock();
      chosenMock++;
    }

    if (map.has(connector.slug)) {
      throw new Error(
        `Duplicate connector slug "${connector.slug}" — every slug must appear exactly once.`,
      );
    }
    if (connector.slug !== entry.slug) {
      throw new Error(
        `Connector slug mismatch — registered as "${entry.slug}" but class reports "${connector.slug}".`,
      );
    }
    map.set(connector.slug, connector);
  }

  logger.log(
    `Connector registry built — real=${chosenReal} mock=${chosenMock} fell-back-to-mock=${fellBack}`,
  );
  return map;
}
