import type {
  ConnectorContext,
  LoadResult,
  NormalizedRecord,
  RawRecord,
} from '@kku/shared';
import { ApiConnector } from '../base';

// ────────────────────────────────────────────────────────────────────────────
// KKU-internal connectors — mocked.
//
// Every connector in this file is MARKED MOCKED. Real wiring lands in
// prompt 14. The mock data is realistic enough that upstream modules
// (Cockpit, Deep-Dive, Gap Analyzer) can build against it.
//
// Pattern for all mocks:
//   - fetch() returns 2-5 canned RawRecords regardless of `since`
//   - transform() converts each raw into 0-N NormalizedRecord(s)
//   - load() returns counts without actually writing — real loaders will
//     upsert to the target Prisma model
//
// When you flip one of these to real, remove the `readonly mocked = true`
// flag and replace the fetch/transform/load bodies.
// ────────────────────────────────────────────────────────────────────────────

export class KkuRegistryConnector extends ApiConnector {
  readonly slug = 'kku-registry';
  readonly mocked = true;

  async fetch(_ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    // Mock shape: matches the subset of REG's program endpoint we care about.
    return [
      {
        externalId: 'PROG-10200',
        sourceTimestamp: new Date('2026-04-20'),
        data: { code: '10200', nameTh: 'วิศวกรรมคอมพิวเตอร์', nameEn: 'Computer Engineering', status: 'ACTIVE' },
      },
      {
        externalId: 'PROG-20110',
        sourceTimestamp: new Date('2026-04-20'),
        data: { code: '20110', nameTh: 'รัฐประศาสนศาสตร์', nameEn: 'Public Administration', status: 'ACTIVE' },
      },
    ];
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [
      {
        target: 'programs',
        externalId: raw.externalId,
        payload: raw.data as Record<string, unknown>,
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(_ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    // Real impl: prisma.program.upsert per record. Mock: count only.
    return {
      recordsFetched: normalized.length,
      recordsLoaded: normalized.length,
      recordsFailed: 0,
      metadata: { note: 'mocked — no DB writes', sampleIds: normalized.map((n) => n.externalId) },
    };
  }
}

export class KkuFinanceConnector extends ApiConnector {
  readonly slug = 'kku-finance';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'FIN-2025-PROG-10200',
        sourceTimestamp: new Date('2026-04-01'),
        data: {
          programCode: '10200',
          fiscalYear: 2025,
          directCostThb: 42_500_000,
          sharedCostThb: 8_200_000,
          revenueThb: 38_000_000,
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'financial_metrics', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: n.length, recordsFailed: 0, metadata: { note: 'mocked — sensitive; no DB writes yet' } };
  }
}

export class KkuHrConnector extends ApiConnector {
  readonly slug = 'kku-hr';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'HR-00012345',
        sourceTimestamp: new Date('2026-04-22'),
        data: { employeeId: '00012345', nameTh: 'รศ. ดร. สมชาย ใจดี', rank: 'ASSOC_PROF', departmentCode: '02-03', yearsOfService: 18, retirementYear: 2032 },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'faculty_members', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: n.length, recordsFailed: 0, metadata: { note: 'mocked' } };
  }
}

export class KkuAlumniConnector extends ApiConnector {
  readonly slug = 'kku-alumni';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'ALUM-2024-10200',
        sourceTimestamp: new Date('2026-03-15'),
        data: {
          programCode: '10200',
          graduationYear: 2024,
          employmentRate: 0.87,
          averageMonthlySalaryThb: 32_500,
          sampleSize: 74,
          inFieldRate: 0.79,
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'graduate_outcomes', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: n.length, recordsFailed: 0, metadata: { note: 'mocked' } };
  }
}

export class KkuResearchConnector extends ApiConnector {
  readonly slug = 'kku-research';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'RES-2025-99921',
        sourceTimestamp: new Date('2026-04-10'),
        data: {
          title: 'Federated learning in rural-health IoT',
          outputType: 'JOURNAL',
          venue: 'IEEE IoT Journal',
          year: 2025,
          faculty: '02-03',
          authorIds: ['00012345', '00022101'],
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'research_outputs', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: n.length, recordsFailed: 0, metadata: { note: 'mocked — real wiring crosswalks Scopus + OpenAlex' } };
  }
}

export class DigitalTranscriptConnector extends ApiConnector {
  readonly slug = 'digital-transcript';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'DT-CLAIM-77120045',
        sourceTimestamp: new Date('2026-04-22'),
        data: {
          studentId: 'STU-77120045',
          programCode: '10200',
          skillUri: 'https://data.europa.eu/esco/skill/a9f12c',
          skillNameEn: 'Python programming',
          claimedAt: '2026-04-22',
          evidenceUrl: 'https://kku-transcript.example/claims/77120045-a9f12c',
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'skill_claims', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: n.length, recordsFailed: 0, metadata: { note: 'mocked — the real Digital Transcript system is already live' } };
  }
}

export class MhesiCisaConnector extends ApiConnector {
  readonly slug = 'mhesi-cisa';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'CISA-ACC-10200-2026',
        sourceTimestamp: new Date('2026-02-15'),
        data: {
          programCode: '10200',
          accreditationStatus: 'ACCREDITED',
          level: 'BACHELOR',
          validUntil: '2030-12-31',
          reviewCycleYears: 5,
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'curricula', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: n.length, recordsFailed: 0, metadata: { note: 'mocked — CISA has a real API' } };
  }
}

// Retained ONLY as the rollback path for CONNECTOR_JOBTHAI_MODE=mocked.
// The real implementation is
// apps/ingestion/src/connectors/sources/jobthai/connector.ts.
export class JobThaiMockConnector extends ApiConnector {
  readonly slug = 'jobthai';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'JT-88812345',
        sourceTimestamp: new Date('2026-04-22'),
        data: {
          title: 'Data Engineer',
          companyName: 'Somchai Tech Co., Ltd.',
          location: 'ขอนแก่น',
          salaryMinThb: 35_000,
          salaryMaxThb: 55_000,
          descriptionTh: 'พัฒนาระบบข้อมูลขนาดใหญ่ ...',
          skillsRaw: ['Python', 'SQL', 'Airflow', 'AWS'],
          postedAt: '2026-04-20',
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'job_postings', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: n.length, recordsFailed: 0, metadata: { note: 'mocked' } };
  }
}

export class JobsDbConnector extends ApiConnector {
  readonly slug = 'jobsdb';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'JDB-PH-99931001',
        sourceTimestamp: new Date('2026-04-22'),
        data: {
          title: 'Mechatronics Engineer',
          companyName: 'Regional Manufacturing Co.',
          location: 'Bangkok',
          salaryMinThb: 40_000,
          salaryMaxThb: 70_000,
          descriptionEn: 'Design and commission automation lines ...',
          skillsRaw: ['PLC', 'SCADA', 'CAD', 'Robotics'],
          postedAt: '2026-04-21',
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'job_postings', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: n.length, recordsFailed: 0, metadata: { note: 'mocked' } };
  }
}

// LinkedIn Labour-Market Insights — aggregated skill-demand intelligence
// sourced from LinkedIn (profiles + Thai job postings + grad data).
// Subscribed by MHESI under a national agreement; KMITL operates the API
// endpoint at https://skill.kmitl.ac.th. The slug remains
// `kmitl-skill-mapping` because it identifies the technical API endpoint;
// human-facing labels reflect the data attribution chain (LinkedIn ←
// MHESI ← KMITL). Replaces jobthai + jobsdb. Returns percentages at
// career level, not per-posting rows. Real implementation lives in
// sources/kmitl-skill-mapping/.
export class KmitlSkillMappingConnector extends ApiConnector {
  readonly slug = 'kmitl-skill-mapping';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'KMITL-CAREER-101',
        sourceTimestamp: new Date('2026-05-01'),
        data: {
          careerId: 101,
          careerName: 'Software Engineer',
          groupName: 'ICT Professionals',
          subGroupName: 'Software Development',
          skillsJobPosts: [
            { skill: 'Python', amount: 1240, percentage: 78.4 },
            { skill: 'SQL', amount: 980, percentage: 62.0 },
            { skill: 'AWS', amount: 720, percentage: 45.6 },
          ],
          skillsGrowth: [
            { skill: 'AI/ML', percentage: 38.2 },
            { skill: 'Kubernetes', percentage: 22.7 },
          ],
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'kmitl_career_skill_demands', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: 0, recordsFailed: 0, metadata: { note: 'mocked — load is a no-op' } };
  }
}

export class ScopusConnector extends ApiConnector {
  readonly slug = 'scopus';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'SCOPUS-85158221',
        sourceTimestamp: new Date('2026-04-10'),
        data: {
          scopusId: '85158221',
          title: 'A novel federated learning approach for IoT networks',
          authors: ['Somchai Jaidi', 'Mali Phongphan'],
          venue: 'IEEE IoT Journal',
          year: 2025,
          citedBy: 12,
          sourceType: 'j',
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'research_outputs', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: n.length, recordsFailed: 0, metadata: { note: 'mocked — requires ELSEVIER_API_KEY for real wiring' } };
  }
}

export class OpenAlexConnector extends ApiConnector {
  readonly slug = 'openalex';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'OA-W3177981045',
        sourceTimestamp: new Date('2026-04-10'),
        data: {
          openalexId: 'W3177981045',
          title: 'A novel federated learning approach for IoT networks',
          authors: [{ name: 'Somchai Jaidi', orcid: '0000-0002-1111-2222' }],
          venue: 'IEEE IoT Journal',
          year: 2025,
          citedByCount: 12,
          concepts: ['federated learning', 'IoT'],
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'research_outputs', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: n.length, recordsFailed: 0, metadata: { note: 'mocked — public API, no key needed for real wiring' } };
  }
}

export class WorldBankConnector extends ApiConnector {
  readonly slug = 'world-bank';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'WB-THA-SLUEM-2024',
        sourceTimestamp: new Date('2026-03-01'),
        data: {
          country: 'THA',
          indicator: 'SL.UEM.TOTL.ZS',
          year: 2024,
          value: 1.05,
          note: 'Unemployment, total (% of total labor force)',
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'labor_market_forecasts', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: n.length, recordsFailed: 0, metadata: { note: 'mocked' } };
  }
}

export class UniconDs2003Connector extends ApiConnector {
  readonly slug = 'unicon-ds2003';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'mock-ds2003-1',
        sourceTimestamp: new Date('2026-04-20'),
        data: {
          ACADEMIC_YEAR: '2568', SEMESTER: '2', UNIV_ID: '00300',
          CITIZEN_ID: '0000000000000', GRAD_YEAR: '2545',
          GRAD_LEV_ID: '40', GRAD_CURR: 'หลักสูตรปรัชญาดุษฎีบัณฑิต',
          GRAD_ISCED_ID: null, GRAD_PROG: null, GRAD_UNIV: null,
          GRAD_COUNTRY_ID: 'TH',
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'staff_education_history', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: 0, recordsFailed: 0, metadata: { note: 'mocked' } };
  }
}

export class UniconDs2004Connector extends ApiConnector {
  readonly slug = 'unicon-ds2004';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'mock-ds2004-1',
        sourceTimestamp: new Date('2026-04-20'),
        data: {
          ACADEMIC_YEAR: 2568, SEMESTER: 2, UNIV_ID: '00300',
          CITIZEN_ID: '0000000000000', FAC_ID: '00056',
          CURR_ID: '25430031100056', TEACH_TYPE_ID: 1,
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'staff_program_assignment', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: 0, recordsFailed: 0, metadata: { note: 'mocked' } };
  }
}

// No sample rows: the no-mock-data policy. In mocked mode this source is simply empty.
export class KkuResearchServicesConnector extends ApiConnector {
  readonly slug = 'kku-research-services';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [];
  }
  async transform(): Promise<NormalizedRecord[]> {
    return [];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: 0, recordsFailed: 0, metadata: { note: 'mocked — no rows' } };
  }
}

export class UniconDs1001Connector extends ApiConnector {
  readonly slug = 'unicon-ds1001';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'mock-ds1001-1',
        sourceTimestamp: new Date('2026-04-20'),
        data: {
          ACADEMIC_YEAR: '2568', SEMESTER: '2', UNIV_ID: '00300',
          CITIZEN_ID: '0000000000000', STD_ID: '0000000000',
          GENDER_ID: '1', NATIONALITY_ID: 'TH', BIRTH_YEAR: '2546',
          ADMIT_YEAR: '2566', FAC_ID: '00056', CURR_ID: '25430031100056',
          STUDY_TYPE_ID: '1', GRAD_STATUS_ID: null, STD_STATUS_ID: '1',
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'student_program_record', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: 0, recordsFailed: 0, metadata: { note: 'mocked' } };
  }
}

export class UniconDs2001Connector extends ApiConnector {
  readonly slug = 'unicon-ds2001';
  readonly mocked = true;
  async fetch(): Promise<RawRecord[]> { return []; }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'staff_master_record', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: 0, recordsFailed: 0, metadata: { note: 'mocked' } };
  }
}

export class KkuHrProcessedConnector extends ApiConnector {
  readonly slug = 'kku-hr-processed';
  readonly mocked = true;
  async fetch(): Promise<RawRecord[]> { return []; }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'staff_compensation_cube', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: 0, recordsFailed: 0, metadata: { note: 'mocked' } };
  }
}

export class KkuTcasFunnelConnector extends ApiConnector {
  readonly slug = 'kku-tcas-funnel';
  readonly mocked = true;
  async fetch(): Promise<RawRecord[]> { return []; }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'tcas_admission_funnels', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: 0, recordsFailed: 0, metadata: { note: 'mocked' } };
  }
}

export class KkuAdmissionCampaignsConnector extends ApiConnector {
  readonly slug = 'kku-admission-campaigns';
  readonly mocked = true;
  async fetch(): Promise<RawRecord[]> { return []; }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'admission_campaign_stats', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: 0, recordsFailed: 0, metadata: { note: 'mocked' } };
  }
}

export class KkuEvaluationsConnector extends ApiConnector {
  readonly slug = 'kku-evaluations';
  readonly mocked = true;
  async fetch(): Promise<RawRecord[]> {
    return [
      {
        externalId: 'kku-evaluations:mock:0',
        sourceTimestamp: new Date('2026-05-19'),
        data: {
          note: 'mocked — real connector reads POWERBI.EVALUATE_INSTRUCTOR with TOTAL_STUDENT >= 5 gate',
          shape: '(year, sem, classId, questionId, officerId) → ratingAvg + respondentCount',
        },
      },
    ];
  }
  async transform(_c: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'evaluation_response_summaries', externalId: raw.externalId, payload: raw.data as Record<string, unknown>, freshnessDate: raw.sourceTimestamp }];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: 0, recordsFailed: 0, metadata: { note: 'mocked — no DB writes' } };
  }
}
