import { Logger } from '@nestjs/common';
import type { Connector } from '@kku/shared';
import { resolveConnectorMode } from '@kku/shared';

import { JobThaiConnector } from './sources/jobthai/connector';

import {
  DigitalTranscriptConnector,
  JobThaiMockConnector,
  JobsDbConnector,
  KkuAlumniConnector,
  KkuEvaluationsConnector,
  KkuFinanceConnector,
  KkuHrConnector,
  KkuRegistryConnector,
  KkuResearchConnector,
  KkuTcasFunnelConnector,
  KkuAdmissionCampaignsConnector,
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
import { KkuEvaluationsRealConnector } from './sources/kku-evaluations';
import { KkuDqConnector, KkuDqRealConnector } from './sources/kku-dq';
import { KkuFinanceRealConnector } from './sources/kku-finance';
import { KkuHrRealConnector } from './sources/kku-hr';
import { KkuRegistryRealConnector } from './sources/kku-registry';
import { KkuTcasFunnelRealConnector } from './sources/kku-tcas-funnel';
import { KkuAdmissionCampaignsRealConnector } from './sources/kku-admission-campaigns';
import { KkuResearchRealConnector } from './sources/kku-research';
import { Job108Connector } from './sources/job-108';
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
  // For catalog slugs that are advertised as "active" because their
  // upstream is already pulled by another connector. The registry
  // skips real-mode resolution + mock-fallback warning for these and
  // logs an info-level "covered by X" message instead. Standalone
  // runs of the slug still execute the mock (placeholder data) but
  // operators are expected to run the canonical connector.
  coveredBy?: string;
}

const ENTRIES: readonly ConnectorEntry[] = [
  // Internal KKU ─────────────────────────────────────────────────────
  {
    slug: 'kku-registry',
    mock: () => new KkuRegistryConnector(),
    real: () => new KkuRegistryRealConnector(),
  },
  {
    slug: 'kku-tcas-funnel',
    mock: () => new KkuTcasFunnelConnector(),
    real: () => new KkuTcasFunnelRealConnector(),
  },
  {
    slug: 'kku-admission-campaigns',
    mock: () => new KkuAdmissionCampaignsConnector(),
    real: () => new KkuAdmissionCampaignsRealConnector(),
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
  {
    slug: 'kku-evaluations',
    mock: () => new KkuEvaluationsConnector(),
    real: () => new KkuEvaluationsRealConnector(),
  },
  {
    // Real from day one — the mock is a deliberate no-op (no sample data
    // exists and fabricating DQ scores is not allowed). See connector.ts.
    slug: 'kku-dq',
    mock: () => new KkuDqConnector(),
    real: () => new KkuDqRealConnector(),
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
  { slug: 'jobthai',            mock: () => new JobThaiMockConnector(), real: () => new JobThaiConnector() },
  { slug: 'jobsdb',             mock: () => new JobsDbConnector() },
  // Public-sector counterpart to jobthai. Both slots hold the real connector
  // deliberately: there is no mock, per the no-mock-data policy, and the
  // registry falls back to `mock` when `real` is absent, so leaving it out
  // would silently disable the source.
  { slug: 'job-108',            mock: () => new Job108Connector(), real: () => new Job108Connector() },

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
  // Scopus + OpenAlex live in the catalog as advertised upstream
  // sources, but the actual reads happen inside the kku-research
  // connector (institution-scoped fetches via OpenAlex; Scopus
  // enrichment when KKU_SCOPUS_API_KEY is set). Marked `coveredBy` so
  // the registry surfaces "covered by kku-research" instead of a
  // misleading "mode=real but no real implementation" warning.
  {
    slug: 'scopus',
    mock: () => new ScopusConnector(),
    coveredBy: 'kku-research',
  },
  {
    slug: 'openalex',
    mock: () => new OpenAlexConnector(),
    coveredBy: 'kku-research',
  },

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
  let covered = 0;
  let fellBack = 0;

  for (const entry of ENTRIES) {
    const resolution = resolveConnectorMode(entry.slug);

    let connector: Connector;
    if (entry.coveredBy) {
      // Aliased slug — advertised as active but upstream is pulled by
      // the canonical connector. Skip real-mode resolution warning;
      // standalone runs use the mock placeholder.
      logger.log(
        `Connector ${entry.slug}: covered by ${entry.coveredBy} — standalone runs use the mock placeholder. Run \`pnpm connector:run ${entry.coveredBy}\` for real data.`,
      );
      connector = entry.mock();
      covered++;
    } else if (resolution.mode === 'real' && entry.real) {
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
    `Connector registry built — real=${chosenReal} mock=${chosenMock} covered=${covered} fell-back-to-mock=${fellBack}`,
  );
  return map;
}
