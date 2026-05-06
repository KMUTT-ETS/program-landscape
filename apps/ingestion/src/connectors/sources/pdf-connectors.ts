import type { ConnectorContext } from '@kku/shared';
import { PdfUploadConnector, type PdfRawPayload } from '../base';

// ────────────────────────────────────────────────────────────────────────────
// PDF-sourced connectors — mocked.
//
// Each of these fetches PDF bytes (mock: a tiny placeholder Buffer) and
// routes them through PdfUploadConnector's base load() which creates a
// PdfDocument row with processingStatus=PENDING. The prompt 03b intake
// pipeline picks up PENDING rows and does OCR + extraction.
//
// For real connectors, fetchPdfs() will:
//   - call the upstream site / API to enumerate new PDFs
//   - download each PDF's bytes
//   - return { bytes, filename, sourceCategory, sourceOrg, language }
//
// The mock here hands back a tiny "%PDF-1.4" placeholder so the
// PdfDocument row's contentHash is deterministic and unique per connector.
// ────────────────────────────────────────────────────────────────────────────

function mockPdfBytes(unique: string): Buffer {
  // A real PDF header + a unique comment per connector so the content
  // hash is stable and unique. Intake pipeline treats these as valid
  // stubs until real bytes arrive.
  return Buffer.from(`%PDF-1.4\n% mock-${unique}\n%%EOF\n`, 'utf8');
}

export class NsoConnector extends PdfUploadConnector {
  readonly slug = 'nso-labor-force';
  readonly mocked = true;
  async fetchPdfs(_c: ConnectorContext): Promise<PdfRawPayload[]> {
    return [
      {
        bytes: mockPdfBytes('nso-lfs-2026-q1'),
        filename: 'NSO-Labor-Force-Survey-2026-Q1.pdf',
        sourceCategory: 'SURVEY',
        sourceOrg: 'National Statistical Office (NSO), Thailand',
        language: 'TH',
      },
    ];
  }
}

export class TcasConnector extends PdfUploadConnector {
  readonly slug = 'tcas';
  readonly mocked = true;
  async fetchPdfs(_c: ConnectorContext): Promise<PdfRawPayload[]> {
    return [
      {
        bytes: mockPdfBytes('tcas-2026-cutoffs'),
        filename: 'TCAS-2026-cutoff-scores.pdf',
        sourceCategory: 'REPORT',
        sourceOrg: 'Council of University Presidents of Thailand',
        language: 'TH',
      },
    ];
  }
}

export class TpqiConnector extends PdfUploadConnector {
  readonly slug = 'tpqi';
  readonly mocked = true;
  async fetchPdfs(_c: ConnectorContext): Promise<PdfRawPayload[]> {
    return [
      {
        bytes: mockPdfBytes('tpqi-software-dev-standard-v4'),
        filename: 'TPQI-software-development-standard-v4.pdf',
        sourceCategory: 'REPORT',
        sourceOrg: 'Thailand Professional Qualification Institute',
        language: 'TH',
      },
    ];
  }
}

export class MhesiPolicyConnector extends PdfUploadConnector {
  readonly slug = 'mhesi-policy';
  readonly mocked = true;
  async fetchPdfs(_c: ConnectorContext): Promise<PdfRawPayload[]> {
    return [
      {
        bytes: mockPdfBytes('mhesi-policy-2026-04-20'),
        filename: 'MHESI-policy-2026-04-20.pdf',
        sourceCategory: 'POLICY',
        sourceOrg: 'Ministry of Higher Education, Science, Research and Innovation',
        language: 'TH',
      },
    ];
  }
}

export class NesdcReportConnector extends PdfUploadConnector {
  readonly slug = 'nesdc-reports';
  readonly mocked = true;
  async fetchPdfs(_c: ConnectorContext): Promise<PdfRawPayload[]> {
    return [
      {
        bytes: mockPdfBytes('nesdc-13th-plan-2023-2027'),
        filename: 'NESDC-13th-National-Plan-2023-2027.pdf',
        sourceCategory: 'POLICY',
        sourceOrg: 'National Economic and Social Development Council',
        language: 'TH',
      },
    ];
  }
}

export class NxpoReportConnector extends PdfUploadConnector {
  readonly slug = 'nxpo-reports';
  readonly mocked = true;
  async fetchPdfs(_c: ConnectorContext): Promise<PdfRawPayload[]> {
    return [
      {
        bytes: mockPdfBytes('nxpo-research-strategy-2026'),
        filename: 'NXPO-research-strategy-2026.pdf',
        sourceCategory: 'POLICY',
        sourceOrg: 'National Higher Education, Science, Research and Innovation Policy Council',
        language: 'TH',
      },
    ];
  }
}

export class BoiSectoralConnector extends PdfUploadConnector {
  readonly slug = 'boi-sectoral';
  readonly mocked = true;
  async fetchPdfs(_c: ConnectorContext): Promise<PdfRawPayload[]> {
    return [
      {
        bytes: mockPdfBytes('boi-2026-q1-sectoral'),
        filename: 'BOI-2026-Q1-sectoral-report.pdf',
        sourceCategory: 'REPORT',
        sourceOrg: 'Board of Investment of Thailand',
        language: 'TH',
      },
    ];
  }
}

export class EecoReportConnector extends PdfUploadConnector {
  readonly slug = 'eeco-reports';
  readonly mocked = true;
  async fetchPdfs(_c: ConnectorContext): Promise<PdfRawPayload[]> {
    return [
      {
        bytes: mockPdfBytes('eeco-industrial-development-2026'),
        filename: 'EECO-industrial-development-plan-2026.pdf',
        sourceCategory: 'POLICY',
        sourceOrg: 'Eastern Economic Corridor Office',
        language: 'TH',
      },
    ];
  }
}

export class WefFutureOfJobsConnector extends PdfUploadConnector {
  readonly slug = 'wef-future-of-jobs';
  readonly mocked = true;
  async fetchPdfs(_c: ConnectorContext): Promise<PdfRawPayload[]> {
    return [
      {
        bytes: mockPdfBytes('wef-future-of-jobs-2025'),
        filename: 'WEF-Future-of-Jobs-2025.pdf',
        sourceCategory: 'REPORT',
        sourceOrg: 'World Economic Forum',
        language: 'EN',
      },
    ];
  }
}

export class OecdReportConnector extends PdfUploadConnector {
  readonly slug = 'oecd-reports';
  readonly mocked = true;
  async fetchPdfs(_c: ConnectorContext): Promise<PdfRawPayload[]> {
    return [
      {
        bytes: mockPdfBytes('oecd-thailand-skills-outlook-2026'),
        filename: 'OECD-Thailand-Skills-Outlook-2026.pdf',
        sourceCategory: 'REPORT',
        sourceOrg: 'OECD',
        language: 'EN',
      },
    ];
  }
}

export class AdbGmsConnector extends PdfUploadConnector {
  readonly slug = 'adb-gms';
  readonly mocked = true;
  async fetchPdfs(_c: ConnectorContext): Promise<PdfRawPayload[]> {
    return [
      {
        bytes: mockPdfBytes('adb-gms-workforce-2026'),
        filename: 'ADB-GMS-workforce-outlook-2026.pdf',
        sourceCategory: 'REPORT',
        sourceOrg: 'Asian Development Bank',
        language: 'EN',
      },
    ];
  }
}

export class ImdRankingsConnector extends PdfUploadConnector {
  readonly slug = 'imd-rankings';
  readonly mocked = true;
  // IMD's annual reports are hosted at imd.org/wcc with predictable URL
  // shapes. Real connector (a follow-up session) would enumerate the
  // three annual release PDFs and fetch their bytes; the mock here
  // returns one placeholder per dataset so the PdfDocument table has
  // distinct rows for the WCY/WTR/WDCR streams.
  async fetchPdfs(_c: ConnectorContext): Promise<PdfRawPayload[]> {
    const year = new Date().getUTCFullYear();
    return [
      {
        bytes: mockPdfBytes(`imd-wcy-${year}`),
        filename: `IMD-WCY-${year}.pdf`,
        sourceCategory: 'REPORT',
        sourceOrg: 'IMD World Competitiveness Center, Lausanne',
        language: 'EN',
      },
      {
        bytes: mockPdfBytes(`imd-wtr-${year}`),
        filename: `IMD-WTR-${year}.pdf`,
        sourceCategory: 'REPORT',
        sourceOrg: 'IMD World Competitiveness Center, Lausanne',
        language: 'EN',
      },
      {
        bytes: mockPdfBytes(`imd-wdcr-${year}`),
        filename: `IMD-WDCR-${year}.pdf`,
        sourceCategory: 'REPORT',
        sourceOrg: 'IMD World Competitiveness Center, Lausanne',
        language: 'EN',
      },
    ];
  }
}
