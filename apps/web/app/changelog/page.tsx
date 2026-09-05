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
    date: '2026-09-05',
    version: 'v1.8.9 · The programme PDF works, and now contains the whole page',
    title:
      'PDF export had never succeeded on the production server; the underlying cause is fixed, and three analyses that appear on the programme page but were missing from the PDF have been added',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'PDF generation works on the production server. It had never worked there — not the programme deep-dive export, and not Council Packs, programme briefs, scenario packs or the gap report, all of which are produced by the same service. The browser that renders every PDF could not start because it had nowhere to write, so each attempt returned an error.',
      'The error message named the wrong component, which is why this went unnoticed and then took a while to place. The rendering service reported a failure in one subsystem while the actual fault — a missing writable directory — was reported only on the first attempt after a restart, and was overwritten by the misleading message on every attempt after that. The fix was verified by reproducing the production configuration exactly, then confirming Thai text still renders in the correct font with the server\'s security restrictions left fully in place.',
      'When a PDF export does fail in future, the page now says which stage failed and why, instead of returning an unexplained error. Previously a rendering timeout, a data problem and an unreachable file store were indistinguishable from one another.',
      'Digital competency is now in the programme PDF. The section was on the programme page but had never been part of the report. It reports the mean score, the pass rate against KKU\'s own pass mark, per-module results against the university average, and the weakest modules.',
      'That section states which of four situations applies rather than showing an empty box. A master\'s programme shows nothing at all, because the assessment is an undergraduate instrument; a programme with fewer than the reporting minimum of tested students has its count reported and its score withheld — saying a programme with four tested students has never been tested would be false.',
      'The health score now shows what it is being compared with. The PDF previously gave a bare score per dimension, so a reader could not tell a score that leads its faculty from one that trails it. Each dimension now sits beside its faculty mean and the university mean, with the number of programmes behind each: a faculty mean over three programmes and one over forty are different claims.',
      'Curriculum-revision advice is now in the PDF, the analysis introduced in v1.8.5. Courses to extend, proposed new courses and courses that have outgrown their category each appear with the specific papers that produced the recommendation, named in full rather than reduced to a count — anyone questioning a recommendation in committee needs to see which research it came from.',
      'Where that analysis produced nothing, the report says which of four reasons applies — too few papers, no publications recorded, or no course list held — rather than presenting an empty section that reads as "the curriculum needs no change".',
    ],
  },
  {
    date: '2026-09-05',
    version: 'v1.8.8 · Reading a long programme page without losing your place',
    title:
      'Teaching & Learning and the Programme Deep-Dive are rebuilt around a visible heading hierarchy, with a navigation rail that stays on screen as you scroll; the admin topology diagram now matches the system it describes',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'The Teaching & Learning page now distinguishes a criterion from a sub-criterion at a glance. Previously a section heading, a sub-heading and a data card all carried roughly the same weight, and the page read as one flat column of text. There are now three deliberately unequal levels: a banded criterion header with its number and coverage, sub-criteria hanging off a vertical spine, and the evidence cards themselves as the quietest layer — their figures are prominent, their frames are not.',
      'The Programme Deep-Dive uses the same layout, so the two pages read alike. Every section, figure and caveat that was there before is still there — this changes how the page is arranged, not what it reports. That was checked landmark by landmark rather than by eye, because the redesign touched all seven sections at once.',
      'Both pages carry a navigation rail listing their sections, with each section\'s headline figure beside it, so the rail doubles as a summary of the programme.',
      'That rail now stays on screen while you scroll. It had been set to stay, and did not: the column holding it was sized to exactly its own height, so it had nowhere to travel and simply scrolled away with the page. Nothing reported an error — the page looked correct in every other respect.',
      'Clicking an entry in the rail now leaves the section heading visible below the top bar instead of scrolling it behind. The same fix applies to the methodology document\'s contents list, which had the same problem and also sat partly behind the top bar itself, and to the risk table on the Risk Management page.',
      'Filter menus on Teaching & Learning, and text inputs across the platform, are back to full height. They had been rendering about half size, or taking their height from padding alone, because of a spacing rule that silently produced nothing.',
      'For administrators: the application topology diagram now reflects the current system. It was missing the data-quality integration and its flow through to the dashboards that read it, twelve AI analyses, the programme-revision record, and the Teaching & Learning page itself; ten AI analyses were shown at versions that no longer exist. A test now fails the build if a version drawn on the diagram is not one the platform actually runs, so the diagram cannot quietly drift again.',
      'For administrators: the data-source console no longer counts two retired publication feeds as live. OpenAlex and Scopus were superseded in May by the internal KKU publications mirror, but were relabelled "active" every time the database was seeded, so the console reported more live feeds than exist. They are now shown as superseded and counted separately.',
    ],
  },
  {
    date: '2026-09-04',
    version: 'v1.8.7 · The running version, on screen',
    title:
      'The release you are looking at is now named in the sidebar, and three deployment scripts that referenced files the release bundle does not contain are fixed',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'The release version now sits at the right-hand end of the copyright line in the bottom-left panel — so anyone looking at a screen, or a screenshot in a support thread, can say which release it is. It comes from the same value that pins the running container images, so the label cannot drift from what is actually deployed.',
      'A deploy no longer prints "The RELEASE_VERSION variable is not set" while taking its pre-deploy database snapshot. Harmless in itself — the snapshot was always correct — but the warning appeared at the most safety-critical moment of a deploy, where noise is exactly what you do not want. The nightly backup was printing it too.',
      'Three disaster-recovery scripts — the MinIO mirror check, the MinIO verification, and the restore drill — looked for a compose file under a name the release bundle does not use. On a deployed server they failed outright rather than warning, so the failure would only have surfaced at the moment they were needed. They now find the file in both a deployed release and a development checkout.',
    ],
  },
  {
    date: '2026-09-03',
    version: 'v1.8.6 · Submitting a curriculum, and revisions that actually refresh',
    title:
      'One place to submit a มคอ.2 — whether the programme is new or being revised — and a revised curriculum now refreshes the analyses that read it, instead of keeping the previous document\'s conclusions',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'One entry point for submitting a curriculum file. Program management previously showed three buttons that all created a programme and led to two different pages, with nothing indicating that two of them were identical. There is now a single "Submit curriculum file" action, reachable from the programme list and from its own tile in the admin console.',
      'Revising an existing programme has an entry point for the first time. It was always possible — find the programme, open it, use the Files tab, then run the pipeline — but nothing in the interface named it as an operation, so it was effectively undiscoverable. The submission page now asks up front whether the file is a new programme or a revision, and offers a search to pick the programme being revised.',
      'That question is asked rather than inferred, deliberately. A revised มคอ.2 normally carries a new code because the curriculum year changes, so duplicate detection cannot recognise it as a revision — it would have shown a green "no duplicates, safe to create" panel and led to a second copy of a programme that already exists. Asking removes that failure rather than mitigating it.',
      'Attaching a revision keeps the file it replaces. The superseded document is retained as a previous version, and the programme shows a notice that its analysis still reflects the older file until the pipeline has re-read the new one.',
      'A revised curriculum now refreshes every analysis that reads it. The programme digest, staff list, skills, teaching-methods assessment, research-expertise analysis and curriculum-revision advice each used to run once and then skip forever, regardless of which document produced them. A programme could therefore present a พ.ศ. 2570 curriculum beside advice derived from its 2565 document, with nothing on the page indicating the mismatch. Each of those now regenerates when — and only when — the curriculum has actually changed.',
      'Programmes whose curriculum has not changed are untouched and cost nothing extra to re-run. That was checked across all 301 programmes rather than sampled, because the alternative reading of "no recorded curriculum version" would have re-analysed the entire portfolio on every run.',
      'Submitting a programme now starts its analysis. The upload-based creation page had never triggered the pipeline at all, so a programme created there received its header details and no analysis until somebody noticed and started it by hand.',
      'Creating a programme with no curriculum file is no longer offered. Every analysis reads the มคอ.2, so a programme without one was permanently unanalysable while appearing complete in every list. The 21 existing programmes that have no curriculum file are unaffected and remain visible through the pipeline view, which is where they can be given one.',
      'Primary buttons across the whole platform now show their intended background colour. They had been rendering as plain text: the style referred to a colour token that was never generated, so the fill silently applied nothing and no error was raised anywhere. This changes how buttons look on many pages — nothing about what they do changes.',
      'Smaller fixes: "Higher Grad. Diploma" can be chosen again when submitting a file — the option was missing from the list, so those programmes showed a blank level; a newly created programme no longer reports that a revised file was attached when it has no previous file; and the breadcrumb on the submission page now matches the page\'s own title.',
    ],
  },
  {
    date: '2026-09-02',
    version: 'v1.8.5 · Curriculum revision — turning research strength into course-level advice',
    title:
      'A new Program Deep-Dive section that says which named course to extend and with what, which course a programme is missing, and which elective has earned promotion to required — each anchored to a real course and the papers behind it',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'New "Curriculum revision" section on each programme\'s deep-dive page. It reports where a programme\'s own research strength is not yet reflected in its courses, and proposes what to do about it.',
      'Four kinds of advice: a coverage summary (how many research themes the curriculum already reflects, and which are absent entirely); enhancements to named existing courses; proposals for courses the programme does not have; and electives that merit promotion to required.',
      'Each enhancement names a real course code, quotes that course\'s own คำอธิบายรายวิชา so a reader can check the reasoning against the course\'s own words, states the concrete addition and the effort it takes, and lists the staff papers behind it.',
      'This replaces programme-level advice that named no course and cited no course content — for example "integrate structured intercultural buddy training modules into the existing study-abroad preparation curriculum", which a department head could not act on.',
      'Recommendations are checked before they are shown, not merely requested. Any course code or research theme the AI names that does not genuinely belong to that programme is discarded, as is any cited paper title or staff member that cannot be verified against the programme\'s own roster and publications. A recommendation that names a course you cannot look up is worse than no recommendation.',
      'The section will never recommend closing, retiring, merging or reducing a course. That judgement affects staff livelihoods and research volume is the wrong basis for it, so it is refused at the point of writing rather than left to editorial care.',
      'Output is proportionate to evidence. A programme whose research rests on a handful of papers gets fewer, more hedged recommendations and a lower confidence score — never a padded revision plan. Confidence uses the same scale as the research analysis above it, so the two sections can never disagree about evidence they share.',
      'It is a draft for a curriculum committee to edit, never a decision, and the section says so.',
      'The curriculum extractor now also records which หมวด each course sits under — ศึกษาทั่วไป, บังคับ, เลือก, วิทยานิพนธ์ and so on. That is what makes elective-to-required advice possible, and it is read from the curriculum document\'s own section headings rather than guessed from course titles.',
      'Where a programme has no research analysis, no extracted course list, or no category data yet, the section says which input is missing and how to supply it — rather than showing an empty panel that reads as "nothing to recommend".',
      'Also in this release: the shareable link and QR code on your profile page now always start with https. The fallback that builds them from the site address was not reliably detecting that the site is served over https. Fixed at the source, and already applied on production ahead of this build.',
    ],
  },
  {
    date: '2026-08-28',
    version: 'v1.8.3 · A faculty renamed, and a tighter DQ privacy floor',
    title:
      'The College of Local Administration is now the College of Public Affairs and Policy across the whole platform, and the Student DQ dashboard now withholds a 5-student cell as well as anything smaller',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'The former "College of Local Administration" (COLA) is renamed "College of Public Affairs and Policy" (COPA) — วิทยาลัยการปกครองท้องถิ่น → วิทยาลัยนโยบายและกิจการสาธารณะ — everywhere the platform shows it: dashboards, the health score, exports, and the faculty picker.',
      'The rename touches display only, not the underlying record — the same faculty, its 3 departments, 26 programmes, and its HR staffing link are unchanged and unaffected.',
      'Student DQ\'s small-cell floor is tightened from "fewer than 5 scored students withheld" to "5 or fewer withheld" — a programme or faculty with exactly 5 scored students previously showed a score; it is now withheld like anything smaller. One programme in the current dataset is affected by the change.',
    ],
  },
  {
    date: '2026-08-26',
    version: 'v1.8.2 · Teaching & Learning analysis (AUN-QA), and a display-wide sizing fix',
    title:
      'A new Teaching & Learning section organises what the platform already knows about each programme along the AUN-QA v4 criteria — reporting how much evidence is on file, not a quality rating — with an on-demand AI draft of each criterion’s self-assessment paragraph. Separately, icons and spacing across the whole platform now render at their intended size',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'New "Teaching & Learning" section: a faculty readiness overview and a per-programme analysis, both organised along the AUN-QA v4 accreditation criteria.',
      'The platform reports evidence completeness, never a quality rating — for example "14 of 21 sub-criteria evidenced". It does not award an AUN-QA 1–7 score; that judgement belongs to accreditation assessors. "No evidence yet" means the platform cannot yet show that programme’s evidence for a sub-criterion, not that the programme teaches badly.',
      'Six of the eight AUN-QA criteria have data behind them today. Criteria 6 (Student Support Services) and 7 (Facilities & Infrastructure) have none, and are named on the page rather than hidden, so a reader is not misled that six criteria are all there are.',
      'On demand, an AI drafts a short self-assessment paragraph for a chosen criterion from the evidence actually on file. It is labelled a draft to edit, not a submission, and it states plainly what it could not evidence rather than padding the paragraph with generic curriculum language.',
      'Across all 301 programmes at university scope: 273 are well-evidenced, 28 partly evidenced, none with no evidence at all.',
      'The Teaching and Learning Approach criterion (3), which had evidence for only 13 programmes, is restored: a schema bug had rejected the short method-name acronyms real disciplines use — PBL, OSCE, EBM — which had excluded most medical and science programmes from that assessment. With the bug fixed, the assessment now covers 277 programmes. Three programmes failed on a transient upstream error and will be picked up on the next run.',
      'Teaching & Learning sits under Analysis in the menu, beside Program Deep-Dive, rather than under Dashboards — it is an analytical surface rather than a dashboard.',
      'Icons across the whole platform now render at the size they were designed for. A gap in the design system meant the shared sizing scale was half its intended values, so most icons had been drawing at half size — a 16-pixel icon at 8 — while one common size drew at 24 because its rule was missing entirely and browsers fell back to the image’s own dimensions. 433 icons are corrected.',
      'The same gap left several spacing values producing no effect at all, which is why small labelled tags sat flush against one another with no padding or separation. Those now space correctly everywhere they appear, and two places whose layout had been tuned around the old half-size icons — the search boxes and an admin tile — are corrected to match.',
      'Six chart surfaces (risk views, class-GPA distributions, the international and Thailand maps, and the style guide) had colours written as fixed values rather than theme colours, so they rendered identically in dark mode. They now follow the theme. Two related display faults surfaced and were fixed in the process: severity count chips on the risk-indicators page had been drawing with no background or border at all, and both maps were passing colour in a way the browser ignored.',
      'Close buttons on dialogs and side panels are enlarged to meet the 24-pixel minimum target size in the accessibility guidelines.',
    ],
  },
  {
    date: '2026-08-25',
    version: 'v1.8.1 · Student DQ, and digital competency in program health',
    title:
      'A new dashboard drills every undergraduate’s Digital Intelligence competency-test results from faculty down to programme, and that result now counts towards the programme’s health score — anchored on the pass mark, so 50 means the average student just passes',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'New "Student DQ" dashboard (Education → Student DQ): 24,777 students in the export, 19,601 of them carrying module scores. Faculty → programme drill-down across 13 theory modules and 4 workshops, pass mark 70 on every module, plus a module-by-module radar for any faculty or programme.',
      'Module 13 (Generative AI) is new and its rollout is still catching up — only 57% of scored students have taken it, averaging 67.6. A score of 0 means "not taken", so zeros are excluded from every average; counting them would have shown the module near 40 and read as a competency crisis that is really an incomplete rollout.',
      'About 40% of tested students are past cohorts or the newest intake who cannot yet be matched to a current programme. They are shown under "Program not identified" rather than dropped, so faculty totals still cover everyone who was tested.',
      'Figures are withheld for any faculty or programme with fewer than 5 scored students, so no individual’s result can be inferred from a small cell.',
      'The pass/fail flag shown is the test provider’s own, and it does not apply one consistent rule to module 13: 164 students who clear 70 on every module 1–12 but score below 70 on module 13 are marked failed, while 3,183 with the same profile are marked passed. The dashboard reports that verdict as given and states the discrepancy rather than recomputing its own pass/fail rule.',
      'No student names or ID numbers are stored — the source export carries them, but the connector aggregates in memory and only the aggregates are written to the database.',
      'The DQ result now also contributes to program health, as one driver inside the Outcomes dimension. 81 bachelor programmes have enough DQ evidence to receive it; a programme with too little is left without the driver rather than scored zero, because having no evidence is not the same as scoring badly.',
      'Graduate programmes are excluded from DQ everywhere. It is an undergraduate test: the 30 graduate programmes that appeared to have DQ data held 10 students between them — all undergraduates who sat the test and later enrolled in a master’s. Those students now appear under their faculty’s "Program not identified" row, which is what they are; the dashboard’s totals are unchanged.',
      'The health contribution is anchored on KKU’s own pass mark rather than on the spread of this year’s results: 50 means the average student just passes, 100 means an average of 90 or better. That makes the number readable instead of an arbitrary index, and it does not move one programme’s score when a different programme’s data changes.',
      'What moved: 81 programmes’ Outcomes scores changed, by a median of +3.2 points and at most +13.4; three fell slightly, where the programme’s other outcome measures already scored above its DQ result. Composite health scores moved by at most 2.7 points. Nothing else in the score changed — the five dimensions and their weights are the same.',
      'The programme page gains a "Digital competency" section showing the programme’s result against the university, module by module, with the number of scored students beside it. It shows nothing at all for a graduate programme.',
      'The gap analyzer gains a digital-competency attainment lens — how well students perform on skills they have been taught, alongside the existing view of which skills are taught at all. It changes no existing gap figure. Worth stating plainly: 5 of the 13 DQ competencies have no counterpart in the skill taxonomy, which is built from curriculum documents rather than from the test, and the lens shows those five as unmapped instead of implying the curriculum covers them.',
      'The published methodology paper (Docs → Methodology, Thai and English) is reissued for health-score.v4.0 and now also records v3.9, the change that moved financial scoring onto the last complete academic year.',
    ],
  },
  {
    date: '2026-08-24',
    version: 'v1.8.0 · Teaching and learning talent',
    title:
      'A new Staff dashboard identifies instructors students rate highly year after year — and, unlike the evaluation dashboard, it covers every evaluated instructor rather than only those whose courses are mapped to a curriculum',
    audience: ['Executive', 'Analyst', 'Admin'],
    bullets: [
      'New "Teaching and learning talent" dashboard (Staff → Teaching and learning talent): drill from faculty to individual staff, showing each person’s overall student-evaluation score, how many evaluation responses sit behind each score (individual answers to survey questions, not a headcount of students), and their score in each of the last three completed academic years.',
      'A talent is someone who scored at or above the chosen bar in EVERY one of those three years — sustained quality, not one good semester. Someone with only two years of evidence is shown with their years and marked "2/3 years", never badged, so a new arrival is never mistaken for an underperformer.',
      'The bar is adjustable (4.00, 4.25, 4.50, 4.75) because Thai evaluation scores cluster high: at 4.00 the list runs to 1,244 people, at 4.25 to 1,082, at 4.50 to 601, at 4.75 to 145. The filter, the bar and the talents-only toggle all live in the page address, so a particular view can be shared as a link.',
      'This dashboard counts every evaluated instructor — 1,695 of them — where Teaching evaluations shows only the 1,130 whose courses are mapped to a program. A third of the teaching roster was invisible to that view; it is not invisible here.',
      'Export to Excel: the qualifying staff with faculty, academic rank, first and last name, email and overall score, ready for HR, awards and development programmes.',
      'The page reports its own coverage rather than hiding it: 271 teachers were evaluated but match no HR record (98 of whom would qualify), and a further body of evaluation rows is credited to no identifiable person. They are listed as a reconciliation worklist on the page and in the export, so the gap can be fixed at source.',
      'All semesters count, including summer and special terms, and every score is weighted by how many responses it rests on.',
    ],
  },
  {
    date: '2026-08-17',
    version: 'v1.7.0 · Rebuilt program report, research expertise, honest financial scores',
    title:
      'The program deep-dive PDF is rebuilt as a chart-led A4 report; a new Research Expertise section analyses each program’s decade of publications; financial scores now use the last complete academic year — most rose, and every AI analysis now writes in English with an honest confidence number',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'The "Export PDF" on every program page now produces a redesigned A4 report: charts lead each section, every exact figure moves to a data appendix (nothing is lost — it only moves), every chart carries its source, data date and methodology, and the course list — assembled but never printed by the old report — finally appears.',
      'New "Research expertise" section on the program page and in the PDF: the last 10 years of the teaching roster’s publications, deduplicated and analysed into named research themes with verbatim example paper titles, plus recommended actions for curriculum, positioning and research strategy. Programs without a curated roster or with too few papers say so plainly instead of showing an empty box.',
      'Financial scores are now computed on the last COMPLETE academic year. Tuition for the current year is still being billed (semester 1 lands in one fiscal year, later semesters in the next), so scoring on it understated most programs — 147 of 263 financial scores rose when the half-billed year was excluded, and 3 brand-new programs correctly show "no data" instead of a score built on half a semester.',
      'A month-long data-visibility fault was found and fixed: five real data connectors were still flagged as mock data, which silently hid all enrollment, financial and research rows from every score. An automated audit now runs in CI so this class of fault cannot recur silently.',
      'Several wrong numbers were corrected: cohort GROWTH was displayed as flat 0.0% (and in one place as a double negative); an alumni share could display as "1230.0%" instead of 12.3%; a measured cost of 0 displayed as "no data"; the health radar no longer clips its labels or overlaps the scale.',
      'AI analyses (strategic narrative, insights panels, research expertise) now write in English, follow a written prompt standard with a banned-phrase list, and report confidence honestly: the number is capped by how much data was actually available, so a sparse program can no longer show 95% confidence. Thai program names, recruitment copy and data labels are unchanged.',
      'For analysts: every chart in the new PDF states its provenance; theme paper-counts refer only to the papers actually analysed (stated on the page); AI outputs that fail format or use banned phrasing are automatically retried once and flagged if they persist.',
      'For operators: `pnpm data-sources:audit` (drift detection + repair), `pnpm narratives:regenerate`, `pnpm expertise:generate`, and a new research-expertise phase in the programs pipeline. One additive DB migration (program_research_expertise). No new environment variables.',
    ],
  },
  {
    date: '2026-07-27',
    version: 'v1.6.8 · Gentler connections to the registrar database',
    title:
      'Bulk data syncs against the KKU registrar now sign in once and reuse the connection, instead of opening hundreds of separate logins — preventing the registrar side from locking our database account mid-sync',
    audience: ['Admin'],
    bullets: [
      'Fixed: portfolio-wide sync jobs (student cohort and alumni linking) opened a fresh registrar database login for every program — roughly 300 logins per run, which the registrar’s security policy read as a connection storm and answered by locking the platform’s database account. Those jobs now open a single connection per run and reuse it for every program.',
      'If the connection drops mid-run, the sync reconnects once and continues; if the login itself is rejected, the job stops immediately rather than retrying — repeated failing logins are exactly what escalates into an account lock.',
      'The nightly scheduled connectors were audited and already connect frugally (two logins per run); they are unaffected.',
    ],
  },
  {
    date: '2026-07-09',
    version: 'v1.6.7 · PDF uploads with Thai filenames fixed',
    title:
      'Uploading a curriculum or trend document whose filename is in Thai no longer fails — and server errors now carry full diagnostic detail in the logs',
    audience: ['Analyst', 'Admin'],
    bullets: [
      'Fixed: uploading a new PDF with a Thai filename (for example “หลักสูตรศึกษาศาสตรบัณฑิต 2565.pdf”) failed with an internal server error. The filename is stored alongside the file in object storage, and the transport layer rejected non-Latin characters at that step. Thai (and any non-ASCII) filenames are now safely encoded before storage and work everywhere a PDF can be uploaded — program files, trend documents, and the PDF intake page.',
      'Server errors are now fully diagnosable: a logging defect had been silently discarding the error message and stack trace from every 5xx log entry, which made production issues anonymous. Log lines now carry the complete detail.',
      'For operators: the queue database (Redis) now uses the “noeviction” memory policy, so background jobs can never be silently discarded under memory pressure — writes fail loudly instead.',
    ],
  },
  {
    date: '2026-07-08',
    version: 'v1.6.6 · Programs are now managed in-app; admin-created programs are first-class',
    title:
      'The program catalogue is now maintained directly in the application — new and revised programs added through the Admin console appear on every Council surface and run through the full analysis pipeline, just like the original 297',
    audience: ['Analyst', 'Admin'],
    bullets: [
      'The master spreadsheet that bootstrapped the 297-program catalogue has served its purpose and is now detached. From this release onward, new programs and curriculum revisions are added and updated in the Admin console (Admin → Programs), including uploading the curriculum PDF, which is read by the AI and turned into the program’s structured profile automatically.',
      'Programs created through the Admin console are now first-class: they receive a catalogue sequence number automatically, appear on all Council-facing views (cockpit, portfolio, deep-dive), and can run the full analysis pipeline. Previously an admin-created program was invisible to those views and the pipeline refused to run on it.',
      'Fixed an issue where re-running the development seed quietly re-created 30 retired sample programs (and ~210 sample courses) from the platform’s earliest build. They are removed again and can no longer return — in line with the platform’s no-mock-data policy.',
      'For operators: manually queued connector runs no longer fail when the trigger reference isn’t a known user account — the run is recorded without one instead.',
    ],
  },
  {
    date: '2026-06-28',
    version: 'v1.6.5 · Trends Radar now shows real signals, plus a way to remove any signal',
    title:
      'The Trends Radar is now fed by real external sources and a new live monitor of KKU’s own research output, mock signals have been removed, and analysts/admins can remove any signal directly from the radar',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'The radar now carries real signals only. Nine external sources — the World Bank and eight curated policy/economic report sources (MHESI, NESDC, NXPO, BOI, EECO, WEF Future of Jobs, OECD, ADB Greater Mekong) — were switched from sample data to live, and the previous sample/mock signals were cleared out. Document links were refreshed so the “view source” links work.',
      'New live research monitor: the radar now surfaces KKU’s own research momentum. When a faculty’s high-quartile (Scopus Q1) publication output rises notably year over year, the radar shows a signal for it — for example, a faculty whose Q1 output climbed from one year to the next. These are faculty-level trends drawn from KKU’s publications data, refreshed automatically.',
      'Analysts and admins can now remove any signal directly on the Trends Radar (two-step confirm). Previously only signals created from an uploaded document could be removed. A note explains that signals sourced from automated connectors may reappear on the next scheduled run, while document- and seed-sourced ones stay removed.',
      'Some planned monitors (job-market, peer programs, technology, patents) remain intentionally empty until a real data source for each is available — the platform shows nothing rather than fabricated signals, in line with its no-mock-data policy.',
    ],
  },
  {
    date: '2026-06-28',
    version: 'v1.6.4 · Academic-year rollover is now correct and configurable',
    title:
      'When a new academic year begins, the previous year’s intake is now correctly treated as complete across recruitment, the program funnel and risk — and an admin can set exactly when the year rolls over',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'The platform now rolls the academic year over when the year actually starts (around June), not on 1 January. Previously, once an academic year had begun its intake still showed as “in progress” until the following January — so the most recently completed admission year was understated by one year. Now, when academic year 2569 starts, 2569 counts as a completed intake year and 2570 is shown as the one still recruiting. This corrects the “Entry year” filter on Recruitment Campaigns, the Recruitment funnel on each program page, and every risk and health figure that depends on the latest completed intake.',
      'New “Academic year” page in the Admin console: set the date the next academic year begins. The platform derives the current/completed/in-progress years from it, and shows a reminder once that date has passed so it can be advanced for the new year. This replaces logic that was previously fixed in code.',
      'For operators: the next deployment no longer needs the manual object-storage ownership and credential steps that the v1.6.3 upgrade required — that fix now travels inside the release.',
    ],
  },
  {
    date: '2026-06-28',
    version: 'v1.6.3 · Manage trend-document sources; hardened object storage',
    title:
      'Redesigned upload for adding trend signals from documents, a way to review and remove the source documents behind Trends Radar signals, and a maintained, security-hardened object-storage service',
    audience: ['Admin', 'Analyst'],
    bullets: [
      'Adding a trend signal from a document is easier to use: a drag-and-drop upload panel with clear idle / dragging / uploading states and chips for the accepted formats (PDF, Word, Excel, PowerPoint, HTML, CSV, text), alongside the existing paste-a-link option.',
      'New “Source documents & links” list on the Trend Documents admin page shows the documents and URLs that signals were created from. Each one has a two-step-confirm Remove that takes the resulting signal off the Trends Radar — it deletes the published signal, clears its inbox notifications, and removes the stored file — with a success confirmation. The list now shows up to 100 sources.',
      'Object storage (which keeps original PDFs, generated Council Pack and brief documents, and profile photos) now runs on a maintained, near-zero-known-vulnerability build, replacing the previous community image that the upstream project stopped publishing and has since retired. Stored files are unaffected and the change is invisible to everyday users — it only reduces the security and maintenance risk of running an unsupported component.',
      'For operators: the storage service now runs as a non-root user, and the deployment process automatically adjusts file ownership on the existing data store the first time the new build starts. The release bundle now also carries the storage, web-proxy and cache images so an offline production server needs no internet access during deployment.',
    ],
  },
  {
    date: '2026-06-18',
    version:
      'v1.6.2 · Office & web documents on the Trends Radar; benchmarking AI-readiness now matches the program page',
    title:
      'Add a trend signal from a Word, Excel, PowerPoint, HTML or CSV file — not just PDF — and read a benchmarking write-up that cites the same AI-readiness score as the program page, with a redesigned content-gaps panel focused on what peers do that the program could adopt',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'Adding a signal from a document now accepts Office and web formats, not just PDF. Upload a Word document, Excel workbook, PowerPoint deck, HTML page, CSV or text file (or paste a link) and the system converts it to clean text before the AI reads it — so manpower-demand reports, spreadsheets and slide decks become trend signals as easily as PDFs did. If a document can’t be converted it falls back to the previous extraction, so nothing is lost.',
      'On a program’s Competitive Benchmarking page, the AI write-up now uses the same AI-readiness score shown on the program’s own page. Previously the narrative could cite a contradictory curriculum sub-score (for example “0/100 AI integration”) next to a higher overall score, which was confusing; the review now anchors on the single authoritative, discipline-aware figure and describes curriculum AI content in words rather than a competing number. Newly processed programs also keep the two views in step.',
      'The “Content gaps vs peer curricula” panel on the per-program benchmarking view is redesigned to highlight what leading peer institutions actually do that the program could adopt: each gap is ranked by how material it is, with the peer practice called out as the actionable insight and a clear “move to adopt” next step.',
    ],
  },
  {
    date: '2026-06-11',
    version:
      'v1.6.1 · Add signals from documents; job candidates & new-initiative ideas on the Trends Radar',
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
      "The whole recruitment layer moves to the registrar's campaign-grain admission feed — a richer superset of the old curriculum-level data — plus a new actual-recruitment dashboard",
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      "New dashboard /education/recruitment-campaigns at the campaign-track grain — one row per recruitment track (competency / language / exam option / quota type / branch-campus intake) within a program × round × year. Recruitment funnel, year-over-year demand, by-TCAS-round breakdown, and a Faculty → program → sub-program → TCAS round → track drill-down with sortable headers and hover tooltips that show each cell's value, formula, and worked calculation.",
      "Drill-down adds % Enrol yield (Enrolled ÷ Passed) alongside % Admit; the TCAS-round tier always reads top-to-bottom by round number regardless of the reader's column sort.",
      "Recruitment data source migrated from POWERBI.ADMISSION_STAT_CURRID (curriculum grain) to POWERBI.ADMISSION_STAT (campaign grain) across the whole application — health scoring (Attractiveness), lifecycle verdict, the Health radar, the Program Deep-Dive recruitment funnel + demand funnel + demographic outlook, recruitment-vs-plan, and the Risk module's L1 recruitment-decay driver + competitiveness percentile now all read the new feed.",
      "Plan quota is now counted correctly per intake (sum of each recruitment program's annual plan), fixing a prior undercount where majors that share one curriculum code collapsed onto a single quota.",
      'Methodology versions bumped: health-score.v3.8, risk-scoring.v1.12, program-recruitment.v2, recruitment-rollup.v2. Drivers, formulas, and weights are unchanged — only the underlying source moved. The public Methodology paper (/docs/methodology) is updated to match.',
      'The old TCAS-funnel connector (ADMISSION_STAT_CURRID) is deprecated; the admin Dashboard data-fetch and Application-topology surfaces now point at the new connector.',
    ],
  },
  {
    date: '2026-05-20',
    version: 'v1.4.0 · Research quartiles + recruitment round analysis',
    title:
      'Scopus journal-quartile tiers on research; TCAS-round analysis + national demographic outlook on the deep-dive',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'Scopus journal quartile (Q1–Q4) and a Top-10% (Tier 1) tier added to research outputs and the /staff/research dashboard — quartile-led redesign with a year-range slider.',
      'TCAS-round analysis added to the recruitment dashboard.',
      'Program Deep-Dive demographic outlook is now national- and funnel-aware; University + Faculty averages overlaid on the Health radar for context.',
      'Risk L3 demographic-ceiling driver gains a forward demographic projection (risk-scoring.v1.11).',
      'program-digest.v2 — generalised, English-keyed skill extraction from curriculum PDFs.',
      'Sortable column headers across Education + Staff dashboard tables; a global navigation progress bar for slow transitions; the per-teacher deep dive becomes a Faculty → Program → Teacher drill-down.',
      "Class-GPA + student-satisfaction dashboards scoped to the user's program for PROGRAM_USER.",
    ],
  },
  {
    date: '2026-05-19',
    version: 'v1.3.0 · Student evaluations + class GPA + teaching',
    title:
      'Course-evaluation + class-GPA dashboards; risk breaches now auto-propose a mitigation measure',
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
      "dash_compute v2 — adds 4 new ops: `rank_bottom` (worst/lowest), `min`, `max`, `year_over_year` (Δ + %Δ per period + total CAGR). Plus a new `sanityMin` parameter (mirror of sanityMax — catches negative GPAs, sub-1900 years, etc.). System prompt v1.4 spells out the bottom-N and trend patterns explicitly so the LLM doesn't fall back to head-math.",
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
      "System prompt (analyst-dashboard-system.v1.2) enumerates every tool's views + spells out the drill-down playbook: dash_filter_options first → overview → drill into a specific row.",
      'Separate conversation history per surface — strategic Council conversations stay in /analyst, operational dashboard conversations stay in /analyst/dashboards. New AnalystConversation.kind column (STRATEGIC | DASHBOARD) with a (user, kind, updated_at) index for the list query.',
      "New dash_filter_options tool the bot calls first when it needs an exact Thai faculty / program name — prevents the model from inventing labels that won't match the cube's WHERE clause.",
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
    title:
      'Two new dashboards on registrar class-offerings; teaching summary on every profile; program-user access across Education + Staff',
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
      "Risk Management drivers chart's automation-risk panel now shows only skills taught by programs in scope (was the global skill taxonomy regardless of scope). Indicator histograms + severity counts clamp consistently with the breach list.",
      "Top-bar scope dropdown removed — scope is now entirely role-driven from the session, so the dropdown wasn't the source of truth for any module's data fetch. The command-palette search trigger now fills the row.",
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
      "Research connector pivoted from OpenAlex + Scopus public APIs to KKU Library's internal publications warehouse (kkuscholar).",
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
      "Bilingual — mirrors the user's language (Thai or English).",
    ],
  },
  {
    date: '2026-04-23',
    version: 'v0.10.0 · Benchmarking',
    title: 'Peer comparison + white-space detection',
    audience: ['Executive', 'Analyst'],
    bullets: [
      '3 seeded peer sets: Thai Top-10, ASEAN Top-20, Global Subject Leaders.',
      "White-space detection: skills peers teach we don't.",
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
