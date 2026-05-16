// ──────────────────────────────────────────────────────────────────────────
// Dashboard data-topology — static node/edge model for the
// /admin/application-topology page.
//
// Scope: every external system, connector/script, DB landing table, and
// dashboard that participates in the **Education** + **Staff** hubs and
// their sub-dashboards. Adjacent surfaces (Cockpit, Gap Analyzer,
// Benchmarking) are intentionally out — that page's job is to make the
// Edu+Staff data flow legible at a glance, not to draw the whole graph.
//
// Layered DAG, 4 columns:
//   L1 External systems   → L2 Connectors/Scripts → L3 Tables → L4 Dashboards
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
        'POWERBI.ADMISSION_STAT_CURRID — TCAS round-by-round funnel',
        'POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER — every section the registrar opened',
        'POWERBI.VIEWSTUDENTENROLLFEE × VIEW_STUDENT_DETAIL_ALL — tuition aggregates',
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
    label: 'kku-tcas-funnel',
    subtitle: 'Daily 04:00',
    details: {
      description:
        'Pulls POWERBI.ADMISSION_STAT_CURRID and upserts one row per CURR_ID × ROUND × ACADYEAR. CURR_ID resolves to Program via mhesiCode (+ alias table).',
      cadence: '0 4 * * * (daily 04:00 Asia/Bangkok)',
      sourceSlug: 'kku-tcas-funnel',
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
    subtitle: 'Sun 06:00 · publications',
    details: {
      description:
        'Pulls Scopus + PubMed publications via the kkuscholar mirror. ~65k (paper × author) upserts/run; ~90% resolve to a FacultyMember after the people backfill.',
      cadence: '0 6 * * 0 (Sundays 06:00)',
      sourceSlug: 'kku-research',
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
        'Per-PDF Gemini extraction — 4 prompts run in parallel: program-digest.v1 (course list + recruitment summary), program-faculty.v1 (responsible lecturers), program-skills-detailed.v2 (ESCO-tagged skill weights), program-pedagogy.v1.1 (teaching-method distribution).',
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
    label: 'Program careers + demand',
    subtitle: 'Phase 3 · LinkedIn careers + demand',
    details: {
      description:
        "Maps program skills to the LinkedIn-sourced career taxonomy (prompt: career-kmitl-mapping.v1) and crosswalks ESCO occupations against the program's skill set (demand-match.v2). Output drives the Deep-Dive demand section.",
      cadence: 'Per-program · programs-pipeline phase 3',
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
    subtitle: 'Phase 6 · program-ai-readiness.v3',
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
    subtitle: 'Phase 7 · strategic-narrative.v1',
    details: {
      description:
        "Thai-primary strategic narrative — the one the Council reads on the Deep-Dive's hero section. Synthesises every prior phase's output into a 600-word brief with confidence + caveats.",
      cadence: 'Per-program · programs-pipeline phase 7',
    },
  },
  {
    id: 'ai.risk-assess',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Risk assessment',
    subtitle: 'Phase 8 · risk-assessment.v2',
    details: {
      description:
        'Combines deterministic L1/L2/L3 scores (risk-scoring.v1) with AI narrative + 2-4 specific RiskMeasure recommendations per program. Writes RiskAssessment + RiskMeasure + KRI breach evaluations.',
      cadence: 'Per-program · programs-pipeline phase 8',
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
    id: 'ai.gap-insights',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Gap analyser insights',
    subtitle: 'On-demand · gap-insights.v1',
    details: {
      description:
        '3 modes: strategic-top-5 (Council-facing top opportunities), program-skills-to-add (per-program recommendation), sector-brief (1-page Thai sector analysis).',
      cadence: 'User-triggered from /gap',
    },
  },
  {
    id: 'ai.scenario-insights',
    lane: 'ai',
    kind: 'ai-task',
    label: 'Scenario insights',
    subtitle: 'On-demand · scenario-insights.v1',
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
    subtitle: 'On-demand · benchmarking-insights.v1',
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
    llm: 'claude',
    label: 'AI Analyst agent',
    subtitle: 'Tool-use · analyst-system.v1',
    details: {
      description:
        "Anthropic-only tool-use loop. 12 typed tools wrap @kku/db helpers: query_programs, get_program, query_skills, query_trends, query_gaps, compare_peers, run_quick_scenario, generate_chart, cite_source, search_policy_docs, search_research, get_methodology. Up to 8 loop iterations per turn.",
      cadence: 'User-triggered from /analyst',
      notes: [
        'One AiInference row per LLM invocation; AnalystMessage.aiInferenceIds[] stitches them together',
        'Tool results clipped to 8 KB to keep Claude context manageable',
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
    subtitle: 'On-demand · expertise-narrative.v2',
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
    subtitle: 'Per-upload · pdf-classify.v1',
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
    subtitle: 'Per-doc · policy-doc.v1',
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
    label: 'TcasAdmissionFunnel',
    subtitle: 'curr × round × year',
    details: {
      description:
        'TCAS round-by-round funnel: quota → applicants → passed → clearinghouse confirm → registrar report.',
      prismaModel: 'TcasAdmissionFunnel',
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
    subtitle: 'paper × KKU author',
    details: {
      description:
        'One row per (paper × KKU co-author). Sources: kku-publications:scopus, kku-publications:pubmed. Older openalex rows retained during the green-history window.',
      prismaModel: 'ResearchOutput',
    },
  },
  {
    id: 'tab.class-offering',
    lane: 'table',
    kind: 'table',
    label: 'ClassOffering',
    subtitle: '~122k rows · BE 2565–2569',
    details: {
      description:
        'Every section the registrar opened. Full delete-and-replace per run from POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER. registry_faculty_name resolves to Faculty.nameTh.',
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
        "Cluster of per-program AI-output tables, all written by programs-pipeline phases 3-7. Each row links to the AiInference that produced it. Surfaced on the Deep-Dive's 14 sections.",
      relatedTables: [
        'ProgramStrategicNarrative (Phase 7)',
        'ProgramAiReadinessAssessment (Phase 6)',
        'ProgramPedagogyAssessment (Phase 1)',
        'ProgramPeerSelection (Phase 5)',
        'ProgramPeerReview (Phase 5)',
        'ProgramDemandMatch (Phase 3)',
        'ProgramLifecycleVerdict (separate methodology)',
        'ProgramTrendSignal (Trends Radar fan-out)',
      ],
      notes: [
        'Collapsed into one node here — drawing 8 individual nodes would crowd the picture and they all share one upstream (the pipeline) and one consumer (the Deep-Dive)',
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
    subtitle: '/education/recruitment',
    href: '/education/recruitment',
    details: {
      description:
        'Full TCAS round 1–4 funnel — quota, applicants, passed, clearinghouse send + confirm, registrar reporting.',
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
    subtitle: '/education/performance',
    href: '/education/performance',
    details: {
      description:
        'Undergraduate GPAs and entry test scores. Faculty → Program drill-down on average GPA + Region → Province → School → Faculty → Program location view.',
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
    subtitle: '/staff/research',
    href: '/staff/research',
    details: {
      description:
        'All KKU staff publications (Scopus + PubMed, incl. retired) from the internal kku-publications mirror. Year-trend, faculty heatmap, productivity-by-rank.',
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

  // ──────────────────────────────────────────────────────────────────────
  // Cockpit + Deep-Dive + Risk Management + AI Analyst
  // ──────────────────────────────────────────────────────────────────────

  {
    id: 'dash.cockpit',
    lane: 'dashboard',
    kind: 'dashboard',
    label: 'Portfolio Cockpit',
    subtitle: '/cockpit',
    href: '/cockpit',
    details: {
      description:
        '5-dimension health heatmap (demand / financial / quality / relevance / capability), BCG-style matrix, rollup tree, AI brief, Council Pack PDF export. Health-score methodology v1.',
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
        "14 sections fan-out: overview, demand funnel, student cohorts, TCAS stats, recruitment, AI peers, AI readiness, lifecycle, strategic narrative, demographic outlook, financials, skills, outcomes, faculty composition, peers, trends. Role-gated faculty visibility (COUNCIL gets aggregates-only).",
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
        'Cross-program risk view — composite tier histogram, top-N riskiest, revenue-at-risk rollups by faculty, recent KRI breaches.',
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
    subtitle: '/gap',
    href: '/gap',
    details: {
      description:
        'Demand-supply gap analysis. KKU production (ProgramSkill rolled up to graduates) vs labour-market demand (LinkedIn aggregates via MHESI + OccupationDemand). Skill-by-skill gap bars + schematic Thailand regional map + per-sector forecast.',
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
  // ── External → Connector ───────────────────────────────────────────
  { from: 'ext.oracle-powerbi', to: 'con.kku-tcas-funnel', scope: E },
  { from: 'ext.oracle-powerbi', to: 'scr.link-class-offerings', scope: ES },
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
  { from: 'scr.backfill-faculty-emails', to: 'tab.faculty-member', scope: ES },
  { from: 'scr.seed-programs-from-sheet', to: 'tab.program', scope: ES },
  { from: 'scr.programs-pipeline', to: 'tab.ai-extraction', scope: ES },
  { from: 'scr.programs-pipeline', to: 'tab.program-course', scope: ES },
  { from: 'scr.programs-pipeline', to: 'tab.program-faculty', scope: S },
  { from: 'scr.materialise-program-courses', to: 'tab.program-course', scope: ES },

  // ── Table → Dashboard ──────────────────────────────────────────────
  // Recruitment
  { from: 'tab.tcas-admission-funnel', to: 'dash.education-recruitment', scope: E },
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

  // ──────────────────────────────────────────────────────────────────────
  // Direct data-input edges into AI tasks that consume external sources.
  // LLM provider is NOT shown as an edge — it's an inline pill on the
  // ai-task node (GEMINI / CLAUDE). Tasks that consume INTERNAL tables
  // (cockpit-brief, gap-insights, scenario-insights, …) don't get
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

  // Phase 8 risk
  { from: 'ai.risk-assess', to: 'tab.risk-assessment' },
  { from: 'ai.risk-assess', to: 'tab.risk-measure' },
  { from: 'ai.risk-assess', to: 'tab.risk-indicators' },

  // Module insights — all land as AiExtraction rows (typed payload)
  { from: 'ai.gap-insights', to: 'tab.ai-extraction' },
  { from: 'ai.scenario-insights', to: 'tab.ai-extraction' },
  { from: 'ai.benchmarking-insights', to: 'tab.ai-extraction' },
  { from: 'ai.outcome-review', to: 'tab.ai-extraction' },
  { from: 'ai.expertise-narrative', to: 'tab.ai-extraction' },

  // Cockpit brief is ai-inference-only (no AiExtraction); the edge to
  // ai-inference is the only outbound, drawn explicitly so the node
  // doesn't look orphaned.
  { from: 'ai.cockpit-brief', to: 'tab.ai-inference' },

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
  { from: 'tab.tcas-admission-funnel', to: 'dash.program-deep-dive' },
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
  { from: 'tab.program-skill', to: 'dash.gap-analyzer' },
  { from: 'tab.kmitl-demand', to: 'dash.gap-analyzer' },
  { from: 'tab.skill', to: 'dash.gap-analyzer' },
  { from: 'tab.program', to: 'dash.gap-analyzer' },
  { from: 'tab.faculty', to: 'dash.gap-analyzer' },
  { from: 'tab.ai-extraction', to: 'dash.gap-analyzer' }, // GAP_INSIGHTS

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

  // Existing Program Deep-Dive picks up the new connector outputs
  { from: 'tab.student-demographic', to: 'dash.program-deep-dive' },
  { from: 'tab.employer-feedback', to: 'dash.program-deep-dive' },
  { from: 'tab.staff-education-history', to: 'dash.program-deep-dive' },
  { from: 'tab.tcas-admission-stat', to: 'dash.program-deep-dive' },
  { from: 'tab.kmitl-demand', to: 'dash.program-deep-dive' },

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

  // Gap insights
  { from: 'tab.program-skill', to: 'ai.gap-insights' },
  { from: 'tab.kmitl-demand', to: 'ai.gap-insights' },
  { from: 'tab.skill', to: 'ai.gap-insights' },

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
  ],
  staff: [
    'dash.staff-workforce',
    'dash.staff-faculty-by-program',
    'dash.staff-research',
    'dash.staff-compensation',
    'dash.staff-teaching-workload',
  ],
  cockpit: ['dash.cockpit'],
  'deep-dive': ['dash.program-deep-dive'],
  risk: [
    'dash.risk-portfolio',
    'dash.risk-matrix',
    'dash.risk-indicators',
    'dash.risk-drivers',
  ],
  trends: ['dash.trends-radar'],
  gap: ['dash.gap-analyzer'],
  benchmarking: ['dash.benchmarking'],
  scenarios: ['dash.scenarios'],
  decisions: ['dash.decisions'],
  analyst: ['dash.analyst'],
};
