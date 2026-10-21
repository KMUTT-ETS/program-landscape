import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import {
  Badge,
  Button,
  Card,
  EdgeGlow,
  FreshnessBadge,
  PageHeader,
  Section,
} from '@kku/ui';
import {
  Banknote,
  BookText,
  Database,
  ExternalLink,
  FileSearch,
  FileText,
  Globe,
  GraduationCap,
  HelpCircle,
  TrendingUp,
  Upload,
  UserSquare2,
} from 'lucide-react';
import { ProgramsPipelineLauncher } from './programs-pipeline-launcher';

// Admin landing page — the operational hub for "feed the AI everything
// it needs to analyse the curriculum landscape". Every input category
// the analyst is responsible for is one card on this page, with
// current state + a link to its detail/upload flow.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Data setup — Admin' };

interface DataSetupStats {
  programs: { total: number; withCurriculumPdf: number; missingCurriculumPdf: number };
  curriculumDocs: { total: number };
  externalDocs: {
    policy: number;
    report: number;
    survey: number;
    peerProgram: number;
    committeeMinutes: number;
    jobPostingsBatch: number;
    other: number;
    total: number;
  };
  facultyStaff: { total: number; active: number };
  studentInfo: {
    enrollmentMetricRows: number;
    programsWithEnrollment: number;
    programsWithoutEnrollment: number;
  };
  financial: {
    programMetrics: number;
    programsWithFinancial: number;
    programsWithoutFinancial: number;
    facultyBudgetRows: number;
  };
  dataFeeds: { total: number; live: number; mocked: number };
  laborMarketSkills: {
    kmitlCareers: number;
    kmitlSkillDemandRows: number;
    kmitlSkillGrowthRows: number;
  };
  researchOutputs: {
    total: number;
    matchedToFaculty: number;
    unmatched: number;
    facultyMembersWithExternalIds: number;
  };
}

/** One row of GET /admin/imports — mirrors `ImportDatasetSummary` in the api. */
interface ImportDatasetSummary {
  slug: string;
  title: string;
  description: string;
  tier: 0 | 1 | 2;
  rowCount: number;
  lastUpload: string | null;
  batchCount: number;
}

// The registry's tiers, in load order. Each tier refers to the one above.
const IMPORT_TIERS: readonly { tier: 0 | 1 | 2; step: number; title: string; hint: string }[] = [
  {
    tier: 0,
    step: 1,
    title: 'Organisation backbone',
    hint: 'Faculties, departments and programmes. Every other dataset refers to these codes.',
  },
  {
    tier: 1,
    step: 2,
    title: 'Core programme metrics',
    hint: 'Enrolment, finance and graduate outcomes — one row per programme per year.',
  },
  {
    tier: 2,
    step: 3,
    title: 'Students, staff, research and teaching',
    hint: 'The remaining Deep-Dive inputs: cohorts, admissions, staff, budgets, publications and class offerings.',
  },
];

const EMPTY_STATS: DataSetupStats = {
  programs: { total: 0, withCurriculumPdf: 0, missingCurriculumPdf: 0 },
  curriculumDocs: { total: 0 },
  externalDocs: { policy: 0, report: 0, survey: 0, peerProgram: 0, committeeMinutes: 0, jobPostingsBatch: 0, other: 0, total: 0 },
  facultyStaff: { total: 0, active: 0 },
  studentInfo: { enrollmentMetricRows: 0, programsWithEnrollment: 0, programsWithoutEnrollment: 0 },
  financial: { programMetrics: 0, programsWithFinancial: 0, programsWithoutFinancial: 0, facultyBudgetRows: 0 },
  dataFeeds: { total: 0, live: 0, mocked: 0 },
  laborMarketSkills: { kmitlCareers: 0, kmitlSkillDemandRows: 0, kmitlSkillGrowthRows: 0 },
  researchOutputs: { total: 0, matchedToFaculty: 0, unmatched: 0, facultyMembersWithExternalIds: 0 },
};

export default async function AdminDataSetupPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  // Stats fetch — when it fails we render a diagnostic banner above the
  // cards. The cards still draw with zeros so the operator can navigate
  // into sub-areas (most cards have static text + a "manage" link that
  // doesn't depend on the numbers).
  const statsRes = await apiFetchSafe<DataSetupStats>('/admin/data-setup/stats');
  const stats = statsRes.ok ? statsRes.data : EMPTY_STATS;
  const importsRes = await apiFetchSafe<ImportDatasetSummary[]>('/admin/imports');

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="Data setup" />
      <PageHeader
        eyebrow="Admin · Data setup"
        title="Feed the system"
        subtitle="Every category of input the AI analytics depends on. Upload, organise, and review the data that drives the curriculum-landscape views — from international policy docs through to per-program tuition."
        actions={
          <EdgeGlow inline>
            <Button variant="primary" asChild>
              <Link href="/upload">
                <Upload className="size-icon-md" aria-hidden />
                Upload documents
              </Link>
            </Button>
          </EdgeGlow>
        }
      />

      {!statsRes.ok && (
        <div className="mb-4">
          <DiagnosticEmptyState surface="data-setup stats" error={statsRes.error} />
        </div>
      )}

      {/* ── Institution data — every spreadsheet-importable dataset ─ */}
      {/* First, because everything below hangs off the org backbone, and on
          an installation with no registrar connector these uploads are the
          only data that exists at all. The tiles come from the import
          registry (GET /admin/imports), so a newly declared dataset appears
          here without editing this page. */}
      <Section
        title="Institution data"
        description="Everything the Program Deep-Dive reads about your own institution, importable from spreadsheets. Load the groups in order — each refers to the codes in the one before it."
      >
        {importsRes.ok ? (
          <div className="flex flex-col gap-5">
            {IMPORT_TIERS.map((tier) => {
              const datasets = importsRes.data.filter((d) => d.tier === tier.tier);
              if (datasets.length === 0) return null;
              const filled = datasets.filter((d) => d.rowCount > 0).length;
              return (
                <div key={tier.tier} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">
                        {tier.step}. {tier.title}
                      </h3>
                      <p className="text-xs text-text-tertiary">{tier.hint}</p>
                    </div>
                    <span className="text-xs text-text-tertiary">
                      {filled} of {datasets.length} loaded
                    </span>
                  </div>
                  <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {datasets.map((d) => (
                      <ImportDatasetTile key={d.slug} dataset={d} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : (
          <DiagnosticEmptyState surface="spreadsheet imports" error={importsRes.error} />
        )}
      </Section>

      {/* ── Curriculum docs ──────────────────────────────────────── */}
      <Section
        title="Curriculum documents"
        description="The มคอ.2 spec for every program at the university — the canonical input for AI analysis of program structure, courses, and skill outputs."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CategoryCard
            tone="glossy"
            icon={<GraduationCap />}
            title="Full program documents (มคอ.2)"
            description="Every active KKU program should have a current curriculum PDF linked. Programs without one can't be digested into skills, recruitment summaries, or course lists."
            primary={{
              label: `${stats.programs.withCurriculumPdf} of ${stats.programs.total} programs`,
              tone:
                stats.programs.missingCurriculumPdf === 0
                  ? 'success'
                  : stats.programs.missingCurriculumPdf < 30
                    ? 'warning'
                    : 'danger',
            }}
            secondary={[
              `${stats.curriculumDocs.total} PDF documents in curriculum library`,
              `${stats.programs.missingCurriculumPdf} programs still missing a current PDF`,
            ]}
            href="/admin/programs?view=pipeline"
            cta="Open curriculum pipeline"
            rawHref="/admin/data-setup/raw/curriculum-pdfs"
            rawCta="View raw data"
            footer={<ProgramsPipelineLauncher />}
          />

          <CategoryCard
            icon={<UserSquare2 />}
            title="Academic staff profiles"
            description="Faculty roster — drives program-deep-dive faculty composition, succession-risk views, and AI insights about teaching capacity. Auto-loaded by the kku-hr connector for mapped faculties."
            primary={{
              label: `${stats.facultyStaff.total} faculty members`,
              tone: stats.facultyStaff.total > 0 ? 'success' : 'neutral',
            }}
            secondary={[
              `${stats.facultyStaff.active} currently active`,
              `Source: kku-hr connector (live)`,
              'Also importable from a spreadsheet — see Institution data above',
            ]}
            href="/admin/data-sources/kku-hr"
            cta="View kku-hr data source"
            rawHref="/admin/data-setup/raw/faculty-members"
            rawCta="View raw data"
          />
        </div>
      </Section>

      {/* ── External documents ────────────────────────────────────── */}
      <Section
        title="External documents"
        description="World-context inputs the AI analytics reasons against — policy, surveys, sector reports, peer brochures. Upload the PDF, the system classifies + extracts."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <CategoryCard
            icon={<Globe />}
            title="International education docs"
            description="WEF Future of Jobs · Gartner Trends · OECD/UNESCO reports · global employment surveys · WCED. Tag as POLICY or REPORT on upload."
            primary={{
              label: `${stats.externalDocs.policy + stats.externalDocs.report} policy + report PDFs`,
              tone: 'neutral',
            }}
            secondary={[
              `${stats.externalDocs.policy} POLICY docs`,
              `${stats.externalDocs.report} REPORT docs`,
            ]}
            href="/upload"
            cta="Upload international docs"
          />

          <CategoryCard
            icon={<FileText />}
            title="Thailand documents"
            description="MHESI policy · NESDC plans · NSO labour-force survey · National Strategy 20-year · BCG/S-curve roadmaps. Same upload flow — tag the right category."
            primary={{
              label: `${stats.externalDocs.survey} survey docs`,
              tone: 'neutral',
            }}
            secondary={[
              `${stats.externalDocs.peerProgram} peer-program brochures`,
              `${stats.externalDocs.committeeMinutes} committee-minutes docs`,
            ]}
            href="/upload"
            cta="Upload Thailand docs"
          />

          <CategoryCard
            icon={<FileSearch />}
            title="Discipline-specific research"
            description="Whitepapers, accreditation guides, professional-body standards, anything that's relevant to one or a few programs but isn't general policy. Tag OTHER and the AI classifier routes by content."
            primary={{
              label: `${stats.externalDocs.other} OTHER-tagged docs`,
              tone: 'neutral',
            }}
            secondary={[
              `${stats.externalDocs.jobPostingsBatch} job-postings batches`,
              `Total: ${stats.externalDocs.total} external PDFs`,
            ]}
            href="/upload"
            cta="Upload discipline research"
          />
        </div>
      </Section>

      {/* ── Student & financial — auto-fed via connectors ────────── */}
      <Section
        title="Student & financial inputs"
        description="Auto-loaded by the kku-registry / kku-finance connectors. Manual edits go through the per-program admin page."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CategoryCard
            icon={<GraduationCap />}
            title="Student information"
            description="Applications, admitted, enrolled, retained, graduated-on-time, dropouts — per program × academic year. Drives competitiveness ratio + funnel views in the deep-dive."
            primary={{
              label: `${stats.studentInfo.programsWithEnrollment} of ${stats.programs.total} programs`,
              tone:
                stats.studentInfo.programsWithoutEnrollment === 0
                  ? 'success'
                  : stats.studentInfo.programsWithoutEnrollment < 50
                    ? 'warning'
                    : 'danger',
            }}
            secondary={[
              `${stats.studentInfo.enrollmentMetricRows} enrollment-metric rows total`,
              `${stats.studentInfo.programsWithoutEnrollment} programs with no enrollment data`,
              `Source: kku-registry connector (live)`,
              'Also importable from a spreadsheet — see Institution data above',
            ]}
            href="/admin/data-sources/kku-registry"
            cta="View kku-registry data source"
            rawHref="/admin/data-setup/raw/enrollment-metrics"
            rawCta="View raw data"
          />

          <CategoryCard
            icon={<Banknote />}
            title="Financial — tuition & expenses"
            description="Tuition revenue, direct cost, allocated faculty + facility cost, allocated overhead, net contribution — per program × fiscal year. Cost methodology v1.0 pending Finance Committee sign-off."
            primary={{
              label: `${stats.financial.programsWithFinancial} of ${stats.programs.total} programs`,
              tone:
                stats.financial.programsWithoutFinancial === 0
                  ? 'success'
                  : stats.financial.programsWithoutFinancial < 50
                    ? 'warning'
                    : 'danger',
            }}
            secondary={[
              `${stats.financial.programMetrics} financial-metric rows total`,
              `${stats.financial.facultyBudgetRows} faculty-budget rows`,
              `Source: kku-finance connector (live)`,
              'Revenue is also importable from a spreadsheet (Institution data above); cost columns are not',
            ]}
            href="/admin/data-sources/kku-finance"
            cta="View kku-finance data source"
            rawHref="/admin/data-setup/raw/financial-metrics"
            rawCta="View raw data"
          />
        </div>
      </Section>

      {/* ── Labour-market & research — auto-fed via connectors ──── */}
      <Section
        title="Labour-market & research signal"
        description="Demand-side and discovery-side inputs that the AI compares the curriculum against — what employers want now vs what KKU researchers are publishing."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CategoryCard
            tone="glossy"
            icon={<TrendingUp />}
            title="Labour-market skills demand (LinkedIn via MHESI)"
            description="Aggregated skill demand from LinkedIn — profiles, Thai job postings, and university graduate data. The data is owned by LinkedIn; the institutional subscription / licence is held by MHESI. KMITL hosts the API endpoint on behalf of MHESI and is not the data owner. Drives the gap-analyzer's labour-market demand source and the health-score's labour-market-alignment driver."
            primary={{
              label: `${stats.laborMarketSkills.kmitlSkillDemandRows.toLocaleString()} demand rows`,
              tone: stats.laborMarketSkills.kmitlSkillDemandRows > 0 ? 'success' : 'neutral',
            }}
            secondary={[
              `${stats.laborMarketSkills.kmitlCareers.toLocaleString()} career taxonomy entries`,
              `${stats.laborMarketSkills.kmitlSkillGrowthRows.toLocaleString()} skill-growth rows (trend signal)`,
              `Data: LinkedIn · Subscriber: MHESI · API host: KMITL · Live since 2026-05-01`,
            ]}
            href="/admin/data-sources/kmitl-skill-mapping"
            cta="View labour-market data source"
            rawHref="/admin/data-setup/raw/kmitl-skill-demands"
            rawCta="View raw data"
          />

          <CategoryCard
            icon={<BookText />}
            title="Research outputs"
            description="Publications via OpenAlex (free institutional API). Drives the deep-dive research section, benchmarking subject leadership, and faculty-member impact views. Scopus enrichment deferred until KKU Library provides an API key."
            primary={{
              label: `${stats.researchOutputs.total.toLocaleString()} papers`,
              tone: stats.researchOutputs.total > 0 ? 'success' : 'neutral',
            }}
            secondary={[
              `${stats.researchOutputs.matchedToFaculty.toLocaleString()} matched to a faculty member`,
              `${stats.researchOutputs.unmatched.toLocaleString()} unmatched (display-name only)`,
              `${stats.researchOutputs.facultyMembersWithExternalIds.toLocaleString()} faculty members with ORCID / OpenAlex ID`,
              `Source: kku-research connector (live since 2026-04-28)`,
            ]}
            href="/admin/data-sources/kku-research"
            cta="View kku-research data source"
            rawHref="/admin/data-setup/raw/research-outputs"
            rawCta="View raw data"
          />
        </div>
      </Section>

      {/* ── Data feeds ────────────────────────────────────────────── */}
      <Section
        title="Connectors & data feeds"
        description="External systems that feed the platform automatically on a cadence (Oracle / MSSQL / public APIs). Mocked connectors return seed data; live connectors pull production sources."
      >
        <CategoryCard
          icon={<Database />}
          title="Connector management"
          description="24 sources across Phase A (KKU internal), Phase B (Thailand national), Phase C (international). 5 currently live (kku-registry, kku-hr, kku-finance, kku-research, kmitl-skill-mapping); the rest run on seeded mock data."
          primary={{
            label: `${stats.dataFeeds.live} live · ${stats.dataFeeds.mocked} mocked`,
            tone: 'neutral',
          }}
          secondary={[
            `${stats.dataFeeds.total} sources registered`,
            `Per-source cadence + health at /admin/data-sources/[slug]`,
          ]}
          href="/admin/data-sources"
          cta="Manage connectors"
        />
      </Section>

      {/* ── Browse all raw datasets (full index) ─────────────────── */}
      <Section
        title="Browse all raw datasets"
        description="Direct access to every data set in tabular form. Useful for verifying real-data flow + spot-checking specific records."
      >
        <Card padding="md" tone="quiet">
          <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2 lg:grid-cols-3">
            <RawDatasetLink slug="faculties" label="Faculties" />
            <RawDatasetLink slug="departments" label="Departments" />
            <RawDatasetLink slug="programmes" label="Programmes" />
            <RawDatasetLink slug="enrollment-metrics" label="Enrollment metrics" />
            <RawDatasetLink slug="student-demographics" label="Student demographics" />
            <RawDatasetLink slug="financial-metrics" label="Financial — per program" />
            <RawDatasetLink slug="graduate-outcomes" label="Graduate outcomes (employment survey)" />
            <RawDatasetLink slug="student-cohorts" label="Student cohorts (still enrolled)" />
            <RawDatasetLink slug="alumni-cohorts" label="Alumni cohorts (outcome per cohort)" />
            <RawDatasetLink slug="admission-campaigns" label="Admission campaigns (recruitment funnel)" />
            <RawDatasetLink slug="class-offerings" label="Class offerings (sections per term)" />
            <RawDatasetLink slug="faculty-budgets" label="Faculty budgets" />
            <RawDatasetLink slug="faculty-members" label="Academic staff" />
            <RawDatasetLink slug="program-faculty" label="Programme teaching staff (who teaches what)" />
            <RawDatasetLink slug="faculty-compensation" label="Faculty compensation (aggregate)" />
            <RawDatasetLink slug="kmitl-careers" label="Labour-market career taxonomy" />
            <RawDatasetLink slug="kmitl-skill-demands" label="LinkedIn skill demand (15.8k)" />
            <RawDatasetLink slug="kmitl-skill-growths" label="LinkedIn skill growth (7.4k)" />
            <RawDatasetLink slug="research-outputs" label="Research outputs" />
            <RawDatasetLink slug="skill-aliases" label="Skill alias cache" />
            <RawDatasetLink slug="proposed-skills" label="Proposed skills (review queue)" />
            <RawDatasetLink slug="curriculum-pdfs" label="Curriculum PDFs" />
          </ul>
        </Card>
      </Section>

      {/* ── Other useful inputs (suggestions) ─────────────────────── */}
      <Section
        title="Useful additional inputs (suggestions)"
        description="Documents the AI analytics can use that don't currently have a dedicated category. Tag OTHER on upload — the classifier will route them through standard intake."
      >
        <Card padding="md" tone="quiet">
          <ul className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <SuggestionItem
              title="Self-assessment reports (SAR)"
              hint="EdPEx / AUN-QA / TQR — per-program quality reviews. Fuels the quality dimension of health-score."
            />
            <SuggestionItem
              title="Industry advisory board minutes"
              hint="Per-program industry feedback. Often misses the formal กรรมการ pipeline."
            />
            <SuggestionItem
              title="Alumni outcome surveys"
              hint="Employment + earnings outcomes. NSO covers aggregates; per-program surveys fill the precision gap."
            />
            <SuggestionItem
              title="Accreditation / professional-body standards"
              hint="ABET / ECT / ก.พ.ค. / ทันตแพทยสภา — defines must-have skills per discipline."
            />
            <SuggestionItem
              title="Library research subscriptions metadata"
              hint="ScienceDirect / SCOPUS / Web of Science snapshot exports. Backs up kku-research."
            />
            <SuggestionItem
              title="Student satisfaction survey raw data"
              hint="Course-level NPS or 5-point feedback. AI can spot deteriorating quality early."
            />
            <SuggestionItem
              title="Faculty CVs / annual self-reports"
              hint="Beyond what HCM tracks — research interests, industry experience, teaching innovations."
            />
            <SuggestionItem
              title="University strategic plan + faculty plans"
              hint="Reference the AI cross-checks against when generating Council briefs."
            />
          </ul>
        </Card>
      </Section>
    </AuthedAppShell>
  );
}

// ── Components ──────────────────────────────────────────────────────────────

interface CategoryCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  primary: { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' };
  secondary: string[];
  href: string;
  cta: string;
  /** Optional second CTA — typically the raw-data viewer link. */
  rawHref?: string;
  rawCta?: string;
  tone?: 'default' | 'glossy';
  /** Optional richer slot rendered below the CTA row — e.g. the
   * pipeline-launcher buttons on the Programs card. */
  footer?: React.ReactNode;
}

function CategoryCard({
  icon,
  title,
  description,
  primary,
  secondary,
  href,
  cta,
  rawHref,
  rawCta,
  tone = 'default',
  footer,
}: CategoryCardProps) {
  return (
    <Card tone={tone} padding="lg" className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-subtle text-accent-default [&>svg]:h-5 [&>svg]:w-5">
            {icon}
          </span>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
          </div>
        </div>
        <Badge tone={primary.tone}>{primary.label}</Badge>
      </div>
      <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
      <ul className="flex flex-col gap-1 text-sm text-text-tertiary">
        {secondary.map((s, i) => (
          <li key={i}>• {s}</li>
        ))}
      </ul>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
        <Button variant="outline" asChild>
          <Link href={href}>
            {cta}
            <ExternalLink className="size-icon-sm" aria-hidden />
          </Link>
        </Button>
        {rawHref && rawCta && (
          <Button variant="ghost" asChild>
            <Link href={rawHref}>
              {rawCta}
            </Link>
          </Button>
        )}
      </div>
      {footer && (
        <div className="mt-1 border-t border-border-subtle pt-3">{footer}</div>
      )}
    </Card>
  );
}

function ImportDatasetTile({ dataset }: { dataset: ImportDatasetSummary }) {
  const empty = dataset.rowCount === 0;
  return (
    <li>
      <Link
        href={`/admin/data-setup/raw/${dataset.slug}`}
        className="flex h-full flex-col gap-2 rounded-md border border-subtle bg-surface-1 p-3 hover:border-strong hover:bg-accent-subtle/40"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-text-primary">{dataset.title}</span>
          <Badge tone={empty ? 'neutral' : 'success'}>
            {empty ? 'Empty' : `${dataset.rowCount.toLocaleString()} rows`}
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-text-secondary">{dataset.description}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-text-tertiary">
          {dataset.lastUpload ? (
            <FreshnessBadge freshnessDate={dataset.lastUpload} label="Last upload" />
          ) : (
            <span>No spreadsheet uploaded yet</span>
          )}
          <span className="flex items-center gap-1">
            Import or view
            <ExternalLink className="size-icon-sm" aria-hidden />
          </span>
        </div>
      </Link>
    </li>
  );
}

function RawDatasetLink({ slug, label }: { slug: string; label: string }) {
  return (
    <li>
      <Link
        href={`/admin/data-setup/raw/${slug}`}
        className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface-1 px-3 py-2 text-sm hover:border-accent/40 hover:bg-accent-subtle/40"
      >
        <span className="text-text-primary">{label}</span>
        <ExternalLink className="size-icon-sm text-text-tertiary" aria-hidden />
      </Link>
    </li>
  );
}

function SuggestionItem({ title, hint }: { title: string; hint: string }) {
  return (
    <li className="flex items-start gap-3">
      <HelpCircle className="mt-0.5 size-icon-md shrink-0 text-accent-default" aria-hidden />
      <div>
        <span className="font-medium text-text-primary">{title}</span>
        <span className="ml-1 text-text-tertiary">— {hint}</span>
      </div>
    </li>
  );
}
