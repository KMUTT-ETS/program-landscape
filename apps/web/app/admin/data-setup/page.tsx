import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import {
  Badge,
  Button,
  Card,
  EdgeGlow,
  PageHeader,
  Section,
} from '@kku/ui';
import {
  Banknote,
  Building2,
  Database,
  ExternalLink,
  FileSearch,
  FileText,
  GitBranch,
  Globe,
  GraduationCap,
  HelpCircle,
  Upload,
  UserSquare2,
} from 'lucide-react';

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
}

const EMPTY_STATS: DataSetupStats = {
  programs: { total: 0, withCurriculumPdf: 0, missingCurriculumPdf: 0 },
  curriculumDocs: { total: 0 },
  externalDocs: { policy: 0, report: 0, survey: 0, peerProgram: 0, committeeMinutes: 0, jobPostingsBatch: 0, other: 0, total: 0 },
  facultyStaff: { total: 0, active: 0 },
  studentInfo: { enrollmentMetricRows: 0, programsWithEnrollment: 0, programsWithoutEnrollment: 0 },
  financial: { programMetrics: 0, programsWithFinancial: 0, programsWithoutFinancial: 0, facultyBudgetRows: 0 },
  dataFeeds: { total: 0, live: 0, mocked: 0 },
};

export default async function AdminDataSetupPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (user.role !== 'ADMIN' && user.role !== 'ANALYST') redirect('/');

  const stats = await apiFetch<DataSetupStats>('/admin/data-setup/stats').catch(
    () => EMPTY_STATS,
  );

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · Data setup"
        title="Feed the system"
        subtitle="Every category of input the AI analytics depends on. Upload, organise, and review the data that drives the curriculum-landscape views — from international policy docs through to per-program tuition."
        actions={
          <EdgeGlow inline>
            <Button variant="primary" asChild>
              <Link href="/upload">
                <Upload className="h-4 w-4" aria-hidden />
                Upload documents
              </Link>
            </Button>
          </EdgeGlow>
        }
      />

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
            ]}
            href="/admin/data-sources/kku-hr"
            cta="View kku-hr data source"
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
            ]}
            href="/admin/data-sources/kku-registry"
            cta="View kku-registry data source"
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
            ]}
            href="/admin/data-sources/kku-finance"
            cta="View kku-finance data source"
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
  tone?: 'default' | 'glossy';
}

function CategoryCard({
  icon,
  title,
  description,
  primary,
  secondary,
  href,
  cta,
  tone = 'default',
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
      <div className="mt-auto pt-2">
        <Button variant="outline" asChild>
          <Link href={href}>
            {cta}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
    </Card>
  );
}

function SuggestionItem({ title, hint }: { title: string; hint: string }) {
  return (
    <li className="flex items-start gap-3">
      <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent-default" aria-hidden />
      <div>
        <span className="font-medium text-text-primary">{title}</span>
        <span className="ml-1 text-text-tertiary">— {hint}</span>
      </div>
    </li>
  );
}
