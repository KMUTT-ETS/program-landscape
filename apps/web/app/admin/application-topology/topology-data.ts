// ──────────────────────────────────────────────────────────────────────────
// Dashboard data-topology — static node/edge model for the
// /admin/application-topology page.
//
// Scope: the whole application. Every external system, connector/script, DB
// landing table, AI task and consuming dashboard.
//
// It did not start that way. The original scope was Education + Staff only,
// and this header still said Cockpit, Gap Analyzer and Benchmarking were
// "intentionally out" long after they had been added — along with Deep-Dive,
// Risk, Trends, Scenarios, Decisions, Analyst and Teaching & Learning, each
// of which has a filter chip in FILTER_OPTIONS below. The page title says
// "whole-application data flow"; this is now the same claim.
//
// Layered DAG, 5 columns:
//   L1 External systems → L2 Connectors/Scripts → L3 Tables → L4 AI tasks
//   → L5 Dashboards
//
// The AI lane was added after the original four and is where every
// LLM-backed extraction, narrative and insight sits.
//
// Edges always flow left → right. Derived cubes (EducationStudentCube et al)
// collapse into their landing-table ancestor (StudentProgramRecord) to
// keep the picture readable; the side-panel meta line names the cubes for
// operators who need that detail.
//
// Live enrichment (real/mocked status + lastSyncedAt) is layered on top
// of the connector nodes by the page wrapper — see page.tsx. Anything
// not in DataSource (scripts, internal tables) just renders the static
// node without a live badge.
// ──────────────────────────────────────────────────────────────────────────

import type { DataSourceMarkSlug } from '@/components/data-source-mark';

export type NodeLane = 'external' | 'connector' | 'table' | 'ai' | 'dashboard';

export type NodeKind =
  | 'oracle'
  | 'mysql'
  | 'mssql'
  | 'postgres'
  | 'gsheet'
  | 'pdf'
  | 'ai-provider'
  | 'connector'
  | 'script'
  | 'ai-task'
  | 'table'
  | 'cube'
  | 'dashboard';

export interface TopologyNode {
  id: string;
  lane: NodeLane;
  kind: NodeKind;
  label: string;
  /** One-line subtitle shown under the label in the node card. */
  subtitle?: string;
  /** Optional URL the node opens in a new tab when "Open" is clicked. */
  href?: string;
  /**
   * For ai-task nodes only — which LLM the task uses. Defaults to
   * 'gemini' when the node kind is 'ai-task' and this field is missing.
   * Surfaced as an inline vendor pill on the node (GEMINI / CLAUDE).
   */
  llm?: 'gemini' | 'claude';
  /**
   * Upstream data-provider brand. Renders that provider's icon on the node
   * card. Every node carrying or deriving JobThai data sets `'jobthai'` —
   * see apps/web/src/components/data-source-mark.tsx for the rule.
   */
  brand?: DataSourceMarkSlug;
  /** Free-form details surfaced in the right-hand detail panel. */
  details?: {
    description?: string;
    /** Connection target — `host:port/db` or a path. */
    target?: string;
    /** Cron expression in human form ("Daily 04:00", "Manual", …). */
    cadence?: string;
    /** `DataSource.slug` for live status enrichment from /data-sources. */
    sourceSlug?: string;
    /** Prisma model name for table nodes. */
    prismaModel?: string;
    /** Other tables this one aggregates into (or is derived from). */
    relatedTables?: string[];
    /** Free-form notes — render as a list of bullet strings. */
    notes?: string[];
  };
}

export interface TopologyEdge {
  from: string;
  to: string;
  /**
   * Which dashboard family this edge ultimately serves. Used to filter the
   * graph and to dim non-matching paths when the user picks
   * "Education" or "Staff". An edge without a scope serves both.
   */
  scope?: ('education' | 'staff')[];
}

export interface Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

// ──────────────────────────────────────────────────────────────────────────
// L1 — External systems
// ──────────────────────────────────────────────────────────────────────────

const externalNodes: TopologyNode[] = [
  {
    id: 'ext.oracle-powerbi',
    lane: 'external',
    kind: 'oracle',
    label: 'KKU-Reg Warehouse (Oracle)',
    subtitle: 'POWERBI.* views',
    details: {
      description:
        "KKU's Oracle 19c registrar warehouse — the canonical source for admission funnels, class offerings, and per-student fee aggregates.",
      target: 'KKU_REGISTRY_DB (Oracle thin-mode)',
      notes: [
        'POWERBI.ADMISSION_STAT — actual recruitment campaigns (campaign × round × year); ADMISSION_STAT_CURRID retired',
        'POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER — every section the registrar opened',
        'POWERBI.VIEWSTUDENTENROLLFEE × VIEW_STUDENT_DETAIL_ALL — tuition aggregates',
      ],
    },
  },
  {
    id: 'ext.mysql-research-services',
    lane: 'external',
    kind: 'mysql',
    label: 'KKU Research & Academic Services (MySQL)',
    subtitle: 'External grants · co-investigators',
    details: {
      description:
        "KKU Research Administration's record of externally funded research and academic-service projects (ทุนภายนอก), with each project's lead and co-investigators.",
      target: '10.101.106.65 (MySQL 5.7)',
      notes: [
        'T_external_fund_View_landscape = one row per project (~4.3k)',
        'coproject_landscape = one row per co-investigator (~5.5k), joined on proposal_id_md5',
        "Read-only login. The password contains '#', so it must be single-quoted in the env file",
      ],
    },
  },
  {
    id: 'ext.mysql-unicon',
    lane: 'external',
    kind: 'mysql',
    label: 'MHESI UniCON via KKU (MySQL)',
    subtitle: 'DS1001 / DS2001 / DS2003 / DS2004',
    details: {
      description:
        "MHESI's national datasets exposed to each university via UNICON. Students, staff, education history, staff-program assignments.",
      target: '10.130.2.156 + 10.101.106.44 (MySQL 5.7)',
      notes: [
        'DS1001 = students (35k rows/snapshot)',
        'DS2001 = staff master roster (11k rows/snapshot)',
        'DS2003 = staff education history (18k rows/snapshot)',
        'DS2004 = staff-program assignments',
      ],
    },
  },
  {
    id: 'ext.mysql-kkuhr',
    lane: 'external',
    kind: 'mysql',
    label: 'KKU Legacy HR (MySQL)',
    subtitle: 'person.vw_history',
    details: {
      description:
        'KKU HR processed warehouse — aggregated salary history and lifecycle dates. Aggregation gate (n≥5) applied server-side; per-person salary never crosses the wire.',
      target: '202.28.117.84:3306/person',
    },
  },
  {
    id: 'ext.mssql-hcm',
    lane: 'external',
    kind: 'mssql',
    label: 'Oracle Fusion Warehouse (MSSQL)',
    subtitle: 'EmployeeDetail',
    details: {
      description:
        "KKU's primary HR system (HCM). Read-only login. Source of FacultyMember roster and the kkuEmail backfill for the teaching-workload cross-join.",
      target: '10.101.104.192:1433 (read-only)',
    },
  },
  {
    id: 'ext.pg-kkuscholar',
    lane: 'external',
    kind: 'postgres',
    label: 'KKU Scholar via Library (PostgreSQL)',
    subtitle: 'Internal research mirror',
    details: {
      description:
        "KKU Library's institutional research warehouse — Scopus + PubMed (+ ISI/TCI/NRIIS, stale upstream). 5,459 researcher people, ~99% faculty-resolved. Replaces the deprecated OpenAlex+Scopus public-API path.",
      target: '10.130.2.151:5432/kkuscholar (Postgres 9.5)',
      notes: [
        'scopus_documents / pubmed_documents — paper metadata + KKU author graph',
        'scopus_citescores (512k rows) — per (journal × year × ASJC) quartile, percentile, SJR, top_10_percent; powers the journal-quality enrichment',
      ],
    },
  },
  {
    id: 'ext.gsheet-master',
    lane: 'external',
    kind: 'gsheet',
    label: 'Google Sheets',
    subtitle: 'KKU master programs',
    details: {
      description:
        'KKU master programs sheet — 297 active programs, authoritative for sequenceNo / faculty / level / mhesiCode. Smart-merge with PDF digests.',
      target: 'CSV export from Google Sheets',
    },
  },
  {
    id: 'ext.pdf-curriculum',
    lane: 'external',
    kind: 'pdf',
    label: 'Curriculum PDFs',
    subtitle: 'Operator-uploaded หลักสูตร',
    details: {
      description:
        'Curriculum PDFs (มคอ.2-style) uploaded via /admin/data-setup. Programs-pipeline runs Gemini extraction → digest → courses + skills + pedagogy.',
      target: 'MinIO (curriculum-pdfs bucket)',
    },
  },
  {
    id: 'ext.pdf-reports',
    lane: 'external',
    kind: 'pdf',
    label: 'Operator-uploaded reports',
    subtitle: 'PDF + XLSX — non-curriculum',
    details: {
      description:
        'Everything else operator-uploaded through /admin/data-setup: KKU Alumni outcome reports (PDF/XLSX), IMD World Competitiveness yearbooks, TCAS historical admission scores. The pdf-classify AI task routes each upload to the right ingest script.',
      target: 'MinIO (uploads bucket)',
    },
  },
  {
    id: 'ext.external-ai-sources',
    lane: 'external',
    kind: 'ai-provider',
    label: 'External intelligence sources',
    subtitle: '9 feeds · WEF · OECD · World Bank · NESDC · …',
    details: {
      description:
        'Public policy and labour-market publishers the platform watches for trend signals. Collapsed into one node: they differ only by URL and cadence, and every one flows through the same summarise-then-analyse path.',
      relatedTables: [
        'wef-future-of-jobs',
        'oecd-reports',
        'world-bank',
        'nesdc-reports',
        'nxpo-reports',
        'mhesi-policy',
        'adb-gms',
        'boi-sectoral',
        'eeco-reports',
      ],
      notes: [
        'Fetched pages are summarised into candidate signals; nothing reaches the Radar without passing through trend-signal analysis',
        'Deliberately NOT here: openalex and scopus. Both still read live but are deprecated — kku-research took over publication data in 2026-05 via the internal kkuscholar mirror. Their DataSource rows remain active/unmocked, which is drift worth closing at source rather than modelling as if they were current.',
      ],
    },
  },
  {
    id: 'ext.api-kku-dq',
    lane: 'external',
    kind: 'ai-provider',
    label: 'KKU Digital Intelligence',
    subtitle: 'LTIC DQ test platform',
    details: {
      description:
        "KKU's own Digital Intelligence competency test, run by LTIC (Learning & Digital Support). Serves the entire result set as a single 13.7 MB JSON response in ~3.4s — no pagination, and results only move as students sit the test.",
      notes: [
        'Owner: KKU LTIC — ltic.psli@kku.ac.th',
        'Per-student rows are read but never persisted; only the two aggregate cubes land',
      ],
    },
  },
  {
    id: 'ext.api-kmitl',
    lane: 'external',
    kind: 'postgres',
    label: 'LinkedIn via MHESI API',
    subtitle: 'skill.kmitl.ac.th/api/v1',
    details: {
      description:
        'KMITL-hosted REST endpoint. Aggregated skill-demand intelligence sourced from LinkedIn (MHESI subscription) + Thai job postings. Never call it "KMITL data" in user-facing surfaces — KMITL only hosts the API; the data is LinkedIn × MHESI.',
      target: 'https://skill.kmitl.ac.th/api/v1',
      notes: [
        'Server-to-server auth: base64(clientId:secretKey) bearer token',
        'Rate-limit not published — connector throttles defensively at 5 req/s',
        'Aggregate-only API; no per-employer/per-person fields',
      ],
    },
  },
  {
    id: 'ext.jobthai',
    lane: 'external',
    kind: 'gsheet',
    brand: 'jobthai',
    label: 'JobThai XLSX drops',
    subtitle: 'jobthai.com · file delivery',
    details: {
      description:
        'Per-posting job-vacancy exports JobThai delivers as XLSX files. Uploaded by an analyst at /admin/jobthai; each file becomes a JobThaiBatch. Gives province and industry detail the LinkedIn-via-MHESI aggregates cannot.',
      target: 'MinIO csv-uploads/jobthai/<sha256>.xlsx',
      notes: [
        'No API — delivery is a file drop; the same file uploaded twice is a no-op (content hash)',
        'Occupations, skill matches and programme links rebuild automatically after every upload or delete',
      ],
    },
  },
  // NOTE: Google Gemini + Anthropic Claude were previously modeled as L1
  // external systems with edges to each AI task. That was the wrong
  // mental model — they're TOOLS the AI tasks use, not data sources.
  // Removed 2026-05-16; LLM provider now shown as an inline vendor pill
  // (GEMINI / CLAUDE) on each ai-task node, driven by the `llm` field.
];

// ──────────────────────────────────────────────────────────────────────────
// L2 — Connectors + manual scripts
// ──────────────────────────────────────────────────────────────────────────

const connectorNodes: TopologyNode[] = [
  // Real connectors (cron-driven, registered in apps/ingestion)
  {
    id: 'con.kku-registry',
    lane: 'connector',
    kind: 'connector',
    label: 'kku-registry',
    subtitle: 'Daily 02:00 · students + grads',
    details: {
      description:
        'Reads POWERBI.* views for per-program enrollment + degree completion. Writes EnrollmentMetric (partial — only enrolled/dropouts/graduatedOnTime; the upstream funnel columns are deferred per kku-registry partial memo) + StudentDemographic.',
      cadence: '0 2 * * * (daily 02:00)',
      sourceSlug: 'kku-registry',
    },
  },
  {
    id: 'con.kku-finance',
    lane: 'connector',
    kind: 'connector',
    label: 'kku-finance',
    subtitle: 'Monthly 1st · tuition + budget',
    details: {
      description:
        'Dual-source: Oracle POWERBI.VIEWSTUDENTENROLLFEE for per-program tuition revenue + MSSQL ERPPowerBI.BudgetData for per-faculty budget allocations. Server-side aggregation (HAVING n≥5).',
      cadence: '0 3 1 * * (monthly 1st 03:00)',
      sourceSlug: 'kku-finance',
    },
  },
  {
    id: 'con.kku-alumni',
    lane: 'connector',
    kind: 'connector',
    label: 'kku-alumni',
    subtitle: 'Quarterly · PDF/XLSX intake',
    details: {
      description:
        'Connector API itself is a stub. Real data flows via `pnpm outcomes:ingest` (PDF) and `pnpm outcomes:ingest-xlsx` (XLSX) — KKU Career Services drops quarterly survey reports into /admin/data-setup. mocked=false flipped 2026-05-11.',
      cadence: '0 5 1 */3 * (quarterly) + ad-hoc PDF/XLSX uploads',
      sourceSlug: 'kku-alumni',
      notes: [
        'last_synced_at stays NULL because the script-based intake doesn\'t write IngestionRun rows — by design',
      ],
    },
  },
  {
    id: 'con.kmitl-skill-mapping',
    lane: 'connector',
    kind: 'connector',
    label: 'linkedin-skill-mapping',
    subtitle: 'Mon 06:00 · LinkedIn skill demand',
    details: {
      description:
        'Aggregated LinkedIn skill demand (THAILAND × JOB_POSTINGS quadrant primary). 14 career groups, 401 careers, 2,841 skills. KMITL only hosts the API endpoint; the data itself is LinkedIn × MHESI. Drives the labour-market-alignment driver on health-score.v2 + the Gap Analyzer demand side.',
      cadence: '0 6 * * 1 (Mondays 06:00)',
      // Technical: DataSource.slug in /admin/data-sources is still
      // 'kmitl-skill-mapping' — that's the original ingestion-framework
      // slug. Label above shows the upstream-attribution-correct name.
      sourceSlug: 'kmitl-skill-mapping',
    },
  },
  {
    id: 'con.jobthai',
    lane: 'connector',
    kind: 'connector',
    brand: 'jobthai',
    label: 'jobthai',
    subtitle: 'On upload or delete · postings, then rebuild',
    details: {
      description:
        'One run per upload or delete at /admin/jobthai. Parses PENDING batches into JobPosting rows, then — once no batch is pending — rebuilds every derived layer from the postings that now exist: occupations, deterministic skill matches against the taxonomy (word-bounded Latin terms, length-floored Thai terms), and programme ↔ occupation links by stated field of study (jobthai-bridge.v3 — an approved field in the taxonomy decides through its reviewed programme assignments, otherwise the field string is matched against the programme name). No LLM spend.',
      cadence: 'Event-driven · queued by each upload and each delete (no schedule)',
      sourceSlug: 'jobthai',
      notes: [
        'Uploading several files queues several runs; the worker runs 4 jobs at once and the runner skips overlapping copies, so /admin/queues shows them as skipped. The surviving run drains every batch that arrives while it is busy, then rebuilds once.',
        'The rebuild scans every posting and takes roughly ten minutes at 47k postings; the run shows RUNNING throughout.',
        'pnpm jobthai:derive and pnpm jobthai:link-programs run the same code for dry runs and repair.',
        'The AI curriculum check is NOT run here — it costs money per programme and runs in programs-pipeline phase 3.',
      ],
    },
  },
  {
    id: 'con.tcas',
    lane: 'connector',
    kind: 'connector',
    label: 'tcas',
    subtitle: 'Annual May 15 · national admission',
    details: {
      description:
        'TCAS national admission test scores + programme-level cutoffs. Historical XLSX import (pre-connector-framework); 25,705 peer rows for benchmarking. Connector class is a stub — real data was bulk-loaded.',
      cadence: '0 9 15 5 * (annual mid-May)',
      sourceSlug: 'tcas',
    },
  },
  {
    id: 'con.imd-rankings',
    lane: 'connector',
    kind: 'connector',
    label: 'imd-rankings',
    subtitle: 'Manual · IMD yearbook',
    details: {
      description:
        'IMD World Competitiveness Yearbook + World Talent Ranking + World Digital Competitiveness. 67 economies. Free public summaries only (no Smartcomp subscription). Manual run-now after each release.',
      cadence: 'Manual (no cron — schedule_enabled=false by design)',
      sourceSlug: 'imd-rankings',
    },
  },
  {
    id: 'con.kku-tcas-funnel',
    lane: 'connector',
    kind: 'connector',
    label: 'kku-tcas-funnel (deprecated)',
    subtitle: 'schedule off',
    details: {
      description:
        'DEPRECATED 2026-05-31 — superseded by kku-admission-campaigns (POWERBI.ADMISSION_STAT). Schedule disabled; connector + table kept for a verification window. Historical: pulled POWERBI.ADMISSION_STAT_CURRID, one row per CURR_ID × ROUND × ACADYEAR.',
      cadence: 'disabled',
      sourceSlug: 'kku-tcas-funnel',
    },
  },
  {
    id: 'con.kku-admission-campaigns',
    lane: 'connector',
    kind: 'connector',
    label: 'kku-admission-campaigns',
    subtitle: 'Daily 04:30',
    details: {
      description:
        'Pulls POWERBI.ADMISSION_STAT (campaign-track grain — one row per WPROGRAMID). CURR_ID resolves to Program via mhesiCode (+ alias table); program_id stored on each row. The recruitment source of record for scoring, deep-dive, risk, cockpit + the recruitment dashboard.',
      cadence: '30 4 * * * (daily 04:30 Asia/Bangkok)',
      sourceSlug: 'kku-admission-campaigns',
    },
  },
  {
    id: 'con.unicon-ds1001',
    lane: 'connector',
    kind: 'connector',
    label: 'unicon-ds1001',
    subtitle: 'Daily 04:00 · students',
    details: {
      description:
        'Reads MHESI UNICON DS1001 (students). Snapshot per (academicYear, semester). PII gate: citizen_id + STD_ID hashed, BIRTHDAY → birth_year only.',
      cadence: '0 4 * * * (daily 04:00)',
      sourceSlug: 'unicon-ds1001',
    },
  },
  {
    id: 'con.unicon-ds2001',
    lane: 'connector',
    kind: 'connector',
    label: 'unicon-ds2001',
    subtitle: 'Daily 05:00 · staff master',
    details: {
      description:
        'Reads MHESI UNICON DS2001 — every KKU staff snapshot. DEPARTMENT_ID resolves to Faculty via the dept-code map built from DS2004.',
      cadence: '0 5 * * * (daily 05:00)',
      sourceSlug: 'unicon-ds2001',
    },
  },
  {
    id: 'con.unicon-ds2003',
    lane: 'connector',
    kind: 'connector',
    label: 'unicon-ds2003',
    subtitle: 'Daily 02:00 · education history',
    details: {
      description:
        'Reads MHESI UNICON DS2003 — per-staff education history. One row per (staff × degree). Feeds the profile-page education section.',
      cadence: '0 2 * * * (daily 02:00)',
      sourceSlug: 'unicon-ds2003',
    },
  },
  {
    id: 'con.unicon-ds2004',
    lane: 'connector',
    kind: 'connector',
    label: 'unicon-ds2004',
    subtitle: 'Daily 03:00 · staff↔program',
    details: {
      description:
        'Reads MHESI UNICON DS2004 — per (staff × program × teach_type). teach_type: 1=regular, 2=curriculum, 3=responsible lecturer. Feeds /staff/faculty-by-program.',
      cadence: '0 3 * * * (daily 03:00)',
      sourceSlug: 'unicon-ds2004',
    },
  },
  {
    id: 'con.kku-research-services',
    lane: 'connector',
    kind: 'connector',
    label: 'kku-research-services',
    subtitle: 'Daily 04:00 · external grants',
    details: {
      description:
        'Reads both research-services views, matches leads to staff by citizen-id hash then KKU email and co-investigators by HR employee id, and replaces both grant tables in one transaction. Feeds /staff/grants, the owner-only /profile grants panel, the external Staff Profile API `grants` section, and the external-grant award on the Financial dimension (health-score.v5.4).',
      cadence: '0 4 * * * (daily 04:00)',
      sourceSlug: 'kku-research-services',
      notes: [
        'PDPA gate at source: the lead citizen id is hashed inside MySQL (SHA2); staff email is read for matching and never stored',
        'Row-level validation (bad rows skipped; SCHEMA_DRIFT when > 1 % invalid) and a 50 % shrink guard keep a bad pull from wiping the snapshot',
        'Measured 2026-10-02: 88.5 % of leads and 70.0 % of six-digit co-investigator ids matched to staff records',
      ],
    },
  },
  {
    id: 'con.kku-hr-processed',
    lane: 'connector',
    kind: 'connector',
    label: 'kku-hr-processed',
    subtitle: 'Daily 06:00 · compensation',
    details: {
      description:
        'Aggregated salary cube (n≥5 gate) + lifecycle dates (birth, hire, retire, sixty-day). Faculty resolution via nameTh exact-match.',
      cadence: '0 6 * * * (daily 06:00)',
      sourceSlug: 'kku-hr-processed',
    },
  },
  {
    id: 'con.kku-hr',
    lane: 'connector',
    kind: 'connector',
    label: 'kku-hr',
    subtitle: 'Weekly Mon 04:00 · roster',
    details: {
      description:
        'HCM employee roster + rank + appointment. Cross-database join through epm_report.workforce_hcm_actual. ~3,800 FacultyMember rows (~2,400 hr_ + ~1,400 kkupub_ prefix).',
      cadence: '0 4 * * 1 (Mondays 04:00)',
      sourceSlug: 'kku-hr',
    },
  },
  {
    id: 'con.kku-research',
    lane: 'connector',
    kind: 'connector',
    label: 'kku-research',
    subtitle: 'Sun 06:00 · publications + journal quality',
    details: {
      description:
        'Pulls Scopus + PubMed publications via the kkuscholar mirror. ~90k (paper × author) upserts/run; ~90% resolve to a FacultyMember after the people backfill. Each Scopus paper is enriched with its journal quartile (Q1–Q4), Tier-1 / top-10% flag, CiteScore percentile and SJR via a LATERAL join on scopus_citescores (nearest metric-year ≤ cover year, aggregated across the journal\'s ASJC subject areas).',
      cadence: '0 6 * * 0 (Sundays 06:00)',
      sourceSlug: 'kku-research',
      notes: [
        'Quartile enrichment is Scopus-only — PubMed rows carry null quartile/percentile/SJR.',
        'Also exposed as a manual "Research output" refresh on /admin/dashboard-data-fetch.',
      ],
    },
  },
  {
    id: 'con.external-ai-sources',
    lane: 'connector',
    kind: 'connector',
    label: 'external-ai-sources',
    subtitle: 'Scheduled · 9 active feeds',
    details: {
      description:
        'Fetches each watched source, hands the page text to the feed summariser, and lands the result as a candidate trend signal. One worker covers all nine feeds rather than one connector per publisher.',
      cadence: 'Per-source schedule · external-ai-sources worker',
      notes: [
        'A source that fails to fetch is logged and skipped — one unreachable publisher does not fail the run',
      ],
    },
  },
  {
    id: 'con.kku-dq',
    lane: 'connector',
    kind: 'connector',
    label: 'kku-dq',
    subtitle: 'Weekly · Digital Intelligence scores',
    details: {
      description:
        "Per-student DQ competency results from KKU LTIC — 13 theory + 4 workshop modules, pass mark 70. The whole export is one 13.7 MB response in ~3.4s, so there is no pagination to manage; results only move as students sit the test. Aggregated in memory to two cubes on the way in.",
      cadence: '0 3 * * 1 (weekly, Monday 03:00)',
      sourceSlug: 'kku-dq',
      notes: [
        'PDPA gate at the connector: no student names or ids are persisted — only the two aggregate cubes land',
        "DQ's own allPassed verdict is passed through unchanged, never recomputed here; the source is inconsistent about module 13 (Generative AI)",
      ],
    },
  },
  {
    id: 'con.kku-evaluations',
    lane: 'connector',
    kind: 'connector',
    label: 'kku-evaluations',
    subtitle: 'Bi-weekly · student satisfaction',
    details: {
      description:
        'Pre-aggregated student-evaluation ratings from POWERBI.EVALUATE_INSTRUCTOR — ~986K (class × question × instructor) cells loaded per run, semesters 1+2 across BE 2564–2569. Server-side HAVING TOTAL_STUDENT >= 5 anonymity gate. ~110 min wall-clock end-to-end load. Drives /education/satisfaction (course-aggregated), /staff/teaching (instructor-individual), and the `student_satisfaction` driver of health-score.v3.7 outcomes dimension.',
      cadence: '0 21 1,15 * * (1st + 15th at 21:00)',
      sourceSlug: 'kku-evaluations',
      notes: [
        'PDPA gate at source: HAVING TOTAL_STUDENT >= 5 server-side — per-student responses never reach our DB',
        'Force a refresh via /admin/dashboard-data-fetch when a Council meeting needs the latest semester before the next bi-weekly slot',
      ],
    },
  },
  // Manual scripts (no DataSource row — no live status badge)
  {
    id: 'scr.link-class-offerings',
    lane: 'connector',
    kind: 'script',
    label: 'link-class-offerings',
    subtitle: 'Manual · class offerings',
    details: {
      description:
        'Full delete-and-replace of class_offerings + class_offering_teachers from POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER. Bundled to dist/ for prod operator-run.',
      cadence: 'Manual — pnpm programs:link-class-offerings',
    },
  },
  {
    id: 'scr.materialise-program-courses',
    lane: 'connector',
    kind: 'script',
    label: 'materialise-program-courses',
    subtitle: 'Manual · program ↔ course',
    details: {
      description:
        'Reads approved PROGRAM_DIGEST AiExtractions and writes program_courses (snapshot per program). Drives the PROGRAM_USER scope clamp on the class-offerings + teaching-workload dashboards.',
      cadence: 'Manual / programs-pipeline phase 2',
    },
  },
  {
    id: 'scr.backfill-faculty-emails',
    lane: 'connector',
    kind: 'script',
    label: 'backfill-faculty-member-emails',
    subtitle: 'One-shot · kkuEmail backfill',
    details: {
      description:
        'Joins FacultyMember.employeeId ↔ HCM.EmployeeDetail.EMPLOYEEID, fallback on citizenIdHash. Lowercased + dedup. Enables the KKUMAIL → FacultyMember resolution in link-class-offerings.',
      cadence: 'Manual — pnpm staff:backfill-emails',
    },
  },
  {
    id: 'scr.seed-programs-from-sheet',
    lane: 'connector',
    kind: 'script',
    label: 'seed-programs-from-sheet',
    subtitle: 'Manual · master programs',
    details: {
      description:
        'Smart-merge from the KKU master sheet. Preserves PDF-digest fields (nameEn, totalCredits, language, recruitmentSummaryTh) and only writes the sheet-authoritative fields (sequenceNoFromSheet, facultyId, level, mhesiCode).',
      cadence: 'Manual — pnpm programs:seed-from-sheet',
    },
  },
  {
    id: 'scr.jobthai-fields',
    lane: 'connector',
    kind: 'script',
    brand: 'jobthai',
    label: 'jobthai-fields',
    subtitle: 'After every JobThai refresh · field taxonomy',
    details: {
      description:
        'Collects the free-text field-of-study strings on JobThai postings, clusters those with at least 5 mentions into canonical fields (job-field-taxonomy.v1, 200 per batch, existing non-rejected fields riding along as anchors), then assigns programmes to them — the bridge’s name-match rule first, program-job-field.v1 for the remainder. The only model spend in the JobThai chain. Existing APPROVED and REJECTED rows are never renamed, downgraded or stripped of synonyms; every write stamps the run so the rows pass realDataWhere().',
      cadence: 'After every JobThai batch refresh · operator dry-run + --apply',
      notes: [
        'pnpm jobthai:fields is a dry run that still makes the model calls — a truthful preview, not a free one. --apply is the only flag accepted.',
        'A model outage logs "fields: FAILED — … (run pnpm jobthai:fields --apply to retry)" and does NOT fail the batch; committed batches stay committed and a retry continues rather than duplicating.',
        'A raw string the model declines to attach is re-sent on every refresh (~127 strings, ~$0.17 a run) until a declined-string ledger exists.',
        'Bundled to dist/ for prod operator-run.',
      ],
    },
  },
  {
    id: 'scr.programs-pipeline',
    lane: 'connector',
    kind: 'script',
    label: 'programs-pipeline',
    subtitle: 'Manual · 8-phase orchestrator',
    details: {
      description:
        'Composes digest + faculty + skills + pedagogy + careers + cohorts + alumni + financials + peers + ai-readiness + narrative + risks into a single idempotent run. Single program or --all.',
      cadence: 'Manual / per-PDF · pnpm programs:pipeline',
    },
  },
  {
    id: 'scr.programs-overlap-prep',
    lane: 'connector',
    kind: 'script',
    label: 'programs-overlap-prep',
    subtitle: 'Manual · overlap data prep',
    details: {
      description:
        'Data preparation for programme overlap (program-overlap.v1): the PLO table from the latest PROGRAM_SKILLS_DETAILED extraction, course descriptions + CLOs from APPROVED / AUTO_APPROVED digests, market profiles (names, degree names, recruitment summary, careers), then 1536-d embeddings of PLOs, every major course and every market profile.',
      cadence: 'Manual · pnpm programs:overlap-prep [--apply]',
      notes: [
        'Dry run counts only and makes no model call; --apply writes',
        'Idempotent: a vector is re-embedded only when the sha256 of its text changes',
        'Course categories come from a separate phase-2b backfill (program-courses-extract.v4), run first',
        'Bundled to dist/ for prod operator-run.',
      ],
    },
  },
  {
    id: 'scr.programs-overlap',
    lane: 'connector',
    kind: 'script',
    label: 'programs-overlap',
    subtitle: 'Manual · same-level overlap run',
    details: {
      description:
        'Scores every same-level pair of canonical ACTIVE programmes (program-overlap.v1): a course-based overlap index (shared courses + equivalent courses), PLO alignment as context, containment, shared staff, market similarity and rule-chosen actions. Writes one ProgramOverlapRun per level with its stored pairs, then the AI wording for flagged pairs. Pipeline phase OV writes scoped runs for selected programmes.',
      cadence: 'Manual · pnpm programs:overlap [--apply] [--no-ai] · programs-pipeline phase OV',
      notes: [
        'Dry run computes everything and prints the distributions; writes nothing',
        'Readers take the latest SUCCEEDED full run per level and overlay newer scoped runs (program-overlap/merge.ts)',
        'Bundled to dist/ for prod operator-run.',
      ],
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // AI tasks — grouped by trigger family.
  //
  // Each AI task node represents one prompt template (or, where the
  // programs-pipeline runs several related prompts back-to-back on the
  // same input, the collapsed group of them). Detail panels name the
  // exact methodVersion(s) and downstream tables.
  //
  // Every AI task writes an AiInference audit row regardless of success
  // — we render the AiInference edge from each one. Domain-specific
  // outputs (AiExtraction, ProgramStrategicNarrative, RiskAssessment …)
  // are shown as separate edges where they're consumed by a dashboard
  // downstream.
  // ──────────────────────────────────────────────────────────────────────

  // Programs-pipeline phase 1 — runs 4 prompts in parallel against the
  // same curriculum PDF. Collapsed to one node because they share input
  // and downstream materialisation logic.
  {
    id: 'ai.curriculum-extraction',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Curriculum extraction',
    subtitle: 'Phase 1 · digest + faculty + skills + pedagogy',
    details: {
      description:
        'Per-PDF Gemini extraction — 4 prompts run in parallel: program-digest.v2 (course list + recruitment summary + generalised skills), program-faculty.v1 (responsible lecturers), program-skills-detailed.v2 (ESCO-tagged skill weights), program-pedagogy.v1.1 (teaching-method distribution).',
      cadence: 'Per-PDF · programs-pipeline phase 1',
      notes: [
        'Writes AiExtraction rows (4 types); materialise step lifts approved digests into Program + ProgramCourse + ProgramSkill',
        'Pedagogy v1.1 fixed the min(5)→min(2) schema bug that was rejecting 3-char acronyms (PBL, OSCE, EBM)',
      ],
    },
  },
  {
    id: 'ai.program-careers-demand',
    lane: 'ai',
    kind: 'ai-task',
    brand: 'jobthai',
    label: 'Program careers + demand',
    subtitle: 'Phase 3 · demand-match.v4 fit',
    details: {
      description:
        "Maps the program to LinkedIn careers (career-kmitl-mapping), then checks every demanded skill from BOTH LinkedIn and JobThai against the program's PLOs, courses and extracted skills in one call (demand-match.v4). Each skill gets taught / not taught and a profession fit — core, supporting, other-profession, not-relevant or uncertain — with a reason, judged against the program's target careers. Rows record which source demanded the skill.",
      cadence: 'Per-program · programs-pipeline phase 3',
      notes: [
        'Only core and supporting count as relevant; other-profession skills are shown as degrees employers also accept, never as gaps.',
        'New JobThai files change the demand lists immediately, but a programme\'s fit judgements update only when this phase next runs for it.',
      ],
    },
  },
  {
    id: 'ai.program-peers',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Program peers',
    subtitle: 'Phase 5 · selection + review',
    details: {
      description:
        'Two-step peer benchmarking: program-peer-selection.v1 picks 6–10 similar programs from THE/QS/SCImago + KKU\'s seeded peer sets; program-peer-review.v2 (thinking mode) writes the comparative narrative.',
      cadence: 'Per-program · programs-pipeline phase 5',
    },
  },
  {
    id: 'ai.program-ai-readiness',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Program AI readiness',
    subtitle: 'Phase 6 · program-ai-readiness.v4',
    details: {
      description:
        'Discipline-aware assessment — how exposed is this program\'s graduates\' work to AI automation, and what does the curriculum need to add. Reads program skills + pedagogy + peer outputs.',
      cadence: 'Per-program · programs-pipeline phase 6',
    },
  },
  {
    id: 'ai.program-narrative',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Program narrative',
    subtitle: 'Phase 7 · program-strategic-narrative.v3',
    details: {
      description:
        "Thai-primary strategic narrative — the one the Council reads on the Deep-Dive's hero section. Synthesises every prior phase's output into a 600-word brief with confidence + caveats.",
      cadence: 'Per-program · programs-pipeline phase 7',
    },
  },
  {
    id: 'ai.program-research-expertise',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Research expertise',
    subtitle: 'Phase RE · program-research-expertise.v3',
    details: {
      description:
        "Clusters the programme's own staff publications into named research themes, each with the papers and authors behind it. Reads ResearchOutput joined through ProgramFaculty, so a theme can only cite work by staff actually attached to the programme.",
      cadence: 'Per-program · programs-pipeline phase RE',
      notes: [
        'Insert-only, and skipped when a row already exists for the current curriculum revision — a revised มคอ.2 regenerates it, an unchanged one costs nothing',
      ],
    },
  },
  {
    id: 'ai.program-curriculum-revision',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Curriculum revision',
    subtitle: 'Phase CR · program-curriculum-revision.v1',
    details: {
      description:
        'Turns the research themes above into course-level advice: enhancements to named existing courses, proposals for courses the programme lacks, and electives that merit promotion to required. Every course code, theme, paper title and staff name it cites is validated against the programme before the row is written — anything invented is dropped.',
      cadence: 'Per-program · programs-pipeline phase CR (reads phase RE)',
      notes: [
        'Returns a $0 SKIPPED when phase RE has produced no themes, rather than inventing advice from nothing',
        'Refuses to recommend closing, retiring or merging a course — that judgement is not made from research volume',
      ],
    },
  },
  {
    id: 'ai.program-courses-extract',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Course list extraction',
    subtitle: 'Phase 2b · program-courses-extract.v4',
    details: {
      description:
        "Reads the course list out of the มคอ.2 — code, title, credits, description, and the หมวด each course sits under (ศึกษาทั่วไป / บังคับ / เลือก / วิทยานิพนธ์). The category is what makes elective-to-required advice possible downstream.",
      cadence: 'Per-program · programs-pipeline phase 2b',
      notes: [
        'Scoped to the รายวิชา section only — earlier versions read the whole PDF and pulled old-curriculum codes out of the revision-comparison appendix',
        'Skips with a stated reason when that section cannot be located, rather than extracting from the full document',
      ],
    },
  },
  {
    id: 'ai.trend-signal-analysis',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Trend signal analysis',
    subtitle: 'Per-signal · trend-signal-analysis.v4',
    details: {
      description:
        'Enriches a raw trend signal into the form the Radar shows: affected programmes with per-programme job-position candidates (hireable now vs reachable in 1-3 years), recommended actions, and a white-space check proposing re-skill products for demanded roles no KKU programme supplies.',
      cadence: 'Per-signal · on ingest, and via pnpm trends:analyze',
    },
  },
  {
    id: 'ai.trend-document-ingest',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Trend doc → signal',
    subtitle: 'Per-upload · trend-document-ingest.v2',
    details: {
      description:
        'Drafts a TrendSignal from an uploaded PDF or a pasted URL (a manpower-demand or job-posting report, typically), then hands it to the analysis task above so document-sourced and monitor-sourced signals end up in the same shape.',
      cadence: 'Manual — /admin/trend-documents, or pnpm trends:ingest-doc',
    },
  },
  {
    id: 'ai.external-feed-summary',
    lane: 'ai',
    kind: 'ai-task',
    label: 'External feed summary',
    subtitle: 'Per-source · external-feed-summary.v2',
    details: {
      description:
        'Summarises fetched pages from the external AI-search sources (WEF, IMD, BOI, World Bank, Google News and the rest) into candidate trend signals.',
      cadence: 'Scheduled · external-ai-sources worker',
    },
  },
  {
    id: 'ai.course-skill-extraction',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Course → skills',
    subtitle: 'Queued · course-skills.v2',
    details: {
      description:
        'Maps a single course description onto the skill taxonomy. Runs as an ai-jobs queue task rather than inside the pipeline.',
      cadence: 'Queued · EXTRACT_COURSE_SKILLS',
    },
  },
  {
    id: 'ai.job-posting-skills',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Job posting → skills',
    subtitle: 'Queued · job-posting-skills.v2',
    details: {
      description:
        'Extracts demanded skills from a job posting, feeding the labour-market side of the Gap Analyzer.',
      cadence: 'Queued · EXTRACT_JOB_POSTING_SKILLS',
    },
  },
  {
    id: 'ai.graduate-employment-survey',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Employment survey parse',
    subtitle: 'Per-import · graduate-employment-survey.v2',
    details: {
      description:
        'Reads the graduate employment survey workbook into structured outcome rows — employer, sector, province, salary band.',
      cadence: 'Manual — pnpm outcomes:ingest-xlsx',
    },
  },
  {
    id: 'ai.imd-rankings-extract',
    lane: 'ai',
    kind: 'ai-task',
    label: 'IMD rankings extraction',
    subtitle: 'Per-report · imd-rankings.v2',
    details: {
      description:
        'Pulls Thailand-relevant indicators out of the IMD World Competitiveness report PDF into IMDRanking rows.',
      cadence: 'Annual · per published report',
    },
  },
  {
    id: 'ai.skill-name-normaliser',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Skill-name normalisation',
    subtitle: 'Housekeeping · skill-name-normaliser.v2',
    details: {
      description:
        'Collapses near-duplicate skill names in the taxonomy so the same competency is not counted twice under two spellings.',
      cadence: 'Weekly · kku-skills-normalise systemd timer',
    },
  },
  {
    id: 'ai.aunqa-narrative',
    lane: 'ai',
    kind: 'ai-task',
    label: 'AUN-QA self-assessment draft',
    subtitle: 'On demand · aunqa-criterion-narrative.v1',
    details: {
      description:
        'Drafts the self-assessment prose for one AUN-QA criterion from the evidence the platform actually holds for that programme. One criterion per call — never fired on page load, and never for all criteria at once.',
      cadence: 'Manual — per criterion, from /teaching-learning/[programId]',
    },
  },
  {
    id: 'ai.evaluation-question-translate',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Evaluation Q translation',
    subtitle: 'One-shot · TH → EN for the 40 survey questions',
    details: {
      description:
        'Translates the questionnaire from Thai to English in one Gemini call (~$0.02 per run). Watermarks each row as "(EN — AI translation, pending review)" so DEAN can override per question via questionTextEnOverride.',
      cadence: 'Manual — pnpm evaluations:translate-questions',
      notes: [
        'Methodology: evaluation-question-translate.v1',
        'Re-run when the registrar adds new QIDs (40 today across core / extended / recent / specialised tiers)',
      ],
    },
  },
  {
    id: 'ai.risk-assess',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Risk assessment',
    subtitle: 'Phase 8 · risk-assessment.v4',
    details: {
      description:
        'Combines deterministic L1/L2/L3 scores (risk-scoring.v1) with AI narrative + 2-4 specific RiskMeasure recommendations per program. Writes RiskAssessment + RiskMeasure + KRI breach evaluations.',
      cadence: 'Per-program · programs-pipeline phase 8',
    },
  },
  {
    id: 'ai.program-overlap-embed',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Overlap embeddings',
    subtitle: 'gemini-embedding-001 · 1536-d',
    details: {
      description:
        'Embeds PLOs, every major course (names, plus description and CLOs where present) and every programme market profile at 1536 dimensions, L2-normalised before storage. Vectors are written and read through raw SQL with Zod-validated results.',
      cadence: 'Per overlap prep · pnpm programs:overlap-prep --apply',
    },
  },
  {
    id: 'ai.program-overlap-recommendation',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Overlap recommendation',
    subtitle: 'Phase OV · program-overlap-recommendation.v2',
    details: {
      description:
        'English reasoning for a flagged overlap pair (at least one action and index ≥ 50): rationale, what is distinctive on each side, 2–4 next steps, confidence, and an optional disagreement with the rule-chosen action. Never changes the action. Reused across runs while the pair evidence hash and prompt version are unchanged.',
      cadence: 'Per overlap run · programs:overlap --apply / phase OV',
    },
  },

  // Module AI tasks — fired on-demand from a specific module surface.
  {
    id: 'ai.cockpit-brief',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Cockpit AI brief',
    subtitle: 'On-demand · Council-facing summary',
    details: {
      description:
        'Council-facing 1-page brief generated on the Cockpit. Inline system prompt (no versioned methodVersion); persists only AiInference audit row. Graceful no-key fallback returns a placeholder.',
      cadence: 'User-triggered from /cockpit',
    },
  },
  {
    id: 'ai.gap-brief',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Gap map Council brief',
    subtitle: 'On-demand · gap-brief.v1',
    details: {
      description:
        'One brief over the gap-map rows currently on screen: up to 5 findings, each citing one field of study’s own numbers, plus what the data cannot tell. Every finding is checked against the row it names before it is returned — a verdict that disagrees with its row is corrected to the row’s own, except that a finding giving a supply-unknown row some other verdict is dropped outright (its prose asserts a shortfall the label would deny), as is one whose field name matches more than one row. A finding that correctly calls a supply-unknown row supply-unknown is kept. Replaced gap-insights.v2 and its three modes when the Gap Analyzer was rebuilt as a demand-first map.',
      cadence: 'User-triggered from /gap-analysis',
    },
  },
  {
    id: 'ai.scenario-insights',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Scenario insights',
    subtitle: 'On-demand · scenario-insights.v2',
    details: {
      description:
        '5 modes: suggest-assumptions, identify-risks, compare-narrative, devils-advocate (argues against the apparent-best scenario), what-would-change-my-mind.',
      cadence: 'User-triggered from /scenarios',
    },
  },
  {
    id: 'ai.benchmarking-insights',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Benchmarking insights',
    subtitle: 'On-demand · benchmarking-insights.v2',
    details: {
      description:
        '4 modes: suggest-peers, curriculum-gap, distinctiveness, positioning-brief. All bilingual Thai/English.',
      cadence: 'User-triggered from /benchmarking',
    },
  },
  {
    id: 'ai.analyst-agent',
    lane: 'ai',
    kind: 'ai-task',
    llm: 'gemini',
    label: 'AI Analyst agent',
    subtitle: 'Tool-use · analyst-system.v1',
    details: {
      description:
        "Gemini function-calling tool-use loop (model = gemini-2.5-pro by default, overridable via the ai_model_overrides table — dev uses gemini-flash-latest). 12 typed tools wrap @kku/db helpers: query_programs, get_program, query_skills, query_trends, query_gaps, compare_peers, run_quick_scenario, generate_chart, cite_source, search_policy_docs, search_research, get_methodology. Up to 8 loop iterations per turn. Anthropic remains supported as a fallback provider when AI_PROVIDER=anthropic.",
      cadence: 'User-triggered from /analyst',
      notes: [
        'One AiInference row per LLM invocation; AnalystMessage.aiInferenceIds[] stitches them together',
        'Tool results clipped to 8 KB to keep the LLM context manageable',
        'Rule-based safety gate refuses 5 categories BEFORE the LLM is called',
      ],
    },
  },
  {
    id: 'ai.outcome-review',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Decision outcome review',
    subtitle: 'On-demand · outcome-review.v1',
    details: {
      description:
        '6-month / 1-year / 3-year horizons. Compares CouncilDecision.snapshotJson (frozen at COUNCIL_REVIEWED) against actual outcomes today. Writes DecisionOutcomeReview + AiExtraction.',
      cadence: 'User-triggered from /decisions (nightly cron deferred)',
    },
  },
  {
    id: 'ai.expertise-narrative',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Expertise narrative',
    subtitle: 'On-demand · expertise-narrative.v3',
    details: {
      description:
        "Auto-fires on first /profile load when no cached narrative exists. Pure expertise extraction from education + publication titles only — no biography, no counts, no venues, no program names.",
      cadence: 'Auto · /profile cold load',
    },
  },

  // Document AI tasks — fire as part of the PDF intake pipeline.
  {
    id: 'ai.pdf-classify',
    lane: 'ai',
    kind: 'ai-task',
    label: 'PDF classifier',
    subtitle: 'Per-upload · pdf-classify.v2',
    details: {
      description:
        'Single-shot classifier that assigns PdfDocument.inferredRole — routes the doc to one of 7 extractors (curriculum / policy / research / committee minutes / job postings batch / etc.).',
      cadence: 'Per-PDF upload',
    },
  },
  {
    id: 'ai.policy-doc-analysis',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Policy doc analysis',
    subtitle: 'Per-doc · policy-doc.v2',
    details: {
      description:
        'Analyses MHESI / NESDC / NXPO / BOI policy PDFs and emits TrendSignal rows with bilingual summary + impact tags. Fired via ANALYZE_POLICY_DOC ai-jobs handler.',
      cadence: 'Per-doc · BullMQ ai-jobs queue',
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────
// L3 — Tables (only those read by Edu + Staff dashboards)
// ──────────────────────────────────────────────────────────────────────────

const tableNodes: TopologyNode[] = [
  // TCAS funnel — recruitment dashboard
  {
    id: 'tab.tcas-admission-funnel',
    lane: 'table',
    kind: 'table',
    label: 'TcasAdmissionFunnel (deprecated)',
    subtitle: 'retired — kept for window',
    details: {
      description:
        'DEPRECATED 2026-05-31 — replaced by AdmissionCampaignStat. No longer read by any surface; kept for a verification window then dropped.',
      prismaModel: 'TcasAdmissionFunnel',
    },
  },
  {
    id: 'tab.admission-campaign-stats',
    lane: 'table',
    kind: 'table',
    label: 'AdmissionCampaignStat',
    subtitle: 'campaign × round × year',
    details: {
      description:
        'Actual recruitment campaigns from POWERBI.ADMISSION_STAT — one row per campaign track (WPROGRAMID): plan → seats → applicants → passed → clearinghouse send/confirm → registrar report. program_id + faculty_id resolved at ingest. The recruitment source of record.',
      prismaModel: 'AdmissionCampaignStat',
    },
  },

  // Student program record — the Education student dashboards' single source
  {
    id: 'tab.student-program-record',
    lane: 'table',
    kind: 'table',
    label: 'StudentProgramRecord',
    subtitle: 'snapshot per term',
    details: {
      description:
        'Per (student × academicYear × semester) snapshot. Older snapshots retained. PII-hashed.',
      prismaModel: 'StudentProgramRecord',
      relatedTables: [
        'EducationStudentCube (derived)',
        'EducationStudentLocationCube (derived)',
        'EducationTuitionCube (derived)',
        'EducationPerformanceCube (derived)',
        'EducationEntryScoreCube (derived)',
      ],
      notes: [
        'Education dashboards read from the derived cubes; the cubes are refreshed from this landing table by the education-refresh service.',
      ],
    },
  },

  // Staff master + lifecycle
  {
    id: 'tab.staff-master-record',
    lane: 'table',
    kind: 'table',
    label: 'StaffMasterRecord',
    subtitle: 'snapshot per term',
    details: {
      description:
        'Per (staff × academicYear × semester) snapshot. Source of headcount, hires, separations, age + tenure histograms.',
      prismaModel: 'StaffMasterRecord',
      relatedTables: ['StaffHire (derived)', 'StaffSeparation (derived)'],
    },
  },
  {
    id: 'tab.staff-program-assignment',
    lane: 'table',
    kind: 'table',
    label: 'StaffProgramAssignment',
    subtitle: 'staff ↔ program',
    details: {
      description:
        'Per (staff × program × teach_type) snapshot. teach_type 3 = อาจารย์ผู้รับผิดชอบหลักสูตร (the 5-member quorum the /staff/faculty-by-program flagger watches).',
      prismaModel: 'StaffProgramAssignment',
    },
  },
  {
    id: 'tab.staff-compensation-cube',
    lane: 'table',
    kind: 'cube',
    label: 'StaffCompensationCube',
    subtitle: 'aggregated salary',
    details: {
      description:
        'Aggregated salary cube per fiscal year — n≥5 gate prevents per-person salary identification. Source of /staff/compensation.',
      prismaModel: 'StaffCompensationCube',
    },
  },
  {
    id: 'tab.staff-lifecycle-dates',
    lane: 'table',
    kind: 'table',
    label: 'StaffLifecycleDates',
    subtitle: 'birth · hire · retire',
    details: {
      description:
        'Lifecycle dates from KKU HR processed. Fallback enrichment for FacultyMember when HCM (kku-hr) is the canonical authority.',
      prismaModel: 'StaffLifecycleDates',
    },
  },

  // Faculty/program metadata
  {
    id: 'tab.faculty-member',
    lane: 'table',
    kind: 'table',
    label: 'FacultyMember',
    subtitle: 'roster + kkuEmail',
    details: {
      description:
        'Academic-staff roster. hr_ prefix = from HCM, kkupub_ prefix = from kkuscholar people backfill. The kkuEmail column powers the KKUMAIL cross-join from class offerings.',
      prismaModel: 'FacultyMember',
    },
  },
  {
    id: 'tab.research-output',
    lane: 'table',
    kind: 'table',
    label: 'ResearchOutput',
    subtitle: 'paper × KKU author · journal quality',
    details: {
      description:
        'One row per (paper × KKU co-author). Sources: kku-publications:scopus, kku-publications:pubmed. Older openalex rows retained during the green-history window. Scopus rows carry journal-quality columns — quartile (1–4), citeScorePercentile (journal MAX), top10Percent (Tier 1) and sjr — populated by the kku-research CiteScore enrichment.',
      prismaModel: 'ResearchOutput',
    },
  },
  {
    id: 'tab.research-service-project',
    lane: 'table',
    kind: 'table',
    label: 'ResearchServiceProject',
    subtitle: 'external grant · budget · funder',
    details: {
      description:
        'One row per externally funded research or academic-service project: titles, type, fiscal year (BE), dates, whole-project budget, funder, workflow status, lead unit. Daily snapshot replace; id is rsp-<proposal_id> so links survive the replace.',
      prismaModel: 'ResearchServiceProject',
      relatedTables: ['ResearchServiceProjectMember'],
      notes: ["pmu_okr = 'ซ้ำPMU' is an external parameter, not a duplicate marker — ignored"],
    },
  },
  {
    id: 'tab.research-service-project-member',
    lane: 'table',
    kind: 'table',
    label: 'ResearchServiceProjectMember',
    subtitle: 'lead / co-investigator · staff match',
    details: {
      description:
        "One row per project team member (LEAD or CO_INVESTIGATOR), matched to FacultyMember where possible. The lead's citizen-id hash is PII-class and is read only by the DSAR export.",
      prismaModel: 'ResearchServiceProjectMember',
      relatedTables: ['ResearchServiceProject', 'FacultyMember'],
    },
  },
  {
    id: 'tab.class-offering',
    lane: 'table',
    kind: 'table',
    label: 'ClassOffering',
    subtitle: '~122k rows · BE 2565–2569 · grade dist + class GPA',
    details: {
      description:
        'Every section the registrar opened. Full delete-and-replace per run from POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER. registry_faculty_name resolves to Faculty.nameTh. Grade-distribution columns (grade_a … grade_f + grade_i/w/au/s) added v1.2.9 — class_gpa is precomputed at ingest as the credit×count-weighted KKU 4.0 mean over the 8 graded letters; NULL when graded_count = 0.',
      prismaModel: 'ClassOffering',
    },
  },
  {
    id: 'tab.class-offering-teacher',
    lane: 'table',
    kind: 'table',
    label: 'ClassOfferingTeacher',
    subtitle: '~215k rows · team teaching',
    details: {
      description:
        'Teacher rows per class offering (team-taught classes have N rows). Resolved to FacultyMember via kkuEmail.',
      prismaModel: 'ClassOfferingTeacher',
    },
  },
  {
    id: 'tab.program-course',
    lane: 'table',
    kind: 'table',
    label: 'ProgramCourse',
    subtitle: '~2.5k rows · digest-derived',
    details: {
      description:
        'Materialised from approved PROGRAM_DIGEST AiExtractions. Drives the PROGRAM_USER scope clamp — a program user only sees class offerings whose courseCode is in their program.',
      prismaModel: 'ProgramCourse',
    },
  },
  {
    id: 'tab.evaluation-response-summary',
    lane: 'table',
    kind: 'table',
    label: 'EvaluationResponseSummary',
    subtitle: '~986K cells · BE 2564–2569',
    details: {
      description:
        'Pre-aggregated student-evaluation cell per (acadYearBE × semester × classIdRegistrar × questionIdRegistrar × officerIdRegistrar). Natural key from POWERBI.EVALUATE_INSTRUCTOR; idempotent upsert each run. respondent_count ≥ 5 by construction (PDPA gate at source). Resolves to FacultyMember via kkuEmail and to ClassOffering via classId — both nullable for unmatched cells.',
      prismaModel: 'EvaluationResponseSummary',
      relatedTables: ['EvaluationQuestion (FK)', 'ClassOffering (soft FK)', 'FacultyMember (soft FK)', 'Faculty (soft FK)'],
    },
  },
  {
    id: 'tab.evaluation-question',
    lane: 'table',
    kind: 'table',
    label: 'EvaluationQuestion',
    subtitle: '40 rows · TH + AI-EN catalog',
    details: {
      description:
        'Canonical question catalog with drift detection via questionTextHash (SHA-256 prefix of TH text). Same QID can hold multiple text versions when the registrar edits wording. AI-translated English in questionTextEn (watermarked); DEAN override via questionTextEnOverride.',
      prismaModel: 'EvaluationQuestion',
    },
  },
  {
    id: 'tab.ai-extraction',
    lane: 'table',
    kind: 'table',
    label: 'AiExtraction',
    subtitle: 'PROGRAM_DIGEST · payloadJson',
    details: {
      description:
        'Source-of-truth for all AI-extracted curriculum digests. payloadJson.courses[] is what materialise-program-courses reads.',
      prismaModel: 'AiExtraction (type=PROGRAM_DIGEST)',
    },
  },
  {
    id: 'tab.program',
    lane: 'table',
    kind: 'table',
    label: 'Program',
    subtitle: '297 active rows',
    details: {
      description:
        'Master program metadata — KKU-SEQ-NNNN codes only (legacy mocks purged 2026-05-08).',
      prismaModel: 'Program',
    },
  },
  {
    id: 'tab.program-faculty',
    lane: 'table',
    kind: 'table',
    label: 'ProgramFaculty',
    subtitle: 'program ↔ teacher',
    details: {
      description:
        'Bridge table — which FacultyMembers are listed as responsible lecturers for which Program. Powers the /staff/faculty-by-program drill-down.',
      prismaModel: 'ProgramFaculty',
    },
  },
  {
    id: 'tab.faculty',
    lane: 'table',
    kind: 'table',
    label: 'Faculty',
    subtitle: 'master metadata',
    details: {
      description:
        '30 KKU faculties + central units. Every dashboard joins via facultyId or nameTh exact-match.',
      prismaModel: 'Faculty',
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Tables added in the application-topology expansion — primary outputs
  // of the 6 newly-surfaced connectors + the cluster tables for Scenarios
  // and Decisions.
  // ──────────────────────────────────────────────────────────────────────

  {
    id: 'tab.student-demographic',
    lane: 'table',
    kind: 'table',
    label: 'StudentDemographic',
    subtitle: 'per program × cohort',
    details: {
      description:
        'Gender / home-province / nationality histograms per (Program × cohort). breakdownJson carries the full distribution; full upsert from registrar.',
      prismaModel: 'StudentDemographic',
    },
  },
  {
    id: 'tab.faculty-budget',
    lane: 'table',
    kind: 'table',
    label: 'FacultyBudget',
    subtitle: 'per division × fund × year',
    details: {
      description:
        'Raw KKU budget figures per (divisionName × fundCategory × fiscalYear). Government allocation vs university revenue split. Cascades to FinancialMetric via the cost-allocation methodology (v0 draft pending Finance Committee).',
      prismaModel: 'FacultyBudget',
    },
  },
  {
    id: 'tab.employer-feedback',
    lane: 'table',
    kind: 'table',
    label: 'EmployerFeedback',
    subtitle: 'graduate employer survey',
    details: {
      description:
        'Survey responses from graduate employers. Per (Program × surveyYear): satisfaction, hire-again rate, skill-gap narrative. Sister table to GraduateOutcome.',
      prismaModel: 'EmployerFeedback',
    },
  },
  {
    id: 'tab.staff-education-history',
    lane: 'table',
    kind: 'table',
    label: 'StaffEducationHistory',
    subtitle: 'per staff × degree',
    details: {
      description:
        'Education credentials of every KKU employee. One row per (staff × degree); 18k rows. Powers /profile education section + Deep-Dive faculty qualifications view.',
      prismaModel: 'StaffEducationHistory',
    },
  },
  {
    id: 'tab.kmitl-demand',
    lane: 'table',
    kind: 'cube',
    label: 'LinkedIn skill demand',
    subtitle: 'career × skill % demand',
    details: {
      description:
        '3-table cluster materialised from the LinkedIn-via-MHESI API: 401 careers, ~19k career×skill demand rows (percentage by THAILAND/GLOBAL × PROFILES/JOB_POSTINGS), ~8.5k skill-trend rows. Prisma model names retain the "Kmitl" prefix from the original ingestion-framework slug.',
      prismaModel: 'KmitlCareer + KmitlCareerSkillDemand + KmitlSkillGrowth',
      relatedTables: [
        'LinkedIn careers — KmitlCareer (taxonomy)',
        'LinkedIn skill demand — KmitlCareerSkillDemand (fact)',
        'LinkedIn skill trend — KmitlSkillGrowth (growth signal)',
      ],
    },
  },
  {
    id: 'tab.jobthai-postings',
    lane: 'table',
    kind: 'table',
    brand: 'jobthai',
    label: 'JobThai postings',
    subtitle: 'posting × matched skill',
    details: {
      description:
        'Every JobThai vacancy, one row per posting, with its matched taxonomy skills (rebuilt with the derived layers at the end of each connector run). The only source of job_postings rows. Feeds the /skills demand sample and the Gap Analyzer job-postings demand path.',
      prismaModel: 'JobThaiBatch + JobPosting + JobPostingSkill',
      relatedTables: [
        'JobThai batches — JobThaiBatch (one per uploaded file)',
        'JobThai postings — JobPosting',
        'JobThai posting skills — JobPostingSkill',
      ],
    },
  },
  {
    id: 'tab.jobthai-occupations',
    lane: 'table',
    kind: 'cube',
    brand: 'jobthai',
    label: 'JobThai occupations',
    subtitle: 'occupation × demanded skill',
    details: {
      description:
        'Occupations derived from JobThai job categories, the skills each demands (a skill counts at a 5% posting share), and the programme links (jobthai-bridge.v3, by stated field of study at an education level the graduates hold, preferring an approved field’s reviewed assignments over a name match). Rebuilt by the jobthai connector at the end of every run. Read by the AI curriculum check (demand-match.v4), the jobthai_demand_alignment driver of health-score.v5.4 (Relevance, domestic 75 : global 25) and the Deep-Dive Skills coverage JobThai view.',
      prismaModel: 'JobThaiOccupation + JobThaiOccupationSkill + ProgramJobThaiLink',
      relatedTables: [
        'JobThai occupations — JobThaiOccupation',
        'JobThai occupation skills — JobThaiOccupationSkill',
        'Programme ↔ occupation — ProgramJobThaiLink (by field of study)',
      ],
    },
  },
  {
    id: 'tab.job-field-taxonomy',
    lane: 'table',
    kind: 'table',
    brand: 'jobthai',
    label: 'Job-field taxonomy',
    subtitle: 'canonical field × raw synonyms',
    details: {
      description:
        'One row per canonical field of study, with a Thai and an English name and the raw JobThai strings it absorbs as synonyms. Built from the free text of job adverts by job-field-taxonomy.v1 at a 5-mention floor — 517 of 3,854 distinct strings cleared it (re-measured 2026-09-19; both counts exclude the *ANY* sentinel). Strings below the floor go to the "other" bucket: reported on the map’s reconciliation line, in neither share denominator, assigned to nothing — as is the *ANY* (ทุกสาขา) sentinel. Review states: PROPOSED (shown on the map, labelled unreviewed), APPROVED, REJECTED (invisible everywhere). The rows of the gap map.',
      prismaModel: 'JobFieldTaxonomy',
    },
  },
  {
    id: 'tab.program-job-field',
    lane: 'table',
    kind: 'table',
    brand: 'jobthai',
    label: 'Programme job fields',
    subtitle: 'programme × field assignment',
    details: {
      description:
        'Which KKU programmes produce graduates of each field, with the source recorded per assignment: rule (the bridge’s name match, rejecting any synonym that matches more than 15 programmes), ai (program-job-field.v1, at most 3 fields per programme), or manual. The supply side of the gap map — a programme assigned to two fields counts in both.',
      prismaModel: 'ProgramJobField',
    },
  },
  {
    id: 'tab.tcas-admission-stat',
    lane: 'table',
    kind: 'table',
    label: 'TcasAdmissionStat',
    subtitle: 'national-level peer cutoffs',
    details: {
      description:
        'Programme-level TCAS cutoff scores at the national level — 25k peer rows used by Benchmarking to position KKU programs against subject competitors.',
      prismaModel: 'TcasAdmissionStat',
    },
  },
  {
    id: 'tab.imd-ranking',
    lane: 'table',
    kind: 'table',
    label: 'ImdRanking',
    subtitle: 'country competitiveness',
    details: {
      description:
        '67 economies × yearly IMD competitiveness scores (overall + 4 sub-rankings + Talent + Digital). Provides international context on the Trends Radar.',
      prismaModel: 'ImdRanking',
    },
  },
  {
    id: 'tab.scenario',
    lane: 'table',
    kind: 'table',
    label: 'Scenario + ScenarioRun',
    subtitle: 'what-if simulations',
    details: {
      description:
        'User-built scenarios with workflow state (DRAFT → SHARED → COUNCIL_REVIEWED → DECIDED). Each ScenarioRun persists the full deterministic engine output (projection + sensitivity + Monte Carlo).',
      prismaModel: 'Scenario + ScenarioRun + ScenarioResult',
    },
  },
  {
    id: 'tab.council-decisions',
    lane: 'table',
    kind: 'table',
    label: 'Decisions cluster',
    subtitle: 'CouncilDecision + 3 sub-tables',
    details: {
      description:
        'CouncilDecision (the strategic record) + DecisionMilestone (timeline) + DecisionApprover (sign-off chain) + DecisionOutcomeReview (6mo/1yr/3yr retrospectives). snapshotJson is captured at COUNCIL_REVIEWED transition.',
      prismaModel: 'CouncilDecision + DecisionMilestone + DecisionApprover + DecisionOutcomeReview',
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // New tables — primary feeders for Cockpit, Deep-Dive, Risk Management,
  // and the AI Analyst surfaces.
  // ──────────────────────────────────────────────────────────────────────

  {
    id: 'tab.enrollment-metric',
    lane: 'table',
    kind: 'table',
    label: 'EnrollmentMetric',
    subtitle: 'per program × year',
    details: {
      description:
        'Applications, admitted, enrolled, retainedYear2, graduatedOnTime, graduatedLate per Program × academicYear. Fed by kku-registry (partial upsert — touches only enrolled/dropouts/graduatedOnTime) + tcas (applications/admitted).',
      prismaModel: 'EnrollmentMetric',
    },
  },
  {
    id: 'tab.financial-metric',
    lane: 'table',
    kind: 'table',
    label: 'FinancialMetric',
    subtitle: 'per program × year',
    details: {
      description:
        'tuitionRevenue + cost-allocated columns (directCost, allocatedFacultyCost, allocatedFacilityCost, allocatedOverhead, costPerStudent) per Program × fiscalYear. tuitionRevenue is the only column kku-finance writes; the cost columns are computed by the cost-allocation methodology layer.',
      prismaModel: 'FinancialMetric',
    },
  },
  {
    id: 'tab.graduate-outcome',
    lane: 'table',
    kind: 'table',
    label: 'GraduateOutcome',
    subtitle: 'employment + salary band',
    details: {
      description:
        'Per Program × graduationYear: employmentRate, salaryMedianThb, salaryBandJson, satisfactionScore, fieldMatchRate. Weighted by sampleSize. Includes EmployerFeedback sister rows (relatedTables).',
      prismaModel: 'GraduateOutcome',
      relatedTables: ['EmployerFeedback (sister table for the same Program)'],
    },
  },
  {
    id: 'tab.skill',
    lane: 'table',
    kind: 'table',
    label: 'Skill',
    subtitle: 'taxonomy · ~3.5k rows',
    details: {
      description:
        'ESCO + TPQI + KKU-curriculum vocabulary. nameEn + nameTh + parentId hierarchy + embedding (pgvector). Curriculum extractions land as PROPOSED_SKILL until analyst review promotes them.',
      prismaModel: 'Skill',
      relatedTables: [
        'ProgramSkill (program × skill weights)',
        'CourseSkill (course-level → program rollup)',
        'LinkedIn skill demand — KmitlCareerSkillDemand (demand signal)',
      ],
    },
  },
  {
    id: 'tab.program-skill',
    lane: 'table',
    kind: 'table',
    label: 'ProgramSkill',
    subtitle: 'program × skill weights',
    details: {
      description:
        "Per (Program × Skill) weight. Materialised from approved PROGRAM_DIGEST + PROGRAM_SKILLS_DETAILED AiExtractions. Drives the Deep-Dive skills section, the Cockpit demand dimension, and the Gap Analyzer's program-side.",
      prismaModel: 'ProgramSkill',
    },
  },
  {
    id: 'tab.trend-signal',
    lane: 'table',
    kind: 'table',
    label: 'TrendSignal',
    subtitle: 'policy + market + tech',
    details: {
      description:
        'External signals (5 types: policy / research / market / tech / news) with bilingual summary, source, impact tags, freshness. Per-program subset surfaces in ProgramTrendSignal.',
      prismaModel: 'TrendSignal',
      relatedTables: ['ProgramTrendSignal (program × signal relevance)'],
    },
  },
  {
    id: 'tab.program-analyses',
    lane: 'table',
    kind: 'cube',
    label: 'Program AI analyses',
    subtitle: 'narrative · readiness · peers · …',
    details: {
      description:
        "Cluster of per-program AI-output tables, written by the programs-pipeline's 12 phases. Each row links to the AiInference that produced it, and carries the ProgramRevision it was generated from. Surfaced across the Deep-Dive's sections.",
      relatedTables: [
        'ProgramStrategicNarrative (Phase 7)',
        'ProgramAiReadinessAssessment (Phase 6)',
        'ProgramPedagogyAssessment (Phase 1)',
        'ProgramPeerSelection (Phase 5)',
        'ProgramPeerReview (Phase 5)',
        'ProgramDemandMatch (Phase 3 — LinkedIn + JobThai demand, profession fit)',
        'ProgramResearchExpertise (Phase RE)',
        'ProgramCurriculumRevision (Phase CR)',
        'ProgramLifecycleVerdict (separate methodology)',
        'ProgramTrendSignal (Trends Radar fan-out)',
      ],
      notes: [
        'Collapsed into one node here — drawing 10 individual nodes would crowd the picture and they all share one upstream (the pipeline) and one consumer (the Deep-Dive)',
        'Every table in this cluster carries programRevisionId, so a row can be told apart from one generated off a superseded มคอ.2',
      ],
    },
  },
  {
    id: 'tab.dq-student-cube',
    lane: 'table',
    kind: 'cube',
    label: 'DqStudentCube',
    subtitle: 'faculty × program × cohort',
    details: {
      description:
        'Per (faculty × programme × cohort) counts of students tested, students with scores, and the source\'s own passed verdict. Aggregated at ingest — no per-student row is ever persisted.',
      relatedTables: ['DqModuleCube (the per-module companion)'],
      notes: [
        'facultyId is nullable: names we do not carry (Nong Khai campus faculties, one college, blanks) stay unresolved rather than being force-matched',
        'programId null = the export\'s explicit "Program not identified" bucket, not missing data',
      ],
    },
  },
  {
    id: 'tab.dq-module-cube',
    lane: 'table',
    kind: 'cube',
    label: 'DqModuleCube',
    subtitle: '17 modules · theory + workshop',
    details: {
      description:
        "Mean score per module per (faculty × programme × cohort), keyed by the export's own module key. Theory 1-12 make the headline mean; module 13 (Generative AI) and the four workshops sit outside it.",
      notes: [
        'Each axis is the mean among students who TOOK that module, not across the cohort — a thinly-taken module is not a strong one, and the radar labels the uptake',
      ],
    },
  },
  {
    id: 'tab.program-revision',
    lane: 'table',
    kind: 'table',
    label: 'ProgramRevision',
    subtitle: 'which มคอ.2 an analysis belongs to',
    details: {
      description:
        "Opened when a curriculum document is attached to a programme, and adopted by the pipeline at the start of a run. Every generated table above stamps the revision it came from, which is what lets the platform say 'this analysis describes the 2565 document, not the 2570 one now on file' instead of silently showing stale output as current.",
      relatedTables: [
        'Program.activeRevisionId (the revision the live analyses belong to)',
        'AiExtraction.programRevisionId (digest / faculty / skills extractions)',
      ],
      notes: [
        'Status moves DRAFT → ANALYSING → APPROVED; the previous revision becomes SUPERSEDED',
        'NULL on pre-feature rows — the baseline, not an error',
      ],
    },
  },
  {
    id: 'tab.risk-assessment',
    lane: 'table',
    kind: 'table',
    label: 'RiskAssessment',
    subtitle: 'L1/L2/L3 + KKU matrix',
    details: {
      description:
        "Per Program × assessedAt: L1 recruitment + L2 AI-disruption + L3 demographic scores, composite tier, KKU 5×5 matrix score + level, direct revenue at risk, stranded cost, narrative + dataGaps. Written by Phase 8.",
      prismaModel: 'RiskAssessment',
    },
  },
  {
    id: 'tab.risk-measure',
    lane: 'table',
    kind: 'table',
    label: 'RiskMeasure',
    subtitle: '2-4 recommendations per assessment',
    details: {
      description:
        "Specific recommended actions per RiskAssessment — kind (transfer/mitigate/accept/avoid), horizon, expected ΔTHB, status (PROPOSED → ACCEPTED → IN_PROGRESS → COMPLETED). Optionally links to a CouncilDecision row when the measure becomes a tracked decision.",
      prismaModel: 'RiskMeasure',
    },
  },
  {
    id: 'tab.risk-indicators',
    lane: 'table',
    kind: 'table',
    label: 'RiskIndicator + Breach',
    subtitle: 'KRI catalog + breach log',
    details: {
      description:
        'KRI catalog (slug, labelTh/En, formula, warn + critical thresholds, alarmDirection) + per-program RiskIndicatorBreach log. Drives the /risks/indicators dashboard.',
      prismaModel: 'RiskIndicator + RiskIndicatorBreach',
    },
  },
  {
    id: 'tab.program-learning-outcome',
    lane: 'table',
    kind: 'table',
    label: 'ProgramLearningOutcome',
    subtitle: 'PLOs + embedding',
    details: {
      description:
        'One row per programme learning outcome: verbatim Thai text, a normalised text with "PLO 1.1" style labels stripped, and a 1536-d embedding. Source: the latest PROGRAM_SKILLS_DETAILED extraction. Read by the overlap outcome layer (supporting context, not part of the index) and the peer-review prompt.',
      prismaModel: 'ProgramLearningOutcome',
    },
  },
  {
    id: 'tab.program-market-profile',
    lane: 'table',
    kind: 'table',
    label: 'ProgramMarketProfile',
    subtitle: 'market text + embedding',
    details: {
      description:
        'One row per programme: the market-facing text (names, degree names, recruitment summary, careers), its sha256 and a 1536-d embedding. Drives overlap market similarity, the market_confusion_max KRI and the DIFFERENTIATE action.',
      prismaModel: 'ProgramMarketProfile',
    },
  },
  {
    id: 'tab.program-overlap-pair',
    lane: 'table',
    kind: 'table',
    label: 'ProgramOverlapPair',
    subtitle: '+ ProgramOverlapRun',
    details: {
      description:
        'Stored same-level overlap pairs per run: structure, content, outcome (context), course-based overlap index, containment both ways, band, shared and equivalent credits, shared staff, market similarity, language-variant flag, actions and evidenceJson. The run row (methodology version, scope, thresholds, coverage) is the provenance.',
      prismaModel: 'ProgramOverlapRun + ProgramOverlapPair',
      notes: [
        'Readers take only SUCCEEDED runs: the latest full run per level with newer scoped runs overlaid',
        'Read by risk phase 8 for curriculum_overlap_max + market_confusion_max',
      ],
    },
  },
  {
    id: 'tab.program-overlap-recommendation',
    lane: 'table',
    kind: 'table',
    label: 'ProgramOverlapRecommendation',
    subtitle: 'AI wording per flagged pair',
    details: {
      description:
        'The AI rationale, distinctive points, next steps, confidence and any disagreement for a flagged pair, with promptVersion, aiInferenceId and the evidence hash it was written against.',
      prismaModel: 'ProgramOverlapRecommendation',
    },
  },
  {
    id: 'tab.ai-inference',
    lane: 'table',
    kind: 'table',
    label: 'AiInference',
    subtitle: 'audit log · every LLM call',
    details: {
      description:
        'One row per LLM call regardless of caller. Carries provider, model, methodVersion, prompt, response, tokens, costEstimateUsd, confidence, sourcesJson (incl. tool_use blocks). Powers /admin/ai-cost.',
      prismaModel: 'AiInference',
      notes: [
        "Every ai.* node in this graph writes one AiInference row per call — the fan-in (15 edges) isn't drawn for visual clarity. The two explicit edges (cockpit-brief + analyst-agent) are kept because they have no domain-output table, so without them those nodes would look orphaned.",
        'Consumed by /admin/ai-cost, /admin/system-status, the Program Deep-Dive provenance drawer, and the AI Analyst evidence side-rail',
      ],
    },
  },
  {
    id: 'tab.analyst-conversation',
    lane: 'table',
    kind: 'table',
    label: 'AnalystConversation',
    subtitle: '+ AnalystMessage',
    details: {
      description:
        'Persistent chat history for /analyst. Per-user conversations + per-turn messages with tool-call trace, evidence payload, refused flag.',
      prismaModel: 'AnalystConversation + AnalystMessage + AnalystFeedback',
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────
// L4 — Dashboards
// ──────────────────────────────────────────────────────────────────────────

const dashboardNodes: TopologyNode[] = [
  // Education hub
  {
    id: 'dash.education-recruitment',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Undergraduate recruitment',
    subtitle: '/education/recruitment-campaigns',
    href: '/education/recruitment-campaigns',
    details: {
      description:
        'Full TCAS round 1–4 funnel at the campaign grain — plan → seats → applicants → passed → clearinghouse send + confirm → enrolled, with competition rate, declining tracks, and a Faculty → program → sub-program → round drill. (Replaced the curriculum-grained /education/recruitment.)',
    },
  },
  {
    id: 'dash.education-student-info',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Student info',
    subtitle: '/education/student-info',
    href: '/education/student-info',
    details: {
      description:
        'Headcount by program level, recruitment method, gender, nationality, Thai / non-Thai.',
    },
  },
  {
    id: 'dash.education-location',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Student by location',
    subtitle: '/education/location',
    href: '/education/location',
    details: {
      description:
        "Where this year's intake comes from — by school, province, and Thailand region.",
    },
  },
  {
    id: 'dash.education-active-pivot',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Active students by entry year',
    subtitle: '/education/active-pivot',
    href: '/education/active-pivot',
    details: {
      description:
        'Pivot table — entry-year × Faculty → Program Level → Program drill-down.',
    },
  },
  {
    id: 'dash.education-international',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'International students',
    subtitle: '/education/international',
    href: '/education/international',
    details: {
      description:
        'Headcount by country, with a Faculty → Program drill-down × program-level pivot.',
    },
  },
  {
    id: 'dash.education-tuition',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Tuition fee incomes',
    subtitle: '/education/tuition',
    href: '/education/tuition',
    details: {
      description:
        'Revenue by year, faculty, semester. Drill-down pivot Faculty → Program Level → Program × academic year.',
    },
  },
  {
    id: 'dash.education-performance',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Student performance',
    subtitle: '/education/performance · GPA + class GPA',
    href: '/education/performance',
    details: {
      description:
        'Two GPA views in one dashboard. (1) Student GPA: cumulative average grade per faculty/program (from VIEW_STUDENT_DETAIL_ALL). (2) Class GPA (v1.2.9): Faculty → Program Level → Program → Course pivot with year columns + semester filter + heatmap cells, computed from the grade-distribution columns on ClassOffering. Plus the Region → Province → School → Faculty → Program location view and a per-subject entry-score pivot.',
    },
  },
  {
    id: 'dash.education-class-offerings',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Subject offerings & fulfilment',
    subtitle: '/education/class-offerings',
    href: '/education/class-offerings',
    details: {
      description:
        'Every course section the registrar opened in a semester. Seat-fill heatmap, distribution histogram, GE catalogue, Faculty → Level → Course drill-down. PROGRAM_USER scope clamp via ProgramCourse.',
    },
  },
  {
    id: 'dash.education-satisfaction',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Student evaluations',
    subtitle: '/education/satisfaction · course satisfaction',
    href: '/education/satisfaction',
    details: {
      description:
        'Course-aggregated student-evaluation ratings. 4-level expandable tree (Faculty → Program Level → Program → Course) with year columns + semester filter + per-cell hover tooltip showing question-by-question scores + click-to-drill course detail panel (KPI strip + trend + per-question × per-year heatmap). Heatmap palette narrowed to [3.5, 5.0] because real ratings are ceiling-biased (87% ≥ 4.0). PROGRAM_USER / FACULTY_USER scope-clamped at the program faculty.',
    },
  },
  {
    id: 'dash.education-program-overlap',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Program overlap',
    subtitle: '/education/program-overlap · overlap network + ranked pairs',
    href: '/education/program-overlap',
    details: {
      description:
        'Same-level programmes compared on a course-based overlap index — major courses shared by code and equivalent course content (embedding match) — with PLO alignment shown as supporting context and market similarity beside the index. Overlap network (only programmes with a pair at or above the threshold; a node filters the list, a line opens the pair) above a ranked pair list (index, structure | content bars, containment, language-variant and for-review action badges), KPI strip, and a side panel per pair: layer bars, containment, shared and equivalent courses, matched / unmatched PLOs, shared staff, rule-chosen actions (all for review) and the AI suggestion with confidence and a disagree button. Faculty-grain: guarded like /education/recruitment and clamped to the caller faculty.',
    },
  },

  // Staff hub
  {
    id: 'dash.staff-workforce',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Who works here',
    subtitle: '/staff/workforce',
    href: '/staff/workforce',
    details: {
      description:
        'Headcount, age, tenure, recent hires + departures, 5-year retirement heads-up. Academic + support staff side-by-side.',
    },
  },
  {
    id: 'dash.staff-faculty-by-program',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Programs and their staff',
    subtitle: '/staff/faculty-by-program',
    href: '/staff/faculty-by-program',
    details: {
      description:
        'Drill from faculty into each program to see who teaches there. Programs with fewer than 5 อาจารย์ผู้รับผิดชอบหลักสูตร are flagged.',
    },
  },
  {
    id: 'dash.staff-research',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Research and publications',
    subtitle: '/staff/research · journal quartile lead',
    details: {
      description:
        'All KKU staff publications (Scopus + PubMed, incl. retired) from the internal kku-publications mirror. Leads with the Journal quartile · Scopus CiteScore hero (the QS / THE strategic driver): Tier 1 (top 10%) + Q1 share KPIs, a call-out quartile donut, and a by-year tier distribution chart. Below it: contributor pivot (faculty → individual, Tier 1 / Q1 ranked), faculty heatmap, productivity-by-rank.',
    },
  },
  {
    id: 'dash.staff-compensation',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Salaries and funding',
    subtitle: '/staff/compensation',
    href: '/staff/compensation',
    details: {
      description:
        'Where each person\'s salary comes from (govt allocation vs university revenue) and the income-band mix per faculty. n≥5 gate.',
    },
  },
  {
    id: 'dash.staff-teaching-workload',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Teaching workload',
    subtitle: '/staff/teaching-workload',
    href: '/staff/teaching-workload',
    details: {
      description:
        'Contact hours per teacher per week, summed across every section. Workload-distribution histogram, faculty pulse, students-taught chart, Faculty → Teacher drill-down. PROGRAM_USER scope clamp.',
    },
  },
  {
    id: 'dash.staff-teaching',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Teaching evaluations',
    subtitle: '/staff/teaching · per-teacher ratings',
    href: '/staff/teaching',
    details: {
      description:
        'Per-instructor student-evaluation ratings. 5-level expandable tree (Faculty → Program Level → Program → Teacher → Course) with hover tooltip showing question-by-question scores + click-to-drill teacher detail panel narrowed to the program-of-context. Teacher name formatted as "<rank-abbrev>.<first> <last>" (e.g., ผศ.เด่นพงษ์ สุดภักดี). Tiered visibility: PROGRAM_USER own only, FACULTY_USER faculty roster, UNIVERSITY+ all.',
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Cockpit + Deep-Dive + Risk Management + AI Analyst
  // ──────────────────────────────────────────────────────────────────────

  {
    id: 'dash.staff-grants',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Research and academic service grants',
    subtitle: '/staff/grants · external funding',
    href: '/staff/grants',
    details: {
      description:
        'Externally funded projects by fiscal year (research vs academic service), by faculty (a project counts for every faculty on its team), top funders, and a project table with a team side panel. Budgets are whole-project figures, never split. Faculty-scoped for faculty and programme users.',
    },
  },
  {
    id: 'dash.cockpit',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Portfolio Cockpit',
    subtitle: '/cockpit',
    href: '/cockpit',
    details: {
      description:
        '5-dimension health heatmap (demand / financial / quality / relevance / capability), BCG-style matrix, rollup tree, AI brief, Council Pack PDF export. Health-score methodology v5.4 (Financial includes the external-grant award).',
    },
  },
  {
    id: 'dash.program-deep-dive',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Program Deep-Dive',
    subtitle: '/programs/[id]',
    href: '/programs',
    details: {
      description:
        "14 sections fan-out: overview, demand funnel, student cohorts, TCAS stats, recruitment, AI peers, AI readiness, lifecycle, strategic narrative, demographic outlook, financials, skills, outcomes, faculty composition, peers, trends, research expertise, curriculum revision, overlap (same-level siblings from program-overlap.v1; hidden when no sibling reaches index 30). Role-gated faculty visibility (COUNCIL gets aggregates-only).",
    },
  },
  {
    id: 'dash.education-student-dq',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Student DQ',
    subtitle: '/education/student-dq',
    href: '/education/student-dq',
    details: {
      description:
        "Digital Intelligence competency across faculties and programmes — module profile radar, weakest modules, and the pass verdict. student-dq.v1. The same radar helper (dqRadarDomain) floors every DQ radar at 60 so the Deep-Dive's and this one cannot be read against different scales.",
      notes: [
        'Small-cell floor: a programme or faculty with 5 or fewer scored students is withheld',
      ],
    },
  },
  {
    id: 'dash.teaching-learning',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Teaching & Learning',
    subtitle: '/teaching-learning',
    href: '/teaching-learning',
    details: {
      description:
        "AUN-QA v4 readiness: how much of each programme's evidence the platform can already show, so an assessor can sequence which programmes to put forward. Every figure describes OUR data coverage, never how well a programme teaches — and no AUN-QA 1-7 rating is produced anywhere, since assessors award those.",
      notes: [
        'Six of the eight criteria can be evidenced; criteria 6 (Student Support) and 7 (Facilities) hold nothing for any programme because no connector ingests that data',
        'Reads existing tables only — it adds no tables of its own, it reorganises evidence the platform already holds',
      ],
    },
  },
  {
    id: 'dash.risk-portfolio',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Risk portfolio',
    subtitle: '/risks',
    href: '/risks',
    details: {
      description:
        'Cross-program risk view — composite tier histogram, top-N riskiest, revenue-at-risk rollups by faculty, recent KRI breaches, and the Self-competition panel (pairs behind the curriculum_overlap_max and market_confusion_max KRIs).',
    },
  },
  {
    id: 'dash.risk-matrix',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Risk matrix',
    subtitle: '/risks/matrix',
    href: '/risks/matrix',
    details: {
      description:
        '5×5 institutional matrix (likelihood × impact) populated from RiskAssessment.kkuMatrixScore + kkuRiskLevel. Cell click drills into the programs in that cell.',
    },
  },
  {
    id: 'dash.risk-indicators',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Risk indicators (KRIs)',
    subtitle: '/risks/indicators',
    href: '/risks/indicators',
    details: {
      description:
        'KRI catalog with current breaches per program. Each indicator carries its formula, warn / critical thresholds, and recent breach severity.',
    },
  },
  {
    id: 'dash.risk-drivers',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Risk drivers',
    subtitle: '/risks/drivers',
    href: '/risks/drivers',
    details: {
      description:
        "L1/L2/L3 sub-score breakdown view — which driver (recruitment slump, AI disruption, demographic ceiling) is pulling each program's composite tier.",
    },
  },
  {
    id: 'dash.analyst',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'AI Analyst',
    subtitle: '/analyst',
    href: '/analyst',
    details: {
      description:
        '3-pane conversational interface with evidence side-rail. Persistent per-user chat history. Bilingual Thai/English. 7 pre-built Council briefs.',
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Application-wide modules added in the topology v2 expansion.
  // ──────────────────────────────────────────────────────────────────────

  {
    id: 'dash.trends-radar',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Trends Radar',
    subtitle: '/trends',
    href: '/trends',
    details: {
      description:
        'Polar radar visualising external signal feeds — 5 types (policy / research / market / tech / news). Time-since-detection on radius, signal type wedge on angle, impact on dot size. Notification + SignalSubscription per user.',
    },
  },
  {
    id: 'dash.gap-analyzer',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Gap Analyzer',
    subtitle: '/gap-analysis',
    href: '/gap-analysis',
    brand: 'jobthai',
    details: {
      description:
        'Demand-first gap map (gap-map.v2): one row per field of study employers ask for — JobThai private-sector adverts and, since v2, Thai government recruitment announcements from job-108.com, blended behind a selectable demand basis (private / public / all, default all) — KKU supply share from registrar graduates, a share-vs-share verdict, the occupations and programmes inside each row, LinkedIn-via-MHESI growth and Trends Radar signals as what is coming, and one Council brief. Replaced the seven-lens analyzer and its composite gap index; /gap-analysis/opportunities, /risks and /education/digital-competency keep the old bookmarks working. NOTE: this diagram does not yet show job-108 as a source node/edge — see docs/data-sources/job-108.md.',
      notes: [
        'Verdicts: white space (no bachelor programme — postgraduate tracks may exist, are listed in the row and are never scored) · under-served · served · over-served · supply-unknown (programmes exist but none carries a graduate figure — a missing measurement, never a shortfall) · too few postings (under 20 adverts, which is itself one of the six verdicts, not an empty cell).',
        'Under and over thresholds are URL parameters, shown above the table and in the provenance drawer under Methodology, beside the version they belong to; every view is a shareable link.',
        'Reads only; writes nothing. Cached 5 minutes, purged when a job field is approved.',
      ],
    },
  },
  {
    id: 'dash.job-fields-review',
    lane: 'dashboard',
    kind: 'dashboard',
    brand: 'jobthai',
    label: 'Job fields review',
    subtitle: '/admin/job-fields',
    href: '/admin/job-fields',
    details: {
      description:
        'Admin review of the AI-proposed field-of-study taxonomy and the programme assignments behind the gap map: approve, reject, rename, merge two fields, and add or remove a programme assignment by hand. Proposed rows are already visible on /gap-analysis, labelled unreviewed. Every mutation is audit-logged and approving a field purges the gap-map cache.',
    },
  },
  {
    id: 'dash.benchmarking',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Benchmarking',
    subtitle: '/benchmarking',
    href: '/benchmarking',
    details: {
      description:
        'Peer comparison + white-space detection. 3 seeded peer sets (Thai Top-10, ASEAN Top-20, Global Subject Leaders). CoverageMatrix viz, distinctiveness scoring, white-spaces (skills ≥3 peers teach that KKU doesn\'t).',
    },
  },
  {
    id: 'dash.scenarios',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Scenario Planner',
    subtitle: '/scenarios',
    href: '/scenarios',
    details: {
      description:
        'What-if simulation. 5 intervention types (launch / reshape / rebalance / merge / sunset), deterministic pure-function engine with seeded Monte Carlo + tornado sensitivity. Workflow DRAFT→SHARED→COUNCIL_REVIEWED→DECIDED.',
    },
  },
  {
    id: 'dash.decisions',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Decision Workspace',
    subtitle: '/decisions',
    href: '/decisions',
    details: {
      description:
        'Captures Council decisions, tracks follow-through. 5 tabs (Overview / Milestones / Approvers / Outcomes / Discussion). Role-gated status transitions. Outcome reviews at 6mo / 1yr / 3yr horizons compare actual vs snapshot.',
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Edges
// ──────────────────────────────────────────────────────────────────────────

// Edge-scope helpers — readonly tuples kept narrow to ('education'|'staff')[]
// so we get type-safety without sharing mutable array refs across edges.
type Scope = NonNullable<TopologyEdge['scope']>;
const E: Scope = ['education'];
const S: Scope = ['staff'];
const ES: Scope = ['education', 'staff'];

const edges: TopologyEdge[] = [
  // ── KKU Research & Academic Services (external grants) ─────────────
  { from: 'ext.mysql-research-services', to: 'con.kku-research-services', scope: S },
  { from: 'con.kku-research-services', to: 'tab.research-service-project', scope: S },
  { from: 'con.kku-research-services', to: 'tab.research-service-project-member', scope: S },
  { from: 'tab.research-service-project', to: 'dash.staff-grants', scope: S },
  { from: 'tab.research-service-project-member', to: 'dash.staff-grants', scope: S },
  { from: 'tab.research-service-project-member', to: 'dash.cockpit' }, // Financial award via health-score.v5.4
  { from: 'tab.research-service-project-member', to: 'dash.program-deep-dive' }, // Financial award via health-score.v5.4
  // ── External → Connector ───────────────────────────────────────────
  { from: 'ext.oracle-powerbi', to: 'con.kku-tcas-funnel', scope: E },
  { from: 'ext.oracle-powerbi', to: 'con.kku-admission-campaigns', scope: E },
  { from: 'ext.oracle-powerbi', to: 'scr.link-class-offerings', scope: ES },
  { from: 'ext.oracle-powerbi', to: 'con.kku-evaluations', scope: ES },
  { from: 'ext.mysql-unicon', to: 'con.unicon-ds1001', scope: E },
  { from: 'ext.mysql-unicon', to: 'con.unicon-ds2001', scope: S },
  { from: 'ext.mysql-unicon', to: 'con.unicon-ds2003', scope: S },
  { from: 'ext.mysql-unicon', to: 'con.unicon-ds2004', scope: S },
  { from: 'ext.mysql-kkuhr', to: 'con.kku-hr-processed', scope: S },
  { from: 'ext.mssql-hcm', to: 'con.kku-hr', scope: S },
  { from: 'ext.mssql-hcm', to: 'scr.backfill-faculty-emails', scope: ES },
  { from: 'ext.pg-kkuscholar', to: 'con.kku-research', scope: S },
  { from: 'ext.gsheet-master', to: 'scr.seed-programs-from-sheet', scope: ES },
  { from: 'ext.pdf-curriculum', to: 'scr.programs-pipeline', scope: ES },

  // ── Connector → Table ──────────────────────────────────────────────
  { from: 'con.kku-tcas-funnel', to: 'tab.tcas-admission-funnel', scope: E },
  { from: 'con.kku-admission-campaigns', to: 'tab.admission-campaign-stats', scope: E },
  { from: 'con.unicon-ds1001', to: 'tab.student-program-record', scope: E },
  { from: 'con.unicon-ds2001', to: 'tab.staff-master-record', scope: S },
  { from: 'con.unicon-ds2004', to: 'tab.staff-program-assignment', scope: S },
  { from: 'con.kku-hr-processed', to: 'tab.staff-compensation-cube', scope: S },
  { from: 'con.kku-hr-processed', to: 'tab.staff-lifecycle-dates', scope: S },
  { from: 'con.kku-hr-processed', to: 'tab.faculty-member', scope: S },
  { from: 'con.kku-hr', to: 'tab.faculty-member', scope: S },
  { from: 'con.kku-research', to: 'tab.research-output', scope: S },
  { from: 'con.kku-research', to: 'tab.faculty-member', scope: S },
  { from: 'scr.link-class-offerings', to: 'tab.class-offering', scope: ES },
  { from: 'scr.link-class-offerings', to: 'tab.class-offering-teacher', scope: ES },
  { from: 'con.kku-evaluations', to: 'tab.evaluation-response-summary', scope: ES },
  { from: 'con.kku-evaluations', to: 'tab.evaluation-question', scope: ES },
  // AI translation writes English text + watermark back into the catalog.
  { from: 'ai.evaluation-question-translate', to: 'tab.evaluation-question', scope: ES },
  { from: 'scr.backfill-faculty-emails', to: 'tab.faculty-member', scope: ES },
  { from: 'scr.seed-programs-from-sheet', to: 'tab.program', scope: ES },
  { from: 'scr.programs-pipeline', to: 'tab.ai-extraction', scope: ES },
  { from: 'scr.programs-pipeline', to: 'tab.program-course', scope: ES },
  { from: 'scr.programs-pipeline', to: 'tab.program-faculty', scope: S },
  { from: 'scr.materialise-program-courses', to: 'tab.program-course', scope: ES },

  // ── Table → Dashboard ──────────────────────────────────────────────
  // Recruitment
  { from: 'tab.admission-campaign-stats', to: 'dash.education-recruitment', scope: E },
  { from: 'tab.admission-campaign-stats', to: 'dash.cockpit' },
  { from: 'tab.admission-campaign-stats', to: 'dash.risk-portfolio' },
  { from: 'tab.program', to: 'dash.education-recruitment', scope: E },
  { from: 'tab.faculty', to: 'dash.education-recruitment', scope: E },

  // Education student dashboards (all read from StudentProgramRecord-derived cubes)
  ...(
    [
      'dash.education-student-info',
      'dash.education-location',
      'dash.education-active-pivot',
      'dash.education-international',
      'dash.education-tuition',
      'dash.education-performance',
    ] as const
  ).flatMap((dashId): TopologyEdge[] => [
    { from: 'tab.student-program-record', to: dashId, scope: E },
    { from: 'tab.program', to: dashId, scope: E },
    { from: 'tab.faculty', to: dashId, scope: E },
  ]),

  // Class offerings
  { from: 'tab.class-offering', to: 'dash.education-class-offerings', scope: E },
  { from: 'tab.class-offering-teacher', to: 'dash.education-class-offerings', scope: E },
  { from: 'tab.program-course', to: 'dash.education-class-offerings', scope: E },
  { from: 'tab.program', to: 'dash.education-class-offerings', scope: E },
  { from: 'tab.faculty', to: 'dash.education-class-offerings', scope: E },

  // Class GPA (added v1.2.9) — same ClassOffering table, surfaces a
  // separate section inside /education/performance. Already covered
  // by the "Education student dashboards" generic flatMap above
  // (which routes tab.student-program-record / tab.program /
  // tab.faculty → dash.education-performance). The grade-distribution
  // path is internal to ClassOffering; one explicit edge below makes
  // the class-GPA section's lineage visible in the diagram.
  { from: 'tab.class-offering', to: 'dash.education-performance', scope: E },

  // Student evaluations (v1.2.10) — course-aggregated pivot
  { from: 'tab.evaluation-response-summary', to: 'dash.education-satisfaction', scope: E },
  { from: 'tab.evaluation-question', to: 'dash.education-satisfaction', scope: E },
  { from: 'tab.program-course', to: 'dash.education-satisfaction', scope: E },
  { from: 'tab.program', to: 'dash.education-satisfaction', scope: E },
  { from: 'tab.faculty', to: 'dash.education-satisfaction', scope: E },
  { from: 'tab.program', to: 'dash.education-program-overlap', scope: E },
  { from: 'tab.program-course', to: 'dash.education-program-overlap', scope: E },
  { from: 'tab.faculty', to: 'dash.education-program-overlap', scope: E },
  // Programme overlap (program-overlap.v1): prep → embeddings → run → surfaces
  { from: 'scr.programs-overlap-prep', to: 'tab.program-learning-outcome', scope: E },
  { from: 'scr.programs-overlap-prep', to: 'tab.program-market-profile', scope: E },
  { from: 'scr.programs-overlap-prep', to: 'tab.program-course', scope: E },
  { from: 'scr.programs-overlap-prep', to: 'ai.program-overlap-embed', scope: E },
  { from: 'ai.program-overlap-embed', to: 'tab.program-learning-outcome', scope: E },
  { from: 'ai.program-overlap-embed', to: 'tab.program-market-profile', scope: E },
  { from: 'ai.program-overlap-embed', to: 'tab.program-course', scope: E },
  { from: 'scr.programs-overlap', to: 'tab.program-overlap-pair', scope: E },
  { from: 'scr.programs-pipeline', to: 'tab.program-overlap-pair', scope: E }, // phase OV scoped runs
  { from: 'scr.programs-overlap', to: 'ai.program-overlap-recommendation', scope: E },
  { from: 'tab.program-overlap-pair', to: 'ai.program-overlap-recommendation', scope: E },
  { from: 'ai.program-overlap-recommendation', to: 'tab.program-overlap-recommendation', scope: E },
  { from: 'tab.program-overlap-pair', to: 'dash.education-program-overlap', scope: E },
  { from: 'tab.program-overlap-recommendation', to: 'dash.education-program-overlap', scope: E },
  { from: 'tab.program-learning-outcome', to: 'dash.education-program-overlap', scope: E },
  { from: 'tab.program-overlap-pair', to: 'dash.program-deep-dive' },
  { from: 'tab.program-overlap-recommendation', to: 'dash.program-deep-dive' },
  { from: 'tab.program-overlap-pair', to: 'ai.risk-assess' }, // overlap KRIs + named siblings
  { from: 'tab.program-overlap-pair', to: 'dash.risk-portfolio' }, // Self-competition panel
  { from: 'tab.program-learning-outcome', to: 'ai.program-peers' }, // peer review reads PLOs

  // Staff workforce
  { from: 'tab.staff-master-record', to: 'dash.staff-workforce', scope: S },
  { from: 'tab.staff-lifecycle-dates', to: 'dash.staff-workforce', scope: S },
  { from: 'tab.faculty', to: 'dash.staff-workforce', scope: S },

  // Faculty-by-program
  { from: 'tab.program', to: 'dash.staff-faculty-by-program', scope: S },
  { from: 'tab.program-faculty', to: 'dash.staff-faculty-by-program', scope: S },
  { from: 'tab.staff-program-assignment', to: 'dash.staff-faculty-by-program', scope: S },
  { from: 'tab.faculty-member', to: 'dash.staff-faculty-by-program', scope: S },
  { from: 'tab.faculty', to: 'dash.staff-faculty-by-program', scope: S },

  // Research
  { from: 'tab.faculty-member', to: 'dash.staff-research', scope: S },
  { from: 'tab.research-output', to: 'dash.staff-research', scope: S },
  { from: 'tab.faculty', to: 'dash.staff-research', scope: S },

  // Compensation
  { from: 'tab.staff-compensation-cube', to: 'dash.staff-compensation', scope: S },
  { from: 'tab.staff-master-record', to: 'dash.staff-compensation', scope: S },
  { from: 'tab.faculty', to: 'dash.staff-compensation', scope: S },

  // Teaching workload
  { from: 'tab.class-offering', to: 'dash.staff-teaching-workload', scope: S },
  { from: 'tab.class-offering-teacher', to: 'dash.staff-teaching-workload', scope: S },
  { from: 'tab.faculty-member', to: 'dash.staff-teaching-workload', scope: S },
  { from: 'tab.program-course', to: 'dash.staff-teaching-workload', scope: S },
  { from: 'tab.faculty', to: 'dash.staff-teaching-workload', scope: S },

  // Teaching evaluations (v1.2.10) — per-instructor pivot
  { from: 'tab.evaluation-response-summary', to: 'dash.staff-teaching', scope: S },
  { from: 'tab.evaluation-question', to: 'dash.staff-teaching', scope: S },
  { from: 'tab.faculty-member', to: 'dash.staff-teaching', scope: S },
  { from: 'tab.program-course', to: 'dash.staff-teaching', scope: S },
  { from: 'tab.program', to: 'dash.staff-teaching', scope: S },
  { from: 'tab.faculty', to: 'dash.staff-teaching', scope: S },

  // ──────────────────────────────────────────────────────────────────────
  // Direct data-input edges into AI tasks that consume external sources.
  // LLM provider is NOT shown as an edge — it's an inline pill on the
  // ai-task node (GEMINI / CLAUDE). Tasks that consume INTERNAL tables
  // (cockpit-brief, gap-brief, scenario-insights, …) don't get
  // upstream edges drawn — that would be L3 → L2 backward flow. Their
  // table dependencies are listed in the detail panel.
  // ──────────────────────────────────────────────────────────────────────
  { from: 'ext.pdf-curriculum', to: 'ai.curriculum-extraction' },
  { from: 'ext.pdf-reports', to: 'ai.policy-doc-analysis' },
  // (ext.pdf-reports → ai.pdf-classify already declared earlier with
  // the connector-bound edges.)

  // ──────────────────────────────────────────────────────────────────────
  // AI task → output tables
  //
  // Universal ai → ai-inference audit edges are NOT drawn (every AI task
  // writes one row per call; the fan-in is noted in tab.ai-inference's
  // detail panel). We draw only the domain output edges that drive a
  // downstream dashboard.
  // ──────────────────────────────────────────────────────────────────────
  // Phase 1 curriculum extraction enriches Program / writes ProgramSkill /
  // writes AiExtraction (PROGRAM_DIGEST + 3 sibling types).
  { from: 'ai.curriculum-extraction', to: 'tab.ai-extraction', scope: ES },
  { from: 'ai.curriculum-extraction', to: 'tab.program-skill', scope: ES },
  { from: 'ai.curriculum-extraction', to: 'tab.program', scope: ES },

  // Phase 3-7 program analyses (collapsed cluster)
  { from: 'ai.program-careers-demand', to: 'tab.program-analyses' },
  { from: 'ai.program-peers', to: 'tab.program-analyses' },
  { from: 'ai.program-ai-readiness', to: 'tab.program-analyses' },
  { from: 'ai.program-narrative', to: 'tab.program-analyses' },
  // Phase RE reads the staff publication table; phase CR reads what RE wrote,
  // which is why the two land in the same cube rather than one feeding the
  // other across lanes.
  { from: 'tab.research-output', to: 'ai.program-research-expertise' },
  { from: 'tab.program-faculty', to: 'ai.program-research-expertise' },
  { from: 'ai.program-research-expertise', to: 'tab.program-analyses' },
  { from: 'tab.program-course', to: 'ai.program-curriculum-revision' },
  { from: 'ai.program-curriculum-revision', to: 'tab.program-analyses' },
  // Teaching & Learning drafts one AUN-QA criterion at a time, on demand.
  { from: 'ai.aunqa-narrative', to: 'dash.teaching-learning' },
  // Phase 2b — the course list every downstream course-level analysis reads.
  { from: 'ai.program-courses-extract', to: 'tab.program-course' },
  // ── DQ vertical: one weekly API export → two cubes → three consumers ──
  { from: 'ext.api-kku-dq', to: 'con.kku-dq', scope: E },
  { from: 'con.kku-dq', to: 'tab.dq-student-cube', scope: E },
  { from: 'con.kku-dq', to: 'tab.dq-module-cube', scope: E },
  { from: 'tab.dq-student-cube', to: 'dash.education-student-dq', scope: E },
  { from: 'tab.dq-module-cube', to: 'dash.education-student-dq', scope: E },
  // The Deep-Dive's Digital competency section and Teaching & Learning's
  // AUN-QA evidence both read the same two cubes — which is why the radar
  // floor lives in one shared helper rather than in each surface.
  { from: 'tab.dq-student-cube', to: 'dash.program-deep-dive' },
  { from: 'tab.dq-module-cube', to: 'dash.program-deep-dive' },
  { from: 'tab.dq-student-cube', to: 'dash.teaching-learning' },
  // Trends: a signal is drafted from a document or a monitor, then enriched
  // by the same analysis task either way.
  { from: 'ext.external-ai-sources', to: 'con.external-ai-sources' },
  { from: 'con.external-ai-sources', to: 'ai.external-feed-summary' },
  { from: 'ai.external-feed-summary', to: 'ai.trend-signal-analysis' },
  { from: 'ai.trend-document-ingest', to: 'ai.trend-signal-analysis' },
  { from: 'ai.trend-signal-analysis', to: 'tab.trend-signal' },
  // Queue-driven skill extraction, both directions of the gap analysis.
  { from: 'ai.course-skill-extraction', to: 'tab.program-skill' },
  { from: 'ai.job-posting-skills', to: 'tab.skill' },
  { from: 'ai.skill-name-normaliser', to: 'tab.skill' },
  // Operator-run imports.
  { from: 'ai.graduate-employment-survey', to: 'tab.graduate-outcome' },
  { from: 'ai.imd-rankings-extract', to: 'tab.imd-ranking' },

  // Phase 8 risk
  { from: 'ai.risk-assess', to: 'tab.risk-assessment' },
  { from: 'ai.risk-assess', to: 'tab.risk-measure' },
  { from: 'ai.risk-assess', to: 'tab.risk-indicators' },

  // Module insights — all land as AiExtraction rows (typed payload)
  { from: 'ai.scenario-insights', to: 'tab.ai-extraction' },
  { from: 'ai.benchmarking-insights', to: 'tab.ai-extraction' },
  { from: 'ai.outcome-review', to: 'tab.ai-extraction' },
  { from: 'ai.expertise-narrative', to: 'tab.ai-extraction' },

  // Cockpit brief is ai-inference-only (no AiExtraction); the edge to
  // ai-inference is the only outbound, drawn explicitly so the node
  // doesn't look orphaned.
  { from: 'ai.cockpit-brief', to: 'tab.ai-inference' },
  // The gap-map Council brief is the same shape: one AiInference per call,
  // no typed extraction row.
  { from: 'ai.gap-brief', to: 'tab.ai-inference' },

  // Analyst persists conversation state in addition to ai-inference
  { from: 'ai.analyst-agent', to: 'tab.analyst-conversation' },
  { from: 'ai.analyst-agent', to: 'tab.ai-inference' },

  // PDF classifier writes the inferredRole onto pdf_documents (tagged
  // back onto the curriculum-pdfs source). No domain table — mention
  // in detail panel.

  // Policy-doc analysis fans out signals
  { from: 'ai.policy-doc-analysis', to: 'tab.trend-signal' },
  { from: 'ai.policy-doc-analysis', to: 'tab.ai-extraction' },

  // ──────────────────────────────────────────────────────────────────────
  // Tables → Cockpit + Deep-Dive + Risk + Analyst dashboards
  // ──────────────────────────────────────────────────────────────────────

  // Cockpit reads the 5 health-score dimensions' primary feeders +
  // scope master data
  { from: 'tab.enrollment-metric', to: 'dash.cockpit' },
  { from: 'tab.financial-metric', to: 'dash.cockpit' },
  { from: 'tab.graduate-outcome', to: 'dash.cockpit' },
  { from: 'tab.program-skill', to: 'dash.cockpit' },
  { from: 'tab.trend-signal', to: 'dash.cockpit' },
  { from: 'tab.program', to: 'dash.cockpit' },
  { from: 'tab.faculty', to: 'dash.cockpit' },

  // Deep-Dive — 14 sections fan-in. Trimmed to the primary feeders;
  // contextual sub-feeders (research-output, tcas-stats, staff-program-
  // assignment) are mentioned in the section's detail.
  // Provenance: the Deep-Dive reads the active revision to decide whether its
  // analyses describe the document currently on file, and says so if not.
  { from: 'tab.program-revision', to: 'dash.program-deep-dive' },
  { from: 'tab.program-revision', to: 'tab.program-analyses' },
  // Teaching & Learning holds no tables of its own — it reorganises evidence
  // the platform already has into the AUN-QA criteria.
  { from: 'tab.program', to: 'dash.teaching-learning' },
  { from: 'tab.program-skill', to: 'dash.teaching-learning' },
  { from: 'tab.program-course', to: 'dash.teaching-learning' },
  { from: 'tab.program-faculty', to: 'dash.teaching-learning' },
  { from: 'tab.evaluation-response-summary', to: 'dash.teaching-learning' },
  { from: 'tab.graduate-outcome', to: 'dash.teaching-learning' },
  { from: 'tab.program', to: 'dash.program-deep-dive' },
  { from: 'tab.faculty', to: 'dash.program-deep-dive' },
  { from: 'tab.enrollment-metric', to: 'dash.program-deep-dive' },
  { from: 'tab.financial-metric', to: 'dash.program-deep-dive' },
  { from: 'tab.graduate-outcome', to: 'dash.program-deep-dive' },
  { from: 'tab.faculty-member', to: 'dash.program-deep-dive' },
  { from: 'tab.research-output', to: 'dash.program-deep-dive' },
  { from: 'tab.program-skill', to: 'dash.program-deep-dive' },
  { from: 'tab.skill', to: 'dash.program-deep-dive' },
  { from: 'tab.program-analyses', to: 'dash.program-deep-dive' },
  { from: 'tab.risk-assessment', to: 'dash.program-deep-dive' },
  { from: 'tab.trend-signal', to: 'dash.program-deep-dive' },
  { from: 'tab.ai-inference', to: 'dash.program-deep-dive' },
  { from: 'tab.admission-campaign-stats', to: 'dash.program-deep-dive' },
  { from: 'tab.staff-program-assignment', to: 'dash.program-deep-dive' },

  // Risk portfolio (composite tier overview)
  { from: 'tab.risk-assessment', to: 'dash.risk-portfolio' },
  { from: 'tab.risk-measure', to: 'dash.risk-portfolio' },
  { from: 'tab.program', to: 'dash.risk-portfolio' },
  { from: 'tab.faculty', to: 'dash.risk-portfolio' },

  // Risk matrix (5×5 institutional grid)
  { from: 'tab.risk-assessment', to: 'dash.risk-matrix' },
  { from: 'tab.program', to: 'dash.risk-matrix' },

  // Risk indicators (KRI catalog + breaches)
  { from: 'tab.risk-indicators', to: 'dash.risk-indicators' },
  { from: 'tab.program', to: 'dash.risk-indicators' },

  // Risk drivers (L1/L2/L3 sub-score breakdown)
  { from: 'tab.risk-assessment', to: 'dash.risk-drivers' },
  { from: 'tab.program', to: 'dash.risk-drivers' },

  // AI Analyst reads its persisted chat history + audit inferences
  { from: 'tab.analyst-conversation', to: 'dash.analyst' },
  { from: 'tab.ai-inference', to: 'dash.analyst' },

  // ──────────────────────────────────────────────────────────────────────
  // Application-topology expansion — 6 new connectors, 9 new tables,
  // 5 new dashboards. Edges only include data flow; orchestration (e.g.
  // pdf-classify routing to outcomes-ingest) lives in detail panels.
  // ──────────────────────────────────────────────────────────────────────

  // External → connector
  { from: 'ext.oracle-powerbi', to: 'con.kku-registry' },
  { from: 'ext.oracle-powerbi', to: 'con.kku-finance' },
  { from: 'ext.mssql-hcm', to: 'con.kku-finance' }, // dual-source: Oracle tuition + MSSQL budget
  { from: 'ext.pdf-reports', to: 'con.kku-alumni' },
  { from: 'ext.api-kmitl', to: 'con.kmitl-skill-mapping' },
  { from: 'ext.jobthai', to: 'con.jobthai' },
  { from: 'ext.pdf-reports', to: 'con.tcas' },
  { from: 'ext.pdf-reports', to: 'con.imd-rankings' },

  // Connector → tables (new outputs)
  { from: 'con.kku-registry', to: 'tab.enrollment-metric' },
  { from: 'con.kku-registry', to: 'tab.student-demographic' },
  { from: 'con.kku-finance', to: 'tab.financial-metric' },
  { from: 'con.kku-finance', to: 'tab.faculty-budget' },
  { from: 'con.kku-alumni', to: 'tab.graduate-outcome' },
  { from: 'con.kku-alumni', to: 'tab.employer-feedback' },
  { from: 'con.unicon-ds2003', to: 'tab.staff-education-history' },
  { from: 'con.kmitl-skill-mapping', to: 'tab.kmitl-demand' },
  { from: 'con.jobthai', to: 'tab.jobthai-postings' },
  // The same connector run rebuilds occupations, skill matches and links once
  // no batch is pending — there is no separate script step any more.
  { from: 'con.jobthai', to: 'tab.jobthai-occupations' },
  // The field-of-study taxonomy: the connector hands off to the build step,
  // which clusters the postings' raw field strings and assigns programmes.
  // The admin review page reads both tables (and writes back to them by
  // hand — approve / reject / rename / merge; drawn as a read so the graph
  // keeps flowing left to right).
  { from: 'con.jobthai', to: 'scr.jobthai-fields' }, // runs at the end of every batch refresh
  { from: 'scr.jobthai-fields', to: 'tab.job-field-taxonomy' },
  { from: 'scr.jobthai-fields', to: 'tab.program-job-field' },
  { from: 'tab.job-field-taxonomy', to: 'dash.job-fields-review' },
  { from: 'tab.program-job-field', to: 'dash.job-fields-review' },
  { from: 'tab.skill', to: 'tab.jobthai-postings' }, // postings matched against the taxonomy
  { from: 'tab.program', to: 'tab.jobthai-occupations' }, // links by programme field of study
  { from: 'tab.program-skill', to: 'tab.jobthai-occupations' }, // skill-overlap corroboration
  { from: 'con.tcas', to: 'tab.tcas-admission-stat' },
  { from: 'con.imd-rankings', to: 'tab.imd-ranking' },

  // PDF reports route through pdf-classify before landing in domain tables
  { from: 'ext.pdf-reports', to: 'ai.pdf-classify' },

  // ── Tables → new dashboards ────────────────────────────────────────

  // Trends Radar — external signal feed
  { from: 'tab.trend-signal', to: 'dash.trends-radar' },
  { from: 'tab.imd-ranking', to: 'dash.trends-radar' },
  { from: 'tab.faculty', to: 'dash.trends-radar' },

  // Gap Analyzer — demand × supply
  // gap-map.v2 — demand from JobThai postings (private basis) and, since v2,
  // job-108 government announcements (public basis), blended by default,
  // through the field taxonomy; supply from the registrar's graduate and
  // enrolment rows through the programme assignments, plus what's coming
  // (LinkedIn-via-MHESI growth and Trends Radar signals). The map writes
  // nothing. job-108's own source table is not yet wired into this diagram.
  { from: 'tab.jobthai-postings', to: 'dash.gap-analyzer' }, // demand: adverts × synonyms
  { from: 'tab.job-field-taxonomy', to: 'dash.gap-analyzer' }, // the rows
  { from: 'tab.program-job-field', to: 'dash.gap-analyzer' }, // the supply assignments
  { from: 'tab.jobthai-occupations', to: 'dash.gap-analyzer' }, // occupations inside a row + programme links
  { from: 'tab.enrollment-metric', to: 'dash.gap-analyzer' }, // graduates-per-year proxy + pipeline
  { from: 'tab.kmitl-demand', to: 'dash.gap-analyzer' }, // rising skills (KmitlSkillGrowth, newest capture)
  { from: 'tab.skill', to: 'dash.gap-analyzer' }, // names for the rising skills
  { from: 'tab.trend-signal', to: 'dash.gap-analyzer' }, // what's coming
  { from: 'tab.program', to: 'dash.gap-analyzer' },
  { from: 'tab.faculty', to: 'dash.gap-analyzer' },

  // Benchmarking — peer comparison + white spaces
  { from: 'tab.program-skill', to: 'dash.benchmarking' },
  { from: 'tab.tcas-admission-stat', to: 'dash.benchmarking' },
  { from: 'tab.imd-ranking', to: 'dash.benchmarking' },
  { from: 'tab.program', to: 'dash.benchmarking' },
  { from: 'tab.faculty', to: 'dash.benchmarking' },
  { from: 'tab.ai-extraction', to: 'dash.benchmarking' }, // BENCHMARKING_INSIGHTS

  // Scenario Planner — projects baseline metrics under interventions
  { from: 'tab.scenario', to: 'dash.scenarios' },
  { from: 'tab.enrollment-metric', to: 'dash.scenarios' },
  { from: 'tab.financial-metric', to: 'dash.scenarios' },
  { from: 'tab.program-skill', to: 'dash.scenarios' },
  { from: 'tab.program', to: 'dash.scenarios' },
  { from: 'tab.faculty', to: 'dash.scenarios' },
  { from: 'tab.ai-extraction', to: 'dash.scenarios' }, // SCENARIO_INSIGHTS

  // Decision Workspace
  { from: 'tab.council-decisions', to: 'dash.decisions' },
  { from: 'tab.scenario', to: 'dash.decisions' }, // scenarios link to decisions when DECIDED
  { from: 'tab.risk-measure', to: 'dash.decisions' }, // measures escalate into decisions
  { from: 'tab.ai-extraction', to: 'dash.decisions' }, // OUTCOME_REVIEW

  // Existing Cockpit gets two more upstream feeders (newly-surfaced)
  { from: 'tab.employer-feedback', to: 'dash.cockpit' },
  { from: 'tab.kmitl-demand', to: 'dash.cockpit' }, // demand dimension via health-score.v2
  { from: 'tab.jobthai-occupations', to: 'dash.cockpit' }, // relevance via health-score.v5.4

  // Existing Program Deep-Dive picks up the new connector outputs
  { from: 'tab.student-demographic', to: 'dash.program-deep-dive' },
  { from: 'tab.employer-feedback', to: 'dash.program-deep-dive' },
  { from: 'tab.staff-education-history', to: 'dash.program-deep-dive' },
  { from: 'tab.tcas-admission-stat', to: 'dash.program-deep-dive' },
  { from: 'tab.kmitl-demand', to: 'dash.program-deep-dive' },
  { from: 'tab.jobthai-occupations', to: 'dash.program-deep-dive' }, // jobthai_demand_alignment driver

  // Existing Risk Mgmt gets the financial-at-risk feed
  { from: 'tab.financial-metric', to: 'dash.risk-portfolio' }, // direct revenue at risk
  { from: 'tab.faculty-budget', to: 'dash.risk-portfolio' },

  // ──────────────────────────────────────────────────────────────────────
  // AI-task INPUT edges — what each AI task actually reads.
  //
  // After the 2026-05-16 restructure AI tasks live in their own lane L4
  // (between L3 tables and L5 dashboards). Edges from L3 → L4 are
  // forward (clean curves). Edges from L4 → L3 (AI task writes to a
  // table) are backward (rendered as dashed leftward curves).
  //
  // For ai.analyst-agent, the 12 typed tools read from many tables;
  // only a representative subset is drawn here so the AI hub doesn't
  // become a fan-in spider. Detail panel lists the full tool surface.
  // ──────────────────────────────────────────────────────────────────────

  // Phase 3 — careers + demand crosswalk
  { from: 'tab.program', to: 'ai.program-careers-demand' },
  { from: 'tab.program-skill', to: 'ai.program-careers-demand' },
  { from: 'tab.kmitl-demand', to: 'ai.program-careers-demand' },
  { from: 'tab.jobthai-occupations', to: 'ai.program-careers-demand' }, // JobThai demand checked by demand-match.v4

  // Phase 5 — peer selection + review
  { from: 'tab.program', to: 'ai.program-peers' },
  { from: 'tab.program-skill', to: 'ai.program-peers' },
  { from: 'tab.tcas-admission-stat', to: 'ai.program-peers' },

  // Phase 6 — AI readiness
  { from: 'tab.program-skill', to: 'ai.program-ai-readiness' },
  { from: 'tab.program-analyses', to: 'ai.program-ai-readiness' },

  // Phase 7 — strategic narrative (synthesises every prior phase)
  { from: 'tab.program', to: 'ai.program-narrative' },
  { from: 'tab.program-analyses', to: 'ai.program-narrative' },
  { from: 'tab.enrollment-metric', to: 'ai.program-narrative' },
  { from: 'tab.financial-metric', to: 'ai.program-narrative' },

  // Phase 8 — risk assessment (deterministic L1/L2/L3 + AI narrative)
  { from: 'tab.program-skill', to: 'ai.risk-assess' },
  { from: 'tab.enrollment-metric', to: 'ai.risk-assess' },
  { from: 'tab.financial-metric', to: 'ai.risk-assess' },
  { from: 'tab.program-analyses', to: 'ai.risk-assess' },

  // Module AI — Cockpit brief
  { from: 'tab.enrollment-metric', to: 'ai.cockpit-brief' },
  { from: 'tab.financial-metric', to: 'ai.cockpit-brief' },
  { from: 'tab.program-skill', to: 'ai.cockpit-brief' },
  { from: 'tab.graduate-outcome', to: 'ai.cockpit-brief' },
  { from: 'tab.trend-signal', to: 'ai.cockpit-brief' },

  // Gap-map Council brief — reads the rows gap-map.v2 built, so its inputs
  // are the map's own: the field taxonomy, the assignments and the adverts
  // behind them. One AiInference per call; nothing is stored per field.
  { from: 'tab.job-field-taxonomy', to: 'ai.gap-brief' },
  { from: 'tab.program-job-field', to: 'ai.gap-brief' },
  { from: 'tab.jobthai-postings', to: 'ai.gap-brief' },
  { from: 'ai.gap-brief', to: 'dash.gap-analyzer' },

  // Scenario insights
  { from: 'tab.scenario', to: 'ai.scenario-insights' },
  { from: 'tab.enrollment-metric', to: 'ai.scenario-insights' },
  { from: 'tab.financial-metric', to: 'ai.scenario-insights' },

  // Benchmarking insights
  { from: 'tab.program-skill', to: 'ai.benchmarking-insights' },
  { from: 'tab.tcas-admission-stat', to: 'ai.benchmarking-insights' },
  { from: 'tab.imd-ranking', to: 'ai.benchmarking-insights' },

  // AI Analyst — representative tool-read surface (full set is 12 tools)
  { from: 'tab.program', to: 'ai.analyst-agent' },
  { from: 'tab.program-skill', to: 'ai.analyst-agent' },
  { from: 'tab.trend-signal', to: 'ai.analyst-agent' },
  { from: 'tab.scenario', to: 'ai.analyst-agent' },
  { from: 'tab.council-decisions', to: 'ai.analyst-agent' },
  { from: 'tab.risk-assessment', to: 'ai.analyst-agent' },
  { from: 'tab.research-output', to: 'ai.analyst-agent' },
  { from: 'tab.ai-extraction', to: 'ai.analyst-agent' },

  // Outcome review (Decision Workspace)
  { from: 'tab.council-decisions', to: 'ai.outcome-review' },
  { from: 'tab.enrollment-metric', to: 'ai.outcome-review' },
  { from: 'tab.financial-metric', to: 'ai.outcome-review' },

  // Expertise narrative (Profile)
  { from: 'tab.faculty-member', to: 'ai.expertise-narrative' },
  { from: 'tab.research-output', to: 'ai.expertise-narrative' },
  { from: 'tab.staff-education-history', to: 'ai.expertise-narrative' },
];

export const TOPOLOGY: Topology = {
  nodes: [...externalNodes, ...connectorNodes, ...tableNodes, ...dashboardNodes],
  edges,
};

// Counts surfaced on the page header for an at-a-glance "what's in here".
// AI tasks live in `connectorNodes` array but render in their own `ai`
// lane after the 2026-05-16 restructure — split the count accordingly.
const aiTaskCount = connectorNodes.filter((n) => n.kind === 'ai-task').length;
export const TOPOLOGY_COUNTS = {
  external: externalNodes.length,
  connectors: connectorNodes.length - aiTaskCount,
  ai: aiTaskCount,
  tables: tableNodes.length,
  dashboards: dashboardNodes.length,
  edges: edges.length,
} as const;

// ──────────────────────────────────────────────────────────────────────────
// Filter tabs
//
// Each tab (other than "all") names a set of anchor dashboard IDs. The
// graph renderer BFS-upstreams from those anchors, keeping every node
// and edge that can reach one. Adding a new module = add a new entry
// here — no edge re-tagging needed.
//
// The legacy `TopologyEdge.scope` field is no longer consulted for
// filtering. It's left optional on the type for documentary purposes
// and possible future re-use, but the v2 mechanism is anchor-based.
// ──────────────────────────────────────────────────────────────────────────

export type ScopeFilter =
  | 'all'
  | 'education'
  | 'staff'
  | 'cockpit'
  | 'deep-dive'
  | 'teaching-learning'
  | 'risk'
  | 'trends'
  | 'gap'
  | 'benchmarking'
  | 'scenarios'
  | 'decisions'
  | 'analyst';

export const FILTER_OPTIONS: ReadonlyArray<{ key: ScopeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'education', label: 'Education' },
  { key: 'staff', label: 'Staff' },
  { key: 'cockpit', label: 'Cockpit' },
  { key: 'deep-dive', label: 'Deep-Dive' },
  { key: 'teaching-learning', label: 'Teaching & Learning' },
  { key: 'risk', label: 'Risk' },
  { key: 'trends', label: 'Trends' },
  { key: 'gap', label: 'Gap' },
  { key: 'benchmarking', label: 'Benchmarking' },
  { key: 'scenarios', label: 'Scenarios' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'analyst', label: 'Analyst' },
];

export const FILTER_ANCHORS: Record<Exclude<ScopeFilter, 'all'>, readonly string[]> = {
  education: [
    'dash.education-recruitment',
    'dash.education-student-info',
    'dash.education-location',
    'dash.education-active-pivot',
    'dash.education-international',
    'dash.education-tuition',
    'dash.education-performance',
    'dash.education-class-offerings',
    'dash.education-satisfaction',
    'dash.education-program-overlap',
    'dash.education-student-dq',
  ],
  staff: [
    'dash.staff-workforce',
    'dash.staff-faculty-by-program',
    'dash.staff-research',
    'dash.staff-compensation',
    'dash.staff-teaching-workload',
    'dash.staff-teaching',
  ],
  cockpit: ['dash.cockpit'],
  'deep-dive': ['dash.program-deep-dive'],
  'teaching-learning': ['dash.teaching-learning'],
  risk: [
    'dash.risk-portfolio',
    'dash.risk-matrix',
    'dash.risk-indicators',
    'dash.risk-drivers',
  ],
  trends: ['dash.trends-radar'],
  gap: ['dash.gap-analyzer', 'dash.job-fields-review'],
  benchmarking: ['dash.benchmarking'],
  scenarios: ['dash.scenarios'],
  decisions: ['dash.decisions'],
  analyst: ['dash.analyst'],
};
