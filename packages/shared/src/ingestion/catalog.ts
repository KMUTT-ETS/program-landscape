import type { SourceCatalogEntry } from './types';

// Canonical source catalog. DB seed upserts one row per entry; the
// ingestion connector registry looks up its DataSource row by slug. If
// you add a new connector, you MUST add an entry here in the same
// commit or the registry won't find a DataSource to write runs against.
//
// All entries currently `mocked: true` — real wiring belongs in prompt
// 14. Flip to false when the connector actually hits the real upstream.

export const SOURCE_CATALOG: readonly SourceCatalogEntry[] = [
  // ── Internal KKU systems ────────────────────────────────────────────────
  {
    slug: 'kku-registry',
    name: 'KKU Registry (REG)',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 2 * * *', // daily at 02:00
    ownerContact: 'KKU Registrar — Academic Office',
    notes: 'Programs, courses, enrollment, degree completion. Master source for student-body demographics.',
    // Flipped real — see CLAUDE.md prompt-14 session log. This MUST stay
    // false: prisma/seed.ts writes `status` and `mocked` from this field on
    // every seed, so a stale `true` here silently re-mocks the connector and
    // realDataWhere() then discards every row it ever loaded.
    mocked: false,
  },
  {
    slug: 'kku-tcas-funnel',
    name: 'KKU TCAS Admission Funnel (deprecated)',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 4 * * *', // daily at 04:00 — after kku-registry
    ownerContact: 'KKU Registrar — Academic Office',
    notes:
      'DEPRECATED 2026-05-31 — superseded by kku-admission-campaigns (POWERBI.ADMISSION_STAT), which is a richer superset. All scoring / deep-dive / risk / cockpit / analyst now read the new source. Schedule disabled; the connector + tcas_admission_funnels table are kept for a verification window, then removed. Historical: full TCAS round 1–4 funnel from POWERBI.ADMISSION_STAT_CURRID.',
    mocked: false,
    deprecated: true,
    scheduleEnabled: false,
  },
  {
    slug: 'kku-admission-campaigns',
    name: 'KKU Actual Recruitment Campaigns',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '30 4 * * *', // daily at 04:30 — after kku-tcas-funnel
    ownerContact: 'KKU Registrar — Academic Office',
    notes:
      'Practical recruitment grain from POWERBI.ADMISSION_STAT — one row per campaign TRACK (competency / language / exam option / quota type / branch-campus intake) within a program × round × year. Finer than the curriculum-level ADMISSION_STAT_CURRID. PROGRAMID is the recruitment-program code (≠ MHESI curr code), resolved to canonical programs via the LLM-assisted AdmissionStatProgramMapping bridge. Seat/plan columns populate once Registrar IT adds them (connector auto-detects).',
    mocked: false,
  },
  {
    slug: 'kku-finance',
    name: 'KKU Finance',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 3 1 * *', // monthly on the 1st
    ownerContact: 'KKU Finance Office',
    notes: 'Program revenue, direct + shared cost allocation. Sensitive — restricted RBAC.',
    // Flipped real — see CLAUDE.md prompt-14 session log. This MUST stay
    // false: prisma/seed.ts writes `status` and `mocked` from this field on
    // every seed, so a stale `true` here silently re-mocks the connector and
    // realDataWhere() then discards every row it ever loaded.
    mocked: false,
  },
  {
    slug: 'kku-hr',
    name: 'KKU HR (Faculty roster)',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 4 * * 1', // weekly on Monday
    ownerContact: 'KKU HR Office',
    notes: 'Faculty member list with rank, department, appointment date, retirement projections.',
    // Flipped real — see CLAUDE.md prompt-14 session log. This MUST stay
    // false: prisma/seed.ts writes `status` and `mocked` from this field on
    // every seed, so a stale `true` here silently re-mocks the connector and
    // realDataWhere() then discards every row it ever loaded.
    mocked: false,
  },
  {
    slug: 'kku-alumni',
    name: 'KKU Alumni Outcomes',
    kind: 'API',
    inputFormat: 'MIXED',
    cadenceCron: '0 5 1 */3 *', // quarterly on the 1st
    ownerContact: 'KKU Alumni & Career Services',
    notes:
      'Graduate employment survey + Student Loan Fund repayments. Some cohort summaries arrive as PDF. ' +
      'API connector remains a stub, but real data lands via the script-based PDF/XLSX intake at ' +
      '`pnpm outcomes:ingest` / `pnpm outcomes:ingest-xlsx`. Catalog flag flipped to mocked=false on ' +
      '2026-05-11 because the data flowing through this DataSource is real (PDF intake), even though ' +
      'the API connector itself never runs.',
    mocked: false,
  },
  {
    slug: 'kku-research',
    name: 'KKU Research Outputs',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 6 * * 0', // weekly on Sunday
    ownerContact: 'KKU Research & Graduate School',
    // v2 (2026-05-07): pivoted from OpenAlex+Scopus public APIs to the
    // internal kku-publications mirror at 10.130.2.151. The mirror is a
    // curator-grade research data warehouse maintained by KKU Library —
    // 5 sources (Scopus, PubMed, ISI/WoS, TCI, NRIIS) with KKU author
    // resolution already done via people.id. v2 wires Scopus + PubMed;
    // ISI + TCI are stale (last updated 2022 / 2019) and deferred.
    notes:
      'Publications via the internal kku-publications mirror (Scopus + PubMed authorships, KKU author resolution by person_id). ISI + TCI deferred — stale upstream.',
    // Flipped real — see CLAUDE.md prompt-14 session log. This MUST stay
    // false: prisma/seed.ts writes `status` and `mocked` from this field on
    // every seed, so a stale `true` here silently re-mocks the connector and
    // realDataWhere() then discards every row it ever loaded.
    mocked: false,
  },
  {
    slug: 'digital-transcript',
    name: 'Thailand Digital Transcript',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 1 * * *', // daily at 01:00
    ownerContact: 'KKU Digital Transcript Team (existing KKU system)',
    notes: 'Skill claims per student. Already live in production — wiring here mirrors the claims feed.',
    mocked: true,
  },
  {
    slug: 'kku-evaluations',
    name: 'KKU Student Evaluations (Teaching & Learning)',
    kind: 'API',
    inputFormat: 'JSON',
    // Bi-weekly on the 1st and 15th at 21:00 local time (cron runs in
    // server timezone). A full refresh moves ~986K cells; running every
    // 14 days keeps the source under-load while still keeping the
    // dashboard refresh cadence well inside the typical Council review
    // cycle. Operators can force a fresh fetch via /admin/dashboard-data-fetch.
    cadenceCron: '0 21 1,15 * *',
    ownerContact: 'KKU Registrar — Academic Office (POWERBI schema)',
    notes:
      'Pre-aggregated student evaluations from POWERBI.EVALUATE_INSTRUCTOR — ~1.4M source rows ' +
      'spanning 5 years (BE 2564–2569), 21 (year,sem) buckets, 40 distinct questions, 2,456 ' +
      'instructors, 27 faculties. Aggregated server-side per (class × question × instructor) ' +
      'with TOTAL_STUDENT >= 5 anonymity gate. Powers /education/satisfaction (course-aggregated) ' +
      'and /staff/teaching (instructor-individual with tiered visibility). ' +
      'Refresh: bi-weekly (1st + 15th at 21:00); full load is ~110 min. ' +
      'Real connector wired 2026-05-19; 30-day green-history countdown to 2026-06-18.',
    mocked: false,
  },
  {
    slug: 'kku-dq',
    name: 'KKU Digital Intelligence (DQ) Student Scores',
    kind: 'API',
    inputFormat: 'JSON',
    // Weekly. The whole export is one 13.7 MB response served in ~3.4 s,
    // so there is no pagination to manage — and results only move as
    // students sit the test.
    cadenceCron: '0 3 * * 1',
    ownerContact: 'KKU LTIC — Learning & Digital Support (ltic.psli@kku.ac.th)',
    notes:
      'Per-student DQ competency results (13 theory + 4 workshop modules, pass mark 70). ' +
      'Aggregated in memory to two cubes; no student names or ids are persisted. ' +
      'Powers /education/student-dq.',
    mocked: false,
  },

  // ── National Thai ──────────────────────────────────────────────────────
  {
    slug: 'mhesi-cisa',
    name: 'MHESI CISA (Accreditation)',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 2 * * 1', // weekly Monday
    ownerContact: 'KKU Academic Standards & Quality Office',
    notes: 'Curriculum accreditation statuses. The existing CISA system already exposes an API — real wiring is cheap.',
    mocked: true,
  },
  {
    // Thailand population — official annual civil registration totals
    // (DOPA, Ministry of Interior) plus the long-term population
    // projection (NESDC: "Population Projections of Thailand
    // 2010-2040"). BOI's demographic page (boi.go.th/.../demographic)
    // is a downstream republisher of these two sources for foreign-
    // investor briefings; we cite it as the user-facing reference but
    // ingest from the upstream statutory sources directly. Refresh
    // cadence is annual — DOPA publishes around February for the
    // prior year; NESDC re-baselines projections every 5–10 years.
    slug: 'thailand-demographics',
    name: 'Thailand Demographics (DOPA · NESDC · BOI repost)',
    kind: 'PDF',
    inputFormat: 'MIXED',
    acceptsPdfUploads: true,
    cadenceCron: '0 9 15 2 *', // annual on Feb 15
    ownerContact: 'KKU Strategic Planning Office (public statutory data)',
    notes:
      'Annual population by age × region × sex from DOPA civil registration; long-term cohort projections from NESDC. BOI republishes summary tables at boi.go.th — used as the user-facing reference but the connector reads from DOPA/NESDC raw files because BOI is bot-firewalled (Incapsula). Drives the demographic ceiling on each program (the 18-22 cohort projection in the program\'s catchment region) and feeds the Gap Analyzer\'s supply-side forecasting.',
    mocked: true,
  },
  {
    slug: 'nso-labor-force',
    name: 'NSO Labor Force Survey',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 8 10 * *', // monthly on the 10th (NSO publishes ~1st week)
    ownerContact: 'KKU Data Office (no formal agreement — public data)',
    notes: 'Quarterly labor force survey + annual employment statistics. Published as heavily-tabled PDF + occasional CSV. Routes through the prompt 03b PDF intake pipeline.',
    mocked: true,
  },
  {
    slug: 'tcas',
    name: 'TCAS / TGAT-TPAT',
    kind: 'PDF',
    inputFormat: 'MIXED',
    acceptsPdfUploads: true,
    cadenceCron: '0 9 15 5 *', // annual — results published mid-May
    ownerContact: 'KKU Admissions Office',
    notes:
      'Annual national admission test scores + programme-level cutoffs. Mixture of PDF summaries and a partial API. ' +
      'The connector class is still a mocked stub but the DataSource row holds 25,705 real CUPT peer rows ingested ' +
      'via a one-time historical xlsx import. Catalog flag flipped to mocked=false on 2026-05-11 — the data IS real, ' +
      'just imported pre-connector-framework.',
    mocked: false,
  },
  {
    slug: 'tpqi',
    name: 'TPQI Occupational Standards',
    kind: 'PDF',
    inputFormat: 'MIXED',
    acceptsPdfUploads: true,
    cadenceCron: '0 7 * * 2', // weekly on Tuesday
    ownerContact: 'KKU TVET liaison',
    notes: 'Thailand Professional Qualification Institute standards. Portal has an API for metadata + PDF downloads for the standards themselves.',
    mocked: true,
  },
  {
    // Slug stays `kmitl-skill-mapping` because it identifies the technical
    // API endpoint (https://skill.kmitl.ac.th). The DATA SOURCE is LinkedIn,
    // SUBSCRIBED BY MHESI under a national agreement, with KMITL operating
    // the API layer. All user-facing labels reflect that attribution chain;
    // the slug is a stable internal handle.
    slug: 'kmitl-skill-mapping',
    name: 'LinkedIn Labour-Market Insights (MHESI subscription, KMITL-hosted)',
    kind: 'API',
    inputFormat: 'JSON',
    baseUrl: 'https://skill.kmitl.ac.th/api/v1',
    cadenceCron: '0 6 * * 1', // weekly Monday 06:00
    ownerContact: 'MHESI subscribes the LinkedIn data; KMITL operates the API. CLIENT_ID issued by KMITL under the MHESI agreement.',
    notes: 'Aggregated skill-demand intelligence sourced from LinkedIn (profiles + Thai job postings + university grad data). Subscribed by MHESI under a national agreement; KMITL hosts the API endpoint that aggregates and serves the data. Returns percentages at career/group/sub-group level — no per-posting rows, no salary, no province granularity. Replaces jobthai + jobsdb.',
    // Flipped real — see CLAUDE.md prompt-14 session log. This MUST stay
    // false: prisma/seed.ts writes `status` and `mocked` from this field on
    // every seed, so a stale `true` here silently re-mocks the connector and
    // realDataWhere() then discards every row it ever loaded.
    mocked: false,
  },
  {
    slug: 'jobthai',
    name: 'JobThai (Job postings)',
    kind: 'CSV',
    inputFormat: 'XLSX',
    // Files arrive by hand from JobThai and are uploaded through
    // /admin/jobthai, so there is nothing for a schedule to trigger. A
    // cadence here would wake the connector every six hours to find no
    // PENDING batch.
    scheduleEnabled: false,
    ownerContact: 'KKU Data Office',
    notes:
      'Manual XLSX drops of Thai job postings (47,643 rows in the 2026-09 drop). ' +
      'Un-deprecated 2026-09-13: the 2026-05-01 supersession by kmitl-skill-mapping ' +
      'assumed JobThai meant a paid API we never bought. Hand-delivered files give us ' +
      'three things kmitl-skill-mapping structurally cannot — province granularity, ' +
      'industry sector, and an explicit field-of-study requirement (a named discipline ' +
      'in 40.7% of postings, "any field" in a further 5.4%). ' +
      'CAVEATS, which travel with every figure derived from this source: 37.0% of ' +
      'postings are Bangkok and only 3.3% are the 20 Northeast provinces (Khon Kaen ' +
      'alone 304), so this describes the national market rather than KKU\'s region; ' +
      'only 0.8% mention a postgraduate qualification and just 41 state one as the ' +
      'minimum, so it is near-blind to 179 of KKU\'s 297 programmes; and the source ' +
      'carries no salary, no employer name and no posting date.',
    mocked: false,
  },
  {
    slug: 'job-108',
    name: 'Job-108 (Thai government job announcements)',
    kind: 'SCRAPE',
    inputFormat: 'HTML',
    // Weekly, Mondays 03:00. The site publishes ~96 announcements a month
    // (1,339 over the 14 months to 2026-09), so a weekly run finds ~22 and
    // the sitemap's lastmod keeps us from refetching the rest.
    scheduleEnabled: true,
    cadenceCron: '0 3 * * 1',
    ownerContact: 'KKU Data Office',
    notes:
      'Thai government and state-enterprise recruitment announcements. Public-sector ' +
      'counterpart to jobthai, which is a private-sector board. Each announcement states, ' +
      'per position, seats, education level and an explicit field-of-study list. ' +
      "The site's robots.txt disallows four AI crawlers by name and permits the wildcard " +
      'everywhere except /go.php and /url.php. The connector must therefore identify ' +
      'itself as KKU rather than route through a scraping proxy, and must never request ' +
      'those two paths.',
    mocked: false,
  },
  {
    slug: 'jobsdb',
    name: 'JobsDB (Job postings)',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 */6 * * *', // every 6 hours (no longer scheduled — see deprecated)
    ownerContact: 'KKU Data Office',
    notes: 'SUPERSEDED by kmitl-skill-mapping (2026-05-01). Catalog entry retained so historical IngestionRun rows don\'t orphan; full removal after kmitl-skill-mapping clears 30-day green-history gate.',
    mocked: true,
    deprecated: true,
  },
  {
    slug: 'mhesi-policy',
    name: 'MHESI Policy Announcements',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 6 * * *', // daily
    ownerContact: 'KKU Strategic Planning Office',
    notes: 'Ministry of Higher Education policy announcements — almost entirely PDF. Very noisy; the PDF intake pipeline filters.',
    mocked: false,
  },
  {
    slug: 'nesdc-reports',
    name: 'NESDC Economic Plans',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 7 * * 1', // weekly Monday
    ownerContact: 'KKU Strategic Planning Office',
    notes: 'National Economic & Social Development Council — 5-year plans + quarterly economic outlooks. Long PDFs (200+ pages) routed through 03b.',
    mocked: false,
  },
  {
    slug: 'nxpo-reports',
    name: 'NXPO Research/Innovation Policy',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 7 * * 3', // weekly Wednesday
    ownerContact: 'KKU Research & Innovation Office',
    notes: 'National Higher Education, Science, Research & Innovation Policy Council — R&D policy direction.',
    mocked: false,
  },
  {
    slug: 'boi-sectoral',
    name: 'BOI Sectoral Data',
    kind: 'PDF',
    inputFormat: 'MIXED',
    acceptsPdfUploads: true,
    cadenceCron: '0 8 5 * *', // monthly on the 5th
    ownerContact: 'KKU Industry Liaison Office',
    notes: 'Board of Investment — sector investment statistics. PDF reports + occasional Excel. Key input for S-curve + target industry analysis.',
    mocked: false,
  },
  {
    slug: 'eeco-reports',
    name: 'EECO (Eastern Economic Corridor)',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 8 15 * *', // monthly on the 15th
    ownerContact: 'KKU Industry Liaison Office',
    notes: 'Eastern Economic Corridor Office — industrial development plans. Less relevant to Khon Kaen geographically, but workforce signals carry over.',
    mocked: false,
  },

  // ── Regional / international ───────────────────────────────────────────
  {
    slug: 'wef-future-of-jobs',
    name: 'WEF Future of Jobs Report',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 10 1 5 *', // annual (May — when WEF typically publishes)
    ownerContact: 'KKU Data Office',
    notes: 'World Economic Forum annual report. Foundational for future-skill taxonomies. Always a long PDF.',
    mocked: false,
  },
  {
    slug: 'oecd-reports',
    name: 'OECD Sectoral Reports',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 10 * * 1', // weekly Monday
    ownerContact: 'KKU Data Office',
    notes: 'OECD skills + education outlook + sectoral reports. Thailand-specific reports pulled preferentially.',
    mocked: false,
  },
  {
    slug: 'world-bank',
    name: 'World Bank Data',
    kind: 'API',
    inputFormat: 'MIXED',
    cadenceCron: '0 11 * * 0', // weekly Sunday
    ownerContact: 'KKU Data Office',
    notes: 'Labor data, education indicators, demographic projections. World Bank has a free API + long-form PDFs for narrative reports.',
    mocked: false,
  },
  {
    slug: 'adb-gms',
    name: 'ADB Greater Mekong Subregion',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 11 * * 4', // weekly Thursday
    ownerContact: 'KKU Data Office',
    notes: 'Asian Development Bank — Greater Mekong Subregion reports. Critical for Laos/Myanmar/Cambodia peer context for some KKU programs.',
    mocked: false,
  },
  {
    // SUPERSEDED 2026-05-07 — kku-research pivoted from public APIs
    // (Scopus + OpenAlex) to the internal kku-publications mirror.
    // Catalog row retained so historical IngestionRun rows don't orphan;
    // schedule disabled in seed (DataSource.scheduleEnabled=false).
    slug: 'scopus',
    name: 'Scopus (superseded)',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 12 * * 0', // weekly Sunday
    ownerContact: 'KKU Library (existing subscription)',
    notes:
      'SUPERSEDED — Scopus content is now sourced via the internal kku-publications mirror (10.130.2.151), which carries 18,900 distinct KKU papers with curator-grade author resolution. The Elsevier API pathway is no longer wired.',
    mocked: false,
    deprecated: true,
  },
  {
    // SUPERSEDED 2026-05-07 — see kku-research notes.
    slug: 'openalex',
    name: 'OpenAlex (superseded)',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 13 * * 0', // weekly Sunday
    ownerContact: 'KKU Data Office (public API, no agreement needed)',
    notes:
      'SUPERSEDED — KKU publication metadata is now sourced via the internal kku-publications mirror, which adds PubMed coverage and replaces fuzzy name-matching with curator-grade person_id resolution.',
    mocked: false,
    deprecated: true,
  },
  {
    slug: 'imd-rankings',
    name: 'IMD World Competitiveness Rankings',
    kind: 'PDF',
    inputFormat: 'MIXED',
    acceptsPdfUploads: true,
    // No cron — IMD only releases 3× a year (June/Sep/Nov) and the
    // primary data path is the manual seed CLI. Operator triggers
    // Run-now after each release. scheduleEnabled=false keeps the
    // BullMQ queue free of monthly mock-PDF runs.
    scheduleEnabled: false,
    ownerContact: 'KKU Strategic Office (free imd.org/wcc summaries)',
    notes:
      'IMD World Competitiveness Yearbook + World Talent Ranking + World Digital Competitiveness Ranking. Country-level only (~67 economies). Manual seed via `pnpm imd:seed` is the primary path; PDF intake of the public summary brochures is a secondary path. KKU Library does NOT have a Smartcomp subscription — restricted to free public summaries.',
    mocked: false,
  },
  {
    slug: 'peer-programs-scraper',
    name: 'Peer University Program Pages',
    kind: 'SCRAPE',
    inputFormat: 'MIXED',
    acceptsPdfUploads: true,
    cadenceCron: '0 14 * * 6', // weekly Saturday
    ownerContact: 'KKU Data Office',
    notes: 'Scrapes Thai + ASEAN peer universities\' program pages + downloads their brochure PDFs. Legal grey zone — stick to public catalogue pages.',
    mocked: true,
  },
  {
    slug: 'the-rankings',
    name: 'Times Higher Education (THE) Subject Rankings',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 3 1 * *', // monthly (rankings release annually; cadence covers new-edition releases)
    ownerContact: 'KKU Library — licence + API credentials',
    notes: 'THE subject rankings + annual overall rankings. Licensed API; free tier gives top-200 only. Subscription needed for full peer-group visibility.',
    mocked: true,
  },
  {
    slug: 'qs-rankings',
    name: 'QS Subject Rankings',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 4 1 * *',
    ownerContact: 'KKU Library — licence + API credentials',
    notes: 'QS WUR + subject rankings. Requires subscription agreement. HTML scrape is possible for the public tier but fragile.',
    mocked: true,
  },
  {
    slug: 'scimago',
    name: 'SCImago Journal & Institution Rankings',
    kind: 'SCRAPE',
    inputFormat: 'JSON',
    cadenceCron: '0 5 1 * *',
    ownerContact: 'KKU Library',
    notes: 'Research-based rankings. Free. Annual release; scraping annual XLSX is the practical pipeline.',
    mocked: true,
  },
  {
    slug: 'unicon-ds1001',
    name: 'UNICON DS1001 — Student information',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 4 * * *', // daily at 04:00 (after DS2004 03:00 so resolution sees latest aliases)
    ownerContact: 'KKU Registrar — UNICON system administrator',
    notes: 'Per-student snapshot. PII-stripped projection — names + full DOB + address + passport never leave the source. CITIZEN_ID + STD_ID hashed at ingestion; CURR_ID joins Program.mhesiCode ∪ ProgramMhesiAlias.',
    mocked: false,
  },
  {
    slug: 'unicon-ds2001',
    name: 'UNICON DS2001 — Staff master record',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 5 * * *', // daily at 05:00
    ownerContact: 'KKU Personnel — UNICON system administrator',
    notes: 'Per-staff master snapshot. Names retained (RBAC-gated); CITIZEN_ID hashed. Drives the Staff dashboard suite.',
    mocked: false,
  },
  {
    slug: 'kku-hr-processed',
    name: 'KKU HR Processed — Salary aggregate',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 6 * * *', // daily at 06:00
    ownerContact: 'KKU HR Office',
    notes: 'Server-side GROUP BY ... HAVING n>=5 from vw_history salary. Per-person never crosses the wire. Powers Staff #6 Compensation + program pipeline cost-allocation methodology.',
    mocked: false,
  },
  {
    slug: 'unicon-ds2003',
    name: 'UNICON DS2003 — Employee education qualifications',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 2 * * *', // daily at 02:00
    ownerContact: 'KKU Personnel — UNICON system administrator',
    notes: 'KKU\'s submission to MHESI-UniCON. One row per (staff × degree). Hashed citizen ID is the cross-system join key.',
    mocked: false,
  },
  {
    slug: 'unicon-ds2004',
    name: 'UNICON DS2004 — Academic staff per program',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 3 * * *', // daily at 03:00
    ownerContact: 'KKU Registrar — UNICON system administrator',
    notes: 'Academic staff appointments per MHESI curriculum. CURR_ID joins Program.mhesiCode. Auto-resolves the latest ds2004_<YYSEM> table.',
    mocked: false,
  },
] as const;

export function getCatalogEntry(slug: string): SourceCatalogEntry | undefined {
  return SOURCE_CATALOG.find((e) => e.slug === slug);
}
