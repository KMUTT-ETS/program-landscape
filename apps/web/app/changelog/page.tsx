import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: "What's new" };

// ─────────────────────────────────────────────────────────────────────────
// User-facing changelog. Kept as static content in code — the source of
// truth is git log, but readers shouldn't need git to know what changed.
// When you ship a feature visible to Councils / executives / analysts,
// add an entry here.
//
// Entries are ordered newest-first.
// ─────────────────────────────────────────────────────────────────────────

interface ChangelogEntry {
  date: string;
  version: string;
  title: string;
  audience: ('Council' | 'Executive' | 'Analyst' | 'Admin')[];
  bullets: string[];
}

const ENTRIES: ChangelogEntry[] = [
  {
    date: '2026-06-11',
    version: 'v1.6.1 · Add signals from documents; job candidates & new-initiative ideas on the Trends Radar',
    title:
      'Turn any document or link into a trend signal, see the job positions each affected program feeds, and get AI-proposed re-skill/upskill offerings for demand KKU does not yet serve',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'New “Add signal from document” (Analysts/Admins): upload a PDF — e.g. a manpower-demand or job-posting report — or paste a URL, and the AI reads it, drafts a trend signal, and publishes it to the Trends Radar already enriched with the KKU programs and skills it affects and recommended actions. Available from the Admin console and as a command-line tool.',
      'Every trend signal’s “Affected programs” now shows the job positions each program’s graduates can fill, split into immediate roles (hireable now) and emerging roles (reachable in 1–3 years with curriculum adaptation or upskilling), each with the number of candidates — drawn from the program’s active student cohorts, the same source as the program page.',
      'Recommended actions on each signal are richer: each carries a short title, a what/why/how detail, and one to three concrete example projects KKU could actually charter (a new course or track, an industry partnership, a micro-credential, a research lab, a co-op pipeline).',
      'New “New initiatives — re-skill / upskill products” section: where a signal demands roles no KKU program currently supplies — a field KKU does not teach, or a vocational/sub-degree-level position — the system proposes a new product or service KKU could launch (a micro-credential, bootcamp, short course or non-degree certificate), with the unmet role it serves, the target audience to re-skill/upskill, and the delivery format.',
    ],
  },
  {
    date: '2026-06-10',
    version: 'v1.6.0 · Benchmarking rebuilt, multi-lens Gap Analyzer, AI trend analysis',
    title:
      'A redesigned competitive-benchmarking experience with a per-program positioning view, a curriculum-modernity verdict, a seven-lens Gap Analyzer with a single composite index, AI analysis on every trend signal, and the curriculum revision year shown wherever a program is named',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'Competitive Benchmarking refocused on curriculum content. The AI peer review (v3) now judges each program on content gaps, program relevance, modernization and AI readiness — with staff capability still reflected through research performance — and no longer factors in enrolment or finances, which belong to other modules. Picking a program opens a dedicated benchmarking view at /benchmarking/programs/[id] focused on content positioning, with every benchmark reference stated explicitly and linked to its source.',
      'New “Curriculum modernity verdict” — a one-glance view of where KKU’s reviewed curricula sit on the old-school → frontier spectrum, AI-judged against the actual content of named peer programs. It appears on Competitive Benchmarking and beside the Strategic Matrix on the Executive Landscape dashboard.',
      'The Gap Analyzer is rebuilt as a seven-lens analyzer (skills, modernization, AI readiness, market demand, program relevance, staff capability, systemic topics) rolled into a single Composite Gap Index per scope, with drill-down from faculty to the individual programs driving each gap.',
      'Every trend signal now carries AI analysis: which KKU programs and skills it affects, and recommended actions — so a signal is actionable, not just informational.',
      'Wherever a program is named — the Programs directory, Competitive Benchmarking, the Risk register, Gap-analysis risks, and the program deep-dive — the curriculum revision year is now shown (e.g. “Rev. BE 2566 (CE 2023)”), so readers always know which version of a curriculum a number refers to.',
      'The university-vs-faculty GPA trend chart now respects the selected scope; a program-level reader sees their faculty’s line against the university benchmark.',
      'Admin pipeline launchers now state the correct number of processing phases.',
    ],
  },
  {
    date: '2026-06-09',
    version: 'v1.5.3 · Faculty GPA trend; deep-dive narrative regenerate fix',
    title:
      'A new university-vs-faculty GPA trend chart, and a fix so the deep-dive “Regenerate” button rewrites the program narrative with the correct prompt',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'New “Average GPA by year — University vs faculty” chart on Student performance: one line per faculty against a distinguished university-overall line, with academic year on the x-axis. It is built straight from the registrar’s graded class offerings (credit-weighted, no course-to-program mapping needed). Click any name in the legend to show or hide its line, and hover a year to compare every visible faculty at once. The current in-progress academic year is excluded until enough of its classes are graded to be representative.',
      'Fixed the program deep-dive “Regenerate” button on the Strategic narrative. It now reruns the exact same Council-brief prompt the per-program pipeline uses and saves the result — previously it silently ran a different prompt (the portfolio cockpit brief), so regenerating replaced the program’s narrative with a differently-styled write-up that didn’t match the one produced during processing.',
    ],
  },
  {
    date: '2026-06-04',
    version: 'v1.5.2 · Recruitment charts + correct % Admit; profile summary fix',
    title:
      'Year-over-year recruitment charts, plan-accurate % Admit, cleaner program mapping, and a fix for the profile expertise summary',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'Recruitment dashboard: the year-over-year demand chart is now interactive — click a line in the legend to show/hide it, and hover any year for a card with each metric’s value, formula, and worked calculation. Overlapping lines/legend fixed; gaps in the data now break the line instead of bridging across.',
      'New “% Admit — year-over-year” trend chart (with a Plan = 100% reference line), shown beside the by-TCAS-round histogram; the round breakdown table now spans the full panel width.',
      '% Admit is now plan-accurate. It divides only over programs that actually have a plan, so an aggregate that mixes planned and not-yet-planned programs is no longer overstated. Tables and KPIs flag partial coverage (“covers X of Y programs”), and the % Admit trend omits only years with no plan data at all.',
      'Program ↔ sub-program mapping corrected: a per-program mapping now takes precedence over a reused curriculum code, fixing 28 programs that were wrongly folded together (e.g. High-Speed Rail Engineering now stands alone, mapped to its own curriculum). Brand-new programs not yet in the catalogue (e.g. Semiconductor Engineering) show as their own “New program” instead of being folded under an unrelated one.',
      'Fixed the /profile expertise summary, which on production fell back to a placeholder (“AI service is not yet configured”). Root cause was an outdated AI SDK that couldn’t disable model “thinking”, so reasoning-heavy profiles overran the response and produced no result. The AI SDK was upgraded so thinking control works across every AI feature (also makes the AI Analyst and curriculum digests more reliable).',
    ],
  },
  {
    date: '2026-06-02',
    version: 'v1.5.1 · Evaluation refresh reliability',
    title:
      'The bi-weekly student-evaluation refresh can no longer freeze the data-ingestion worker',
    audience: ['Admin', 'Analyst'],
    bullets: [
      'Fixed a production issue where the scheduled student course-evaluation refresh could peg the ingestion worker at full CPU and leave the app unresponsive for hours every few days. The refresh moved ~986k evaluation cells one row at a time and held the whole dataset in memory twice, which starved the worker; it now loads in bulk batches with a single in-memory pass.',
      'The refresh is now incremental — it only pulls evaluation rows the registrar has updated since the last successful load. Between registrar refreshes the scheduled run is a near-instant no-op instead of re-loading everything; a full reload is still available on demand.',
      'Ingestion hardened against overlapping runs — a longer job lock, an automatic reaper for runs left stuck after a restart, and a guard that skips a connector if a run of it is already in progress. Together these stop the run-pile-up that amplified the original freeze.',
    ],
  },
  {
    date: '2026-06-01',
    version: 'v1.5.0 · Recruitment rebuilt on POWERBI.ADMISSION_STAT',
    title:
      'The whole recruitment layer moves to the registrar\'s campaign-grain admission feed — a richer superset of the old curriculum-level data — plus a new actual-recruitment dashboard',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'New dashboard /education/recruitment-campaigns at the campaign-track grain — one row per recruitment track (competency / language / exam option / quota type / branch-campus intake) within a program × round × year. Recruitment funnel, year-over-year demand, by-TCAS-round breakdown, and a Faculty → program → sub-program → TCAS round → track drill-down with sortable headers and hover tooltips that show each cell\'s value, formula, and worked calculation.',
      'Drill-down adds % Enrol yield (Enrolled ÷ Passed) alongside % Admit; the TCAS-round tier always reads top-to-bottom by round number regardless of the reader\'s column sort.',
      'Recruitment data source migrated from POWERBI.ADMISSION_STAT_CURRID (curriculum grain) to POWERBI.ADMISSION_STAT (campaign grain) across the whole application — health scoring (Attractiveness), lifecycle verdict, the Health radar, the Program Deep-Dive recruitment funnel + demand funnel + demographic outlook, recruitment-vs-plan, and the Risk module\'s L1 recruitment-decay driver + competitiveness percentile now all read the new feed.',
      'Plan quota is now counted correctly per intake (sum of each recruitment program\'s annual plan), fixing a prior undercount where majors that share one curriculum code collapsed onto a single quota.',
      'Methodology versions bumped: health-score.v3.8, risk-scoring.v1.12, program-recruitment.v2, recruitment-rollup.v2. Drivers, formulas, and weights are unchanged — only the underlying source moved. The public Methodology paper (/docs/methodology) is updated to match.',
      'The old TCAS-funnel connector (ADMISSION_STAT_CURRID) is deprecated; the admin Dashboard data-fetch and Application-topology surfaces now point at the new connector.',
    ],
  },
  {
    date: '2026-05-20',
    version: 'v1.4.0 · Research quartiles + recruitment round analysis',
    title: 'Scopus journal-quartile tiers on research; TCAS-round analysis + national demographic outlook on the deep-dive',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'Scopus journal quartile (Q1–Q4) and a Top-10% (Tier 1) tier added to research outputs and the /staff/research dashboard — quartile-led redesign with a year-range slider.',
      'TCAS-round analysis added to the recruitment dashboard.',
      'Program Deep-Dive demographic outlook is now national- and funnel-aware; University + Faculty averages overlaid on the Health radar for context.',
      'Risk L3 demographic-ceiling driver gains a forward demographic projection (risk-scoring.v1.11).',
      'program-digest.v2 — generalised, English-keyed skill extraction from curriculum PDFs.',
      'Sortable column headers across Education + Staff dashboard tables; a global navigation progress bar for slow transitions; the per-teacher deep dive becomes a Faculty → Program → Teacher drill-down.',
      'Class-GPA + student-satisfaction dashboards scoped to the user\'s program for PROGRAM_USER.',
    ],
  },
  {
    date: '2026-05-19',
    version: 'v1.3.0 · Student evaluations + class GPA + teaching',
    title: 'Course-evaluation + class-GPA dashboards; risk breaches now auto-propose a mitigation measure',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'New student course-evaluation and class-GPA dashboards; new /staff/teaching surface; application-topology updated for the new flows. The evaluation signal also feeds a new student_satisfaction driver in the health score (health-score.v3.7).',
      'risk-management.v2 closes the breach → measure gap — a deterministic rule engine fires one candidate mitigation measure per matched (KRI × severity) pair before the AI runs, so a program with fired indicators never shows an empty mitigation list.',
      'Sidebar drawer mode; Program Deep-Dive trimmed; staff-research enhancements; faster home-page first paint.',
      'AI: dynamic OpenRouter model catalog with a gemini-3.5-flash default.',
      'Pipeline: deduplicated PDF prep + parallelised phase 2b; class-offerings refresh added to the admin tools.',
    ],
  },
  {
    date: '2026-05-18',
    version: 'v1.2.5 · Hotfix — Gemini tool-schema union rejection',
    title:
      'dash_compute\'s series.period field was a JSON-Schema union ({type:["string","number"]}) which Gemini\'s function-calling protobuf rejects with HTTP 400. Every dashboard chat turn was failing on the first tool-list load. Tightened to {type:"string"} — bot passes year labels as strings ("2569"). No effect on other tools.',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'dash_compute(op="year_over_year") schema fix: series[].period is now string-only. Existing callers stringify their year keys ("2569" instead of 2569). Zod schema mirrors the change.',
      'System prompt version bumped to analyst-dashboard-system.v1.4.1.',
      'Root cause documented: Gemini\'s JSON-Schema → Protobuf converter accepts only a single primitive type per field. Adding a multi-type union anywhere in the tool catalog turns the whole chat surface into an "Agent error: got status: 400 Bad Request" on every turn. Eslint catch: lint rule could be added to forbid array-typed `type` in tool inputSchema definitions.',
    ],
  },
  {
    date: '2026-05-17',
    version: 'v1.2.4 · Dashboards Assistant — chat scoped to Education + Staff',
    title:
      'New AI chatbot that answers operational questions about every Education + Staff dashboard. Side panel on every dashboard page (⌘/Ctrl+/) plus a dedicated full-page view at /analyst/dashboards. Reaches every drill-down on every sub-dashboard via per-tool `view` parameters.',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      '80-scenario test plan + runnable harness — `docs/dashboard-chatbot-tests.md` enumerates 50 Education + 30 Staff multi-turn scenarios with pass criteria + sanity bounds. `pnpm dash-chatbot:eval` walks all 240 turns against a local dev server, scans every answer for sanity violations, refusal regressions, and redirect expectations. 8 systematic weaknesses found in the walkthrough and patched in v1.4.',
      'dash_compute v2 — adds 4 new ops: `rank_bottom` (worst/lowest), `min`, `max`, `year_over_year` (Δ + %Δ per period + total CAGR). Plus a new `sanityMin` parameter (mirror of sanityMax — catches negative GPAs, sub-1900 years, etc.). System prompt v1.4 spells out the bottom-N and trend patterns explicitly so the LLM doesn\'t fall back to head-math.',
      'Cross-term guards now ship on `dash_education_tuition`, `dash_education_class_offerings`, `dash_education_active_pivot` (in addition to teaching_workload). Each tool result carries an `appliedFilter` block telling the bot what slice the number actually covers — eliminates the "spans multiple terms but labelled as per-week" bug class across the catalog.',
      'GPA sanity check at the tool layer — `dash_education_performance` now flags any reported `averageGpa` / `averageEntryGpa` / `averageEnglishGpa` > 4.0 (or < 0) with a `dataQualityWarning` that the system prompt forbids reporting.',
      'Safety gate v3 — refuses Thai student IDs (`รหัสนักศึกษา <8-13 digits>`), KKU employee codes (`hr_*`, `kkupub_*`), "this student / นักศึกษาคนนี้" identification asks, and "show me <Name>\'s record" patterns. Tested negative on revenue figures and population numbers (no false positives). 39/39 safety tests pass (19 strategic + 10 dashboard + 10 personal-info v3).',
      'System prompt v1.4 adds anti-hallucination rule 11 — "ADMIT WHEN HISTORICAL CONTEXT IS MISSING". Some tools (international, by_location, workforce age) carry no year axis; the prompt now requires the bot to plainly say "this dashboard only shows the current snapshot; historical comparison isn\'t available" instead of inventing past data points.',
      'Anti-hallucination guard on teaching-workload tool — without (acadYearBE, semester), the SQL CTE sums contact_hrs across EVERY academic term but each section\'s hours are per-week, producing nonsensical "1,249 hrs/week/teacher" rollups. Executor now auto-defaults to resolveLatestSnapshot() (same as the dashboard UI on first load) and echoes appliedFilter so the bot states the term it answered for. A second guard runs an in-process sanity check at the executor boundary — any avgContactHrsPerTeacher > 168 (impossible per-week) lands a dataQualityWarning that the system prompt treats as "do not report".',
      'New dash_compute tool — safe arithmetic sandbox for sum / average / weighted_average / ratio / rank_top. Optional sanityMax raises a dataQualityWarning when the result exceeds a physical bound (168 for hrs/week, 4.0 for GPA, 100 for %). System prompt requires the bot to route every non-trivial calculation through it instead of "computing in head". No expression parsing, no eval — opaque op enum keeps the surface injection-free.',
      'System prompt v1.3 adds five anti-hallucination rules: (7) sanity-check every number against physical bounds before reporting, (8) honour dataQualityWarning fields by refusing to report flagged numbers, (9) honour appliedFilter notes — state the term you actually answered for and never report a per-week value when cross-term aggregation is warned, (10) never compute in head — route through dash_compute, (11) state limitations plainly and offer alternatives (related question / dashboard URL / referral to /analyst) instead of inventing numbers.',
      'New dedicated route /analyst/dashboards — bilingual chat scoped to /education + /staff. Same SSE streaming + evidence panel as the strategic /analyst; starter prompts focus on student counts, location splits, GPA, recruitment funnel, workforce, retirement, compensation funding, teaching workload, research output.',
      'New side-panel widget on every Education + Staff page — floating chat FAB at the bottom-right, slide-in drawer with the current sub-dashboard as a context hint. ⌘/Ctrl+/ to toggle, Esc to close, "Open full view" link deep-links into /analyst/dashboards.',
      '16 dashboard-scoped tools wrap the same EducationService / StaffService / TeachingWorkloadService / RecruitmentService / ClassOfferingsService methods the dashboards already use — the chat numbers always match what the dashboards show, no second source of truth.',
      'Every drill-down is reachable via a `view` parameter — 37 view options across 10 tools. Education: by_location (overview/provinces/schools), active_pivot (university/faculty), international (overview/faculty_drill), tuition (overview/by_year/faculty_drill), performance (overall/by_program/by_location/entry_scores — by_location ranks schools by GPA with ≥5-student floor), recruitment (kpis/programs/by_round/by_year + sortBy applicants/competition/fill/yield), class_offerings (summary/distribution/ge/heatmap/deep_dive). Staff: teaching_workload (summary/histogram/by_faculty/teachers/students_by_faculty), research (overview/top_authors/top_venues/by_faculty/heatmap/by_rank/by_year), faculty_by_program (overview/faculty_drill).',
      'System prompt (analyst-dashboard-system.v1.2) enumerates every tool\'s views + spells out the drill-down playbook: dash_filter_options first → overview → drill into a specific row.',
      'Separate conversation history per surface — strategic Council conversations stay in /analyst, operational dashboard conversations stay in /analyst/dashboards. New AnalystConversation.kind column (STRATEGIC | DASHBOARD) with a (user, kind, updated_at) index for the list query.',
      'New dash_filter_options tool the bot calls first when it needs an exact Thai faculty / program name — prevents the model from inventing labels that won\'t match the cube\'s WHERE clause.',
      'New dash_data_freshness tool answers "is this data current?" against each cube\'s refreshedAt without making the bot consult the connector tools.',
      'Server-side scope guards flow through unchanged — FACULTY_USER + PROGRAM_USER see only their reach; spatial clamps run BEFORE the tool dispatches.',
    ],
  },
  {
    date: '2026-05-16',
    version: 'v1.2.2 · Application topology — interactive 3D data-flow map',
    title:
      'New /admin/application-topology surface — every active connector → Postgres table → AI task → consuming dashboard, with pan / zoom / fullscreen and a 2D ↔ 3D isometric toggle',
    audience: ['Admin'],
    bullets: [
      'New page /admin/application-topology — visual map of how data flows through the whole app. ~90 nodes across 5 lanes (External systems → Connectors / Scripts → Postgres tables → AI tasks → Dashboards) with ~200 edges. Covers every active connector (14 real KKU sources, the 2 deprecated ones excluded) and every consumer module — Education + Staff sub-dashboards, Cockpit, Program Deep-Dive, Risk portfolio + matrix + indicators + drivers, Trends Radar, Gap Analyzer, Benchmarking, Scenario Planner, Decision Workspace, AI Analyst.',
      'Connector nodes carry a live LIVE / MOCK pill driven by data_sources.mocked from /admin/data-sources — drift detection inline. AI task nodes carry a per-task GEMINI / CLAUDE vendor pill so you can see at a glance which LLM each prompt runs on.',
      'Hover-trace highlights upstream + downstream paths; click pins a floating tooltip with description, target, cadence, Prisma model, live status (with drift warning when status/mocked disagree), related tables, and a link out to the consuming surface.',
      '12 filter tabs by dashboard family — All, Education, Staff, Cockpit, Deep-Dive, Risk, Trends, Gap, Benchmarking, Scenarios, Decisions, Analyst. Anchor-based upstream BFS shows only the subgraph that feeds the chosen family.',
      'Pan + zoom (⌘/Ctrl + wheel) + native browser fullscreen + 2D ↔ 3D toggle. The 3D view is a real X-Y-Z isometric projection: base lanes (L1 / L2 / L3 / L5) sit on the X-Y floor plane, L4 AI tasks are elevated at Z = AI_Z. A subtle floor grid plus dashed drop-pillars from each AI box to its base-plane shadow visualise the depth. Shift+drag rotates the scene; ↺ snaps back to the iso default.',
      'LIVE / MOCK signal now keys off data_sources.mocked (canonical boolean) instead of data_sources.status (enum) — closes the v1.1.3 drift footgun where flipped-real connectors still showed MOCK because the status column never got the matching UPDATE. Inline drift warning surfaces in the detail panel when the two columns disagree.',
      'Tile added to /admin landing in the "External data" group.',
    ],
  },
  {
    date: '2026-05-15',
    version: 'v1.2.0 · Class offerings + teaching workload + teaching profile',
    title: 'Two new dashboards on registrar class-offerings; teaching summary on every profile; program-user access across Education + Staff',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'New dashboard /education/class-offerings — every class section the registrar opened, with seat-fill heatmap (faculty × semester, all 5 years × 4 terms once they’ve run), section utilisation distribution, dedicated general-education view (GE Institute + Language Institute), and a faculty → program-level → course drill-down table with sortable columns. Source: POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER (~122k sections, BE 2565–2569).',
      'New dashboard /staff/teaching-workload — contact hours per teacher per week, derived from COURSEUNIT lecture + lab hours × every section they teach. Workload-band histogram (under-load / normal 9–15 hrs / over-load), faculty pulse, students-taught bar chart, and a faculty → teacher drill-down with lecture / lab / total hours, sections, students, and team-teaching share. Teacher names are prefixed with the Thai academic rank title; KKUMAIL emails kept out of the UI.',
      'New section on /profile — Teaching profile · last 5 academic years. Two KPIs (distinct courses, students taught), an SVG bar histogram of students-taught per year (skipping the not-yet-enrolled trailing term), and a most-taught-courses list. Sits under Programs taught. Owner-only — public profile keeps it hidden.',
      'Program-user access across Education + Staff — PROGRAM_USER now sees the Education + Staff menus and every sub-dashboard. Faculty-grain tiles (student-info, workforce, etc.) roll up to the user’s program’s faculty; the two program-aware tiles (class-offerings, teaching-workload) clamp to the program’s courses via the curriculum PDF extraction (option 1, includes GE) with a teacher-derived fallback for un-digested programs.',
      'Fill-rate pill on the deep-dive table now picks text colour by background band — readable on every step of the orange / red ramp across both light and dark themes.',
      'Postgres dev container’s /dev/shm raised from 64 MB → 1 GB so the 6-way parallel page fan-out fits comfortably; staff-workload CTE refactored to drop a correlated subquery (~10× lighter).',
      'Server-form filter rail across both dashboards — same UI idiom as /programs; URL-shareable and reliable (state lives in the URL, no React drift).',
    ],
  },
  {
    date: '2026-05-14',
    version: 'v1.1.5 · Multi-scope sessions + UI polish',
    title: 'Multi-scope respect across every module; BCG tooltip + radar layout',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'Multi-scope session model — a user whose primary role is PROGRAM_USER but who holds a UserScope grant of UNIVERSITY_USER (or FACULTY_USER) is now treated at the elevated tier in every module. The JWT carries the highest-rank grant; the DB row keeps the original assignment as audit. Applies to risks, cockpit, executive landscape, /programs directory, education + staff dashboards, and the admin gates. Multi-scope SSO users who are auto-assigned to N programs see one of those programs in single-scope views (cockpit, executive landscape, /programs) and the union across all of them in risks.',
      'Strategic Matrix (BCG) on Executive Landscape — hover now shows a floating tooltip card next to the cursor with axis values, size, and contribution. Edge-aware: flips left/up near the right/bottom edges.',
      'Likelihood-drivers radar on /risks/[id] — compact L1/L2/L3 axis markers replace the longer labels that overlapped the right-side KPI cards.',
      'Risk Management drivers chart\'s automation-risk panel now shows only skills taught by programs in scope (was the global skill taxonomy regardless of scope). Indicator histograms + severity counts clamp consistently with the breach list.',
      'Top-bar scope dropdown removed — scope is now entirely role-driven from the session, so the dropdown wasn\'t the source of truth for any module\'s data fetch. The command-palette search trigger now fills the row.',
    ],
  },
  {
    date: '2026-05-13',
    version: 'v1.1.3 · Pipeline reliability',
    title: 'Run-pipeline button works end-to-end on production',
    audience: ['Admin', 'Analyst'],
    bullets: [
      'Worker-spawned CLI scripts (programs-pipeline + 5 phase children) now ship as self-contained esbuild bundles — phases 2 / 4 / 8 run cleanly under the prod node runtime.',
      'Pipeline child-process logs persist on the host and stream live in /admin/programs/[id]?tab=pipeline.',
      'Deep-dive sections (TCAS3 scores, Cohort distribution, Demand funnel) now resolve real-data provenance correctly — silent-empty UI bug fixed.',
      'Pedagogy assessment accepts domain-standard acronyms (PBL, OSCE, EBM, Lab) — fixes ~75% of medical / dental / science programs that previously failed pedagogy extraction.',
      'Container UID drift + read-only filesystem mount issues resolved.',
    ],
  },
  {
    date: '2026-05-13',
    version: 'v1.1.2 · Auto-approve queue + extractor capacity',
    title: 'Extraction review backlog cleared; PROGRAM_DIGEST + IMD materialise on write',
    audience: ['Admin', 'Analyst'],
    bullets: [
      'PROGRAM_DIGEST + IMD_RANKINGS auto-approve + materialise the moment they are extracted — no more pending-review backlog.',
      'PROPOSED_SKILL + PROGRAM_FACULTY_LIST extractions auto-approve at write time too (taxonomy growth path).',
      'AI extractor maxOutputTokens raised 12k → 50k on heavy per-program calls — avoids mid-response truncation on Pro models.',
      'Job queue UI surfaces handler-reported FAILED verdict + per-program target chip + live activity feed.',
      'Programs directory: Faculty filter excludes BUs with no canonical programs.',
    ],
  },
  {
    date: '2026-05-10',
    version: 'v1.1.0 · Streaming Analyst + per-user profile',
    title: 'AI Analyst streams responses · /profile page · live publications',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'AI Analyst streams responses token-by-token with status events ("calling tool …", "synthesising …"). Conversation history can be deleted per-user.',
      'New /profile page — per-user academic resume: education, publications, KKU role linkage, AI expertise narrative (bilingual TH + EN).',
      'Avatar upload + crop (MinIO-backed); appears in top-bar dropdown + profile hero.',
      'APA 7 citation rendering with owner surname bolded; 20-per-page pagination.',
      'Live Scopus publication pathway for /profile (cold load 45s → 5s; 1998–2025 coverage; full author lists).',
      'Universal home-page KPIs cached for <100ms first paint.',
      '/education + /staff dashboards opened to FACULTY_USER role.',
      'Programs directory adds curriculum-year (BE) + language filters.',
      'KKU logo replaces placeholder monogram in sidebar + browser favicon.',
    ],
  },
  {
    date: '2026-05-07',
    version: 'v1.0.x · Internal research warehouse',
    title: 'kkuscholar publications mirror replaces public APIs',
    audience: ['Analyst', 'Admin'],
    bullets: [
      'Research connector pivoted from OpenAlex + Scopus public APIs to KKU Library\'s internal publications warehouse (kkuscholar).',
      'Coverage: Scopus 29.9k + PubMed 29.5k = 59.4k unique (paper × KKU author) pairs spanning 1948–2026.',
      'FacultyMember rows backfilled from kkuscholar.people (1,375 new researchers across 36 faculties).',
      'Match rate 57% → 99.6% — virtually every KKU-authored paper now links to a person + faculty.',
      'On-network connector run finishes in ~5 minutes end-to-end.',
    ],
  },
  {
    date: '2026-05-01',
    version: 'v1.0.x · Curriculum digestion + skill demand',
    title: '297 programs seeded · KMITL labour-market signal live',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'Full KKU master curriculum sheet loaded — 297 programs (101 BSc · 111 MSc · 68 PhD · 17 Higher Grad Dip).',
      '228 programs digested by Gemini against the source มคอ.2 PDF — degree details, course list, learning outcomes, skill extraction, Thai recruitment summary.',
      'KMITL Skill Mapping connector live — 2,841 skills × 401 careers from LinkedIn (Thailand + Global, profiles + job postings; data owned by LinkedIn, subscribed by MHESI, API hosted by KMITL).',
      'Health score "demand" dimension now factors a labour-market-alignment driver (formerly null).',
      'Gap Analyzer supply ↔ demand chart switches automatically to KMITL data when available.',
    ],
  },
  {
    date: '2026-04-28',
    version: 'v0.14.x · KKU institutional data live',
    title: 'HR · Finance · Registry · Research connectors flipped real',
    audience: ['Council', 'Executive', 'Analyst'],
    bullets: [
      'KKU Registry (Oracle) — student enrollment, demographics, cohort distribution, TCAS round 3 funnel.',
      'KKU HR (SQL Server) — faculty member registry, rank, compensation aggregates (PDPA-suppressed at source).',
      'KKU Finance (Oracle + SQL Server) — tuition revenue + per-faculty / per-fund budget allocations.',
      'OpenAlex research output v1 — 35.7k papers, 1,045 ID-enriched FacultyMember rows.',
      'Every row carries IngestionRun provenance; per-source monitoring at /admin/data-sources/[slug].',
      'mytcas.com TCAS62–TCAS68 maxmin xlsx connector — 26.5k admission rows + funnel rollups across 7 cohorts.',
    ],
  },
  {
    date: '2026-04-24',
    version: 'v0.13.0 · Hardening',
    title: 'Security, observability, AI governance',
    audience: ['Admin', 'Analyst'],
    bullets: [
      'Security headers (CSP / HSTS / Secure cookies) enforced end-to-end.',
      'Rate limiting on AI endpoints + per-user daily USD budget.',
      'Model fallback: primary → secondary on transient errors (Gemini ↔ Claude).',
      'AI output guardrails: citizen IDs, phone numbers, personal emails redacted from responses.',
      'New pages: /admin/system-status · /admin/data-quality · /admin/ai-cost.',
      'Structured logging (pino) across api + ingestion.',
      'Backup + disaster-recovery drill documented; pre-deploy Postgres snapshots on every migration.',
      'AI evaluation suite (25 gold questions; expanding to 50 for launch).',
      'PDPA posture + DSAR workflow documented.',
    ],
  },
  {
    date: '2026-04-24',
    version: 'v0.12.1 · Program management (bonus)',
    title: 'Admin CRUD + create-from-PDF wizard + Gemini extractor',
    audience: ['Admin', 'Analyst', 'Executive'],
    bullets: [
      'Full admin page: /admin/programs — list, create, edit, attach/detach PDFs.',
      'New-from-PDF wizard reads มคอ.2 with Gemini 3 Flash Preview — restores Thai tone marks even when pdfjs drops them.',
      'Duplicate-program detection (hard code match + soft name/degree match).',
      'Thai filename UTF-8 fix + one-click backfill for pre-fix rows.',
    ],
  },
  {
    date: '2026-04-23',
    version: 'v0.12.0 · Decision Workspace',
    title: 'Council decisions — full lifecycle + outcome review',
    audience: ['Council', 'Executive', 'Analyst'],
    bullets: [
      'PROPOSED → COUNCIL_REVIEWED → APPROVED → IN_IMPLEMENTATION → COMPLETED lifecycle.',
      'Snapshot of portfolio state captured at Council review — immutable.',
      'Automatic outcome-review horizons at 6mo / 1yr / 3yr — compare actual vs projected.',
      '3 new Council Pack PDF templates: quarterly review, annual strategic review, faculty-level review.',
    ],
  },
  {
    date: '2026-04-23',
    version: 'v0.11.0 · AI Analyst',
    title: 'Tool-use conversational agent',
    audience: ['Council', 'Executive', 'Analyst'],
    bullets: [
      '12 tools wrapping modules 5-10 compute helpers.',
      '7 pre-built Council briefs (state-of-portfolio, programs-at-risk, demographic-stress, etc.).',
      'Rule-based safety gate refuses personal info / salary asks / decision commitments / prompt injection.',
      'Bilingual — mirrors the user\'s language (Thai or English).',
    ],
  },
  {
    date: '2026-04-23',
    version: 'v0.10.0 · Benchmarking',
    title: 'Peer comparison + white-space detection',
    audience: ['Executive', 'Analyst'],
    bullets: [
      '3 seeded peer sets: Thai Top-10, ASEAN Top-20, Global Subject Leaders.',
      'White-space detection: skills peers teach we don\'t.',
      'Distinctiveness score per KKU program.',
    ],
  },
];

export default async function ChangelogPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="What's new"
        subtitle="Feature additions and fixes visible to users. Tagged by audience — filter mentally by whether it's relevant to your role."
      />
      <div className="flex flex-col gap-4">
        {ENTRIES.map((entry) => (
          <Card key={entry.version}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-text-tertiary">
                    {entry.date}
                  </div>
                  <h3 className="text-lg font-semibold">{entry.title}</h3>
                  <div className="text-xs text-text-secondary">{entry.version}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {entry.audience.map((a) => (
                    <span
                      key={a}
                      className="rounded-sm border border-border-subtle bg-surface-1 px-1.5 py-0.5 text-xs text-text-secondary"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {entry.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        ))}
      </div>
    </AuthedAppShell>
  );
}
