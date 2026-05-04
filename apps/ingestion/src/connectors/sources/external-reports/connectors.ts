import { CuratedReportConnector } from './curated-report-connector';

// Per-source thin subclasses. Each one is just a slug + catalog path —
// all behaviour lives in the base class. Catalogs are JSON files
// committed alongside this file; curators update them as new policy
// papers / reports are published by each upstream organisation.

export class MhesiPolicyRealConnector extends CuratedReportConnector {
  readonly slug = 'mhesi-policy';
  protected readonly catalogPath = './catalogs/mhesi-policy.json';
}

export class NesdcReportsRealConnector extends CuratedReportConnector {
  readonly slug = 'nesdc-reports';
  protected readonly catalogPath = './catalogs/nesdc-reports.json';
}

export class NxpoReportsRealConnector extends CuratedReportConnector {
  readonly slug = 'nxpo-reports';
  protected readonly catalogPath = './catalogs/nxpo-reports.json';
}

export class BoiSectoralRealConnector extends CuratedReportConnector {
  readonly slug = 'boi-sectoral';
  protected readonly catalogPath = './catalogs/boi-sectoral.json';
}

export class EecoReportsRealConnector extends CuratedReportConnector {
  readonly slug = 'eeco-reports';
  protected readonly catalogPath = './catalogs/eeco-reports.json';
}

export class WefFutureOfJobsRealConnector extends CuratedReportConnector {
  readonly slug = 'wef-future-of-jobs';
  protected readonly catalogPath = './catalogs/wef-future-of-jobs.json';
}

export class OecdReportsRealConnector extends CuratedReportConnector {
  readonly slug = 'oecd-reports';
  protected readonly catalogPath = './catalogs/oecd-reports.json';
}

export class AdbGmsRealConnector extends CuratedReportConnector {
  readonly slug = 'adb-gms';
  protected readonly catalogPath = './catalogs/adb-gms.json';
}
