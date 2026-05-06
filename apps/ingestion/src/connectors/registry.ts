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
  KmitlSkillMappingConnector,
  MhesiCisaConnector,
  OpenAlexConnector,
  KkuHrProcessedConnector,
  ScopusConnector,
  UniconDs1001Connector,
  UniconDs2001Connector,
  UniconDs2003Connector,
  UniconDs2004Connector,
  WorldBankConnector,
} from './sources/kku-connectors';
import { KkuFinanceRealConnector } from './sources/kku-finance';
import { KkuHrRealConnector } from './sources/kku-hr';
import { KkuRegistryRealConnector } from './sources/kku-registry';
import { KkuResearchRealConnector } from './sources/kku-research';
import { KmitlSkillMappingRealConnector } from './sources/kmitl-skill-mapping';
import { KkuHrProcessedRealConnector } from './sources/kku-hr-processed';
import { UniconDs1001RealConnector } from './sources/unicon-ds1001';
import { UniconDs2001RealConnector } from './sources/unicon-ds2001';
import { UniconDs2003RealConnector } from './sources/unicon-ds2003';
import { UniconDs2004RealConnector } from './sources/unicon-ds2004';
import {
  AdbGmsRealConnector,
  BoiSectoralRealConnector,
  EecoReportsRealConnector,
  MhesiPolicyRealConnector,
  NesdcReportsRealConnector,
  NxpoReportsRealConnector,
  OecdReportsRealConnector,
  WefFutureOfJobsRealConnector,
} from './sources/external-reports';
import { WorldBankRealConnector } from './sources/world-bank';
import { TcasRealConnector } from './sources/tcas';
import {
  AdbGmsConnector,
  BoiSectoralConnector,
  EecoReportConnector,
  ImdRankingsConnector,
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
  {
    slug: 'kku-finance',
    mock: () => new KkuFinanceConnector(),
    real: () => new KkuFinanceRealConnector(),
  },
  {
    slug: 'kku-hr',
    mock: () => new KkuHrConnector(),
    real: () => new KkuHrRealConnector(),
  },
  { slug: 'kku-alumni',         mock: () => new KkuAlumniConnector() },
  {
    slug: 'kku-research',
    mock: () => new KkuResearchConnector(),
    real: () => new KkuResearchRealConnector(),
  },
  { slug: 'digital-transcript', mock: () => new DigitalTranscriptConnector() },

  // National Thai (API) ──────────────────────────────────────────────
  { slug: 'mhesi-cisa',         mock: () => new MhesiCisaConnector() },
  {
    slug: 'kmitl-skill-mapping',
    mock: () => new KmitlSkillMappingConnector(),
    real: () => new KmitlSkillMappingRealConnector(),
  },
  // Deprecated — kept so historical IngestionRun rows don't orphan.
  // Scheduler skips them via DataSource.scheduleEnabled=false (set in seed).
  { slug: 'jobthai',            mock: () => new JobThaiConnector() },
  { slug: 'jobsdb',             mock: () => new JobsDbConnector() },

  // National Thai (PDF) ──────────────────────────────────────────────
  { slug: 'nso-labor-force',    mock: () => new NsoConnector() },
  {
    slug: 'tcas',
    mock: () => new TcasConnector(),
    real: () => new TcasRealConnector(),
  },
  { slug: 'tpqi',               mock: () => new TpqiConnector() },
  {
    slug: 'mhesi-policy',
    mock: () => new MhesiPolicyConnector(),
    real: () => new MhesiPolicyRealConnector(),
  },
  {
    slug: 'nesdc-reports',
    mock: () => new NesdcReportConnector(),
    real: () => new NesdcReportsRealConnector(),
  },
  {
    slug: 'nxpo-reports',
    mock: () => new NxpoReportConnector(),
    real: () => new NxpoReportsRealConnector(),
  },
  {
    slug: 'boi-sectoral',
    mock: () => new BoiSectoralConnector(),
    real: () => new BoiSectoralRealConnector(),
  },
  {
    slug: 'eeco-reports',
    mock: () => new EecoReportConnector(),
    real: () => new EecoReportsRealConnector(),
  },

  // International ────────────────────────────────────────────────────
  {
    slug: 'wef-future-of-jobs',
    mock: () => new WefFutureOfJobsConnector(),
    real: () => new WefFutureOfJobsRealConnector(),
  },
  {
    slug: 'oecd-reports',
    mock: () => new OecdReportConnector(),
    real: () => new OecdReportsRealConnector(),
  },
  {
    slug: 'world-bank',
    mock: () => new WorldBankConnector(),
    real: () => new WorldBankRealConnector(),
  },
  {
    slug: 'adb-gms',
    mock: () => new AdbGmsConnector(),
    real: () => new AdbGmsRealConnector(),
  },
  { slug: 'scopus',             mock: () => new ScopusConnector() },
  { slug: 'openalex',           mock: () => new OpenAlexConnector() },

  // Scrape ───────────────────────────────────────────────────────────
  { slug: 'imd-rankings',          mock: () => new ImdRankingsConnector() },
  { slug: 'peer-programs-scraper', mock: () => new PeerProgramScraperConnector() },

  // UNICON (MHESI submissions) ───────────────────────────────────────
  {
    slug: 'unicon-ds1001',
    mock: () => new UniconDs1001Connector(),
    real: () => new UniconDs1001RealConnector(),
  },
  {
    slug: 'unicon-ds2001',
    mock: () => new UniconDs2001Connector(),
    real: () => new UniconDs2001RealConnector(),
  },
  {
    slug: 'unicon-ds2003',
    mock: () => new UniconDs2003Connector(),
    real: () => new UniconDs2003RealConnector(),
  },
  {
    slug: 'unicon-ds2004',
    mock: () => new UniconDs2004Connector(),
    real: () => new UniconDs2004RealConnector(),
  },
  // Processed-HR (MySQL aggregate; powers Staff Compensation dashboard
  // + cost-allocation methodology in the program pipeline)
  {
    slug: 'kku-hr-processed',
    mock: () => new KkuHrProcessedConnector(),
    real: () => new KkuHrProcessedRealConnector(),
  },
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
