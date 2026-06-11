import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { Badge, Button, Card, PageHeader } from '@kku/ui';
import {
  ArrowLeft,
  ArrowUpRight,
  FileText,
  GraduationCap,
  Sparkles,
  Lightbulb,
  FolderKanban,
  MessageSquare,
  Landmark,
  FlaskConical,
  TrendingUp,
  Cpu,
  Newspaper,
  Radar,
  Briefcase,
  Clock,
  Rocket,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { MarkReviewedButton } from './mark-reviewed';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trend Signal' };

interface ExampleProject {
  titleTh: string;
  titleEn: string;
  descTh: string | null;
  descEn: string | null;
}
interface RecommendedAction {
  priority: 'high' | 'medium' | 'low';
  titleTh: string;
  titleEn: string;
  detailTh: string;
  detailEn: string;
  exampleProjects: ExampleProject[];
}
interface JobRole {
  titleTh: string;
  titleEn: string;
}
interface AffectedProgram {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
  immediateRoles: JobRole[];
  emergingRoles: JobRole[];
  fitNoteTh: string | null;
  // Candidate supply from the program's active cohorts (same source as the
  // /programs/[id] cohort chart). immediate = graduating soon; emerging =
  // rest of the pipeline. Counts hidden when cohortDataAvailable is false.
  immediateCandidates: number;
  emergingCandidates: number;
  cohortDataAvailable: boolean;
}
interface NewInitiative {
  titleTh: string;
  titleEn: string;
  unmetRoleTh: string;
  unmetRoleEn: string;
  audienceTh: string;
  audienceEn: string;
  formatTh: string;
  formatEn: string;
  detailTh: string;
  detailEn: string;
}

interface TrendDetail {
  signal: {
    id: string;
    title: string;
    signalType: string;
    summaryTh: string | null;
    summaryEn: string | null;
    sourceUrl: string | null;
    detectedDate: string;
    impactScore: number;
    affectedProgramIds: string[];
    affectedSkillIds: string[];
    aiInferenceId: string | null;
  };
  programs: AffectedProgram[];
  skills: Array<{ id: string; nameEn: string; nameTh: string }>;
  recommendedActions: RecommendedAction[];
  newInitiatives: NewInitiative[];
  annotations: Array<{
    id: string;
    kind: string;
    bodyEn: string | null;
    bodyTh: string | null;
    author: string;
    createdAt: string;
  }>;
}

// Signal-type presentation — icon + accent ink + readable label.
const TYPE_META: Record<string, { icon: LucideIcon; ink: string; label: string }> = {
  POLICY: { icon: Landmark, ink: 'text-info', label: 'Policy' },
  RESEARCH: { icon: FlaskConical, ink: 'text-accent-default', label: 'Research' },
  MARKET: { icon: TrendingUp, ink: 'text-success', label: 'Market demand' },
  TECH: { icon: Cpu, ink: 'text-warning', label: 'Technology' },
  NEWS: { icon: Newspaper, ink: 'text-text-secondary', label: 'News' },
};

function impactTier(score: number): { label: string; tone: 'danger' | 'warning' | 'neutral'; bar: string } {
  if (score >= 0.7) return { label: 'High impact', tone: 'danger', bar: 'bg-danger' };
  if (score >= 0.4) return { label: 'Medium impact', tone: 'warning', bar: 'bg-warning' };
  return { label: 'Low impact', tone: 'neutral', bar: 'bg-border-strong' };
}

export default async function TrendSignalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const { id } = await params;

  const detailRes = await apiFetchSafe<TrendDetail | null>(`/trends/${id}`);
  const detail = detailRes.ok ? detailRes.data : null;
  if (!detail) {
    if (!detailRes.ok && detailRes.error.category === 'notFound') notFound();
    return (
      <AuthedAppShell user={user}>
        <PageHeader title="Trend signal" />
        <DiagnosticEmptyState
          surface="this trend signal"
          error={detailRes.ok ? null : detailRes.error}
        />
      </AuthedAppShell>
    );
  }

  const s = detail.signal;
  const type = TYPE_META[s.signalType] ?? { icon: Radar, ink: 'text-text-secondary', label: s.signalType };
  const TypeIcon = type.icon;
  const impact = impactTier(s.impactScore);
  const impactPct = Math.round(s.impactScore * 100);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title={s.title}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/trends">
                <ArrowLeft className="h-4 w-4" />
                Back to feed
              </Link>
            </Button>
            <MarkReviewedButton signalId={id} />
          </div>
        }
      />

      {/* Single-column analysis stack */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {/* ── Meta strip: type · impact · date · source ──────────────── */}
        <Card padding="md">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <span className={`inline-flex items-center gap-2 text-sm font-semibold ${type.ink}`}>
              <TypeIcon className="h-5 w-5" />
              {type.label}
            </span>
            <span className="inline-flex items-center gap-2">
              <Badge tone={impact.tone} size="sm">{impact.label}</Badge>
              <span className="font-tabular text-sm font-semibold text-text-primary">{impactPct}</span>
              <span className="text-xs text-text-tertiary">/ 100</span>
            </span>
            <span className="text-xs text-text-tertiary">
              Detected {new Date(s.detectedDate).toLocaleDateString()}
            </span>
            {s.sourceUrl && (
              <a
                href={s.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                Source <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          {/* impact bar */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full rounded-full ${impact.bar}`} style={{ width: `${impactPct}%` }} />
          </div>
        </Card>

        {/* ── Summary ────────────────────────────────────────────────── */}
        <SectionCard icon={FileText} iconInk="text-info" title="Summary">
          {s.summaryTh && <p className="text-sm leading-relaxed text-text-primary" lang="th">{s.summaryTh}</p>}
          {s.summaryEn && <p className="mt-3 text-sm leading-relaxed text-text-secondary">{s.summaryEn}</p>}
          {!s.summaryTh && !s.summaryEn && <p className="text-sm text-text-tertiary">No summary available.</p>}
        </SectionCard>

        {/* ── Recommended actions (the centrepiece) ──────────────────── */}
        <SectionCard
          icon={Lightbulb}
          iconInk="text-warning"
          title="Recommended actions"
          count={detail.recommendedActions.length}
        >
          {detail.recommendedActions.length === 0 ? (
            <p className="text-sm text-text-tertiary">Analysis hasn&rsquo;t been run for this signal yet.</p>
          ) : (
            <ol className="flex flex-col gap-4">
              {detail.recommendedActions.map((a, i) => (
                <ActionItem key={i} action={a} index={i + 1} />
              ))}
            </ol>
          )}
        </SectionCard>

        {/* ── Affected programs + the jobs they feed ─────────────────── */}
        <SectionCard icon={GraduationCap} iconInk="text-accent-default" title="Affected programs" count={detail.programs.length}>
          {detail.programs.length === 0 ? (
            <p className="text-sm text-text-tertiary">No programs directly linked.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {detail.programs.map((p) => (
                <ProgramItem key={p.id} program={p} />
              ))}
            </ul>
          )}
        </SectionCard>

        {/* ── New initiatives — white-space products/services ────────── */}
        {detail.newInitiatives.length > 0 && (
          <SectionCard
            icon={Rocket}
            iconInk="text-accent-default"
            title="New initiatives — re-skill / upskill products"
            count={detail.newInitiatives.length}
          >
            <p className="mb-3 text-xs leading-relaxed text-text-tertiary">
              Roles the signal demands that no current KKU program supplies (a missing field, or a
              vocational/sub-degree position) — candidate new offerings KKU could launch.
            </p>
            <ul className="flex flex-col gap-3">
              {detail.newInitiatives.map((n, i) => (
                <InitiativeItem key={i} initiative={n} />
              ))}
            </ul>
          </SectionCard>
        )}

        {/* ── Affected skills ────────────────────────────────────────── */}
        <SectionCard icon={Sparkles} iconInk="text-success" title="Affected skills" count={detail.skills.length}>
          {detail.skills.length === 0 ? (
            <p className="text-sm text-text-tertiary">No skills linked yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {detail.skills.map((sk) => (
                <Link
                  key={sk.id}
                  href="/skills"
                  className="rounded-full border border-border-default bg-surface-1 px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
                >
                  {sk.nameEn}
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        {/* ── Notes / annotations (only when present) ────────────────── */}
        {detail.annotations.length > 0 && (
          <SectionCard icon={MessageSquare} iconInk="text-text-secondary" title="Notes" count={detail.annotations.length}>
            <ul className="flex flex-col gap-3">
              {detail.annotations.map((a) => (
                <li key={a.id} className="border-b border-border-subtle pb-3 last:border-0 last:pb-0">
                  <div className="text-xs text-text-tertiary">
                    {a.author} · {new Date(a.createdAt).toLocaleDateString()}
                  </div>
                  {a.bodyEn && <div className="mt-1 text-sm text-text-secondary">{a.bodyEn}</div>}
                  {a.bodyTh && <div className="mt-1 text-sm text-text-primary" lang="th">{a.bodyTh}</div>}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </AuthedAppShell>
  );
}

function SectionCard({
  icon: Icon,
  iconInk,
  title,
  count,
  children,
}: {
  icon: LucideIcon;
  iconInk: string;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Card padding="md">
      <div className="mb-3 flex items-center gap-2.5">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 ${iconInk}`}>
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {count !== undefined && <span className="font-tabular text-xs text-text-tertiary">· {count}</span>}
      </div>
      {children}
    </Card>
  );
}

// One affected program + the job positions its graduates feed (now vs. 1-3yr).
function ProgramItem({ program: p }: { program: AffectedProgram }) {
  const hasRoles = p.immediateRoles.length > 0 || p.emergingRoles.length > 0;
  return (
    <li className="rounded-md border border-border-subtle bg-surface-1 p-3">
      <Link
        href={`/programs/${p.id}`}
        className="group inline-flex items-start gap-2 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary group-hover:text-accent" />
        <span>
          <span className="font-medium text-text-primary group-hover:underline">{p.nameEn || p.nameTh}</span>
          <span className="ml-1.5 text-xs text-text-tertiary">{p.code}</span>
        </span>
      </Link>
      {p.fitNoteTh && (
        <p className="mt-1.5 pl-5 text-xs leading-relaxed text-text-secondary" lang="th">{p.fitNoteTh}</p>
      )}
      {hasRoles ? (
        <div className="mt-2.5 flex flex-col gap-2.5 pl-5">
          <RoleGroup
            icon={Briefcase}
            iconInk="text-success"
            label="Immediate roles"
            sublabel="hireable now"
            roles={p.immediateRoles}
            candidateCount={p.cohortDataAvailable ? p.immediateCandidates : null}
          />
          <RoleGroup
            icon={Clock}
            iconInk="text-info"
            label="Emerging roles"
            sublabel="1–3 years, with curriculum adaptation / upskilling"
            roles={p.emergingRoles}
            candidateCount={p.cohortDataAvailable ? p.emergingCandidates : null}
          />
        </div>
      ) : (
        <p className="mt-1.5 pl-5 text-xs text-text-tertiary">No job positions mapped yet.</p>
      )}
    </li>
  );
}

// A labelled set of job-position chips (immediate or emerging), with the
// candidate-supply count (from the program's active cohorts) in the header.
function RoleGroup({
  icon: Icon,
  iconInk,
  label,
  sublabel,
  roles,
  candidateCount,
}: {
  icon: LucideIcon;
  iconInk: string;
  label: string;
  sublabel: string;
  roles: JobRole[];
  candidateCount: number | null;
}) {
  if (roles.length === 0) return null;
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Icon className={`h-3.5 w-3.5 ${iconInk}`} />
        <span className="text-xs font-semibold text-text-secondary">{label}</span>
        {candidateCount !== null && (
          <span className="font-tabular text-[11px] font-semibold text-text-primary">
            · {candidateCount.toLocaleString()} candidate{candidateCount === 1 ? '' : 's'}
          </span>
        )}
        <span className="text-[11px] text-text-tertiary">· {sublabel}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {roles.map((r, i) => (
          <span
            key={i}
            className="rounded-md border border-border-subtle bg-surface-2/60 px-2 py-0.5 text-xs text-text-primary"
            lang="th"
            title={r.titleEn && r.titleEn !== r.titleTh ? r.titleEn : undefined}
          >
            {r.titleTh || r.titleEn}
          </span>
        ))}
      </div>
    </div>
  );
}

// One white-space new-offering idea for a demanded role KKU does not supply.
function InitiativeItem({ initiative: n }: { initiative: NewInitiative }) {
  return (
    <li className="rounded-md border border-border-subtle bg-surface-1 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-text-primary" lang="th">{n.titleTh || n.titleEn}</h4>
        {n.formatTh && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-secondary" lang="th">
            {n.formatTh}
          </span>
        )}
      </div>
      {n.titleEn && n.titleEn !== n.titleTh && (
        <p className="mt-0.5 text-xs font-medium text-text-tertiary">{n.titleEn}</p>
      )}
      {(n.unmetRoleTh || n.audienceTh) && (
        <div className="mt-2 flex flex-col gap-1 text-xs text-text-secondary">
          {n.unmetRoleTh && (
            <div className="flex items-start gap-1.5">
              <Briefcase className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
              <span>
                <span className="text-text-tertiary">Unmet role: </span>
                <span className="text-text-primary" lang="th">{n.unmetRoleTh}</span>
              </span>
            </div>
          )}
          {n.audienceTh && (
            <div className="flex items-start gap-1.5">
              <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
              <span>
                <span className="text-text-tertiary">For: </span>
                <span className="text-text-primary" lang="th">{n.audienceTh}</span>
              </span>
            </div>
          )}
        </div>
      )}
      {(n.detailTh || n.detailEn) && (
        <div className="mt-2">
          {n.detailTh && <p className="text-sm leading-relaxed text-text-secondary" lang="th">{n.detailTh}</p>}
          {n.detailEn && n.detailEn !== n.detailTh && (
            <p className="mt-1 text-xs leading-relaxed text-text-tertiary">{n.detailEn}</p>
          )}
        </div>
      )}
    </li>
  );
}

function ActionItem({ action: a, index }: { action: RecommendedAction; index: number }) {
  const accent =
    a.priority === 'high' ? 'border-l-danger' : a.priority === 'medium' ? 'border-l-warning' : 'border-l-border-strong';
  const tone = a.priority === 'high' ? 'danger' : a.priority === 'medium' ? 'warning' : 'neutral';
  return (
    <li className={`rounded-r-md border-l-4 bg-surface-1 py-1 pl-4 ${accent}`}>
      <div className="flex items-start gap-2">
        <span className="font-tabular text-sm font-bold text-text-tertiary">{index}.</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-text-primary" lang="th">{a.titleTh || a.titleEn}</h4>
            <Badge tone={tone} size="sm">{a.priority}</Badge>
          </div>
          {a.titleEn && a.titleEn !== a.titleTh && (
            <p className="mt-0.5 text-xs font-medium text-text-tertiary">{a.titleEn}</p>
          )}

          {(a.detailTh || a.detailEn) && (
            <div className="mt-2">
              {a.detailTh && <p className="text-sm leading-relaxed text-text-secondary" lang="th">{a.detailTh}</p>}
              {a.detailEn && a.detailEn !== a.detailTh && (
                <p className="mt-1 text-xs leading-relaxed text-text-tertiary">{a.detailEn}</p>
              )}
            </div>
          )}

          {a.exampleProjects.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
                <FolderKanban className="h-3.5 w-3.5 text-accent" />
                Example projects
              </div>
              <ul className="flex flex-col gap-2">
                {a.exampleProjects.map((p, j) => (
                  <li key={j} className="rounded-md border border-border-subtle bg-surface-2/50 px-3 py-2">
                    <div className="text-sm font-medium text-text-primary" lang="th">{p.titleTh || p.titleEn}</div>
                    {p.titleEn && p.titleEn !== p.titleTh && (
                      <div className="text-xs text-text-tertiary">{p.titleEn}</div>
                    )}
                    {p.descTh && <div className="mt-0.5 text-xs leading-relaxed text-text-secondary" lang="th">{p.descTh}</div>}
                    {p.descEn && p.descEn !== p.descTh && (
                      <div className="mt-0.5 text-xs leading-relaxed text-text-tertiary">{p.descEn}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
