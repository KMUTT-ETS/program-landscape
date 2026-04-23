'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  ConfidenceBadge,
  EmptyState,
  FreshnessBadge,
  FunnelPipeline,
  Input,
  RadarChartSmall,
  Section,
  Waterfall,
} from '@kku/ui';
import type { SessionUser } from '@kku/shared';
import {
  regenerateNarrativeAction,
  submitDisagreementAction,
} from '@/lib/actions/program-deep-dive';
import type {
  DeepDiveDecisions,
  DeepDiveDemandFunnel,
  DeepDiveFaculty,
  DeepDiveFinancials,
  DeepDiveOutcomes,
  DeepDiveOverview,
  DeepDivePeers,
  DeepDiveSkills,
  DeepDiveTrends,
} from './types';

// Anchored-nav deep-dive page. Left rail has section anchors; main
// column scrolls. IntersectionObserver highlights the current section
// in the left rail.

interface Props {
  user: SessionUser;
  programId: string;
  overview: DeepDiveOverview;
  demandFunnel: DeepDiveDemandFunnel | null;
  financials: DeepDiveFinancials | null;
  skills: DeepDiveSkills | null;
  outcomes: DeepDiveOutcomes | null;
  faculty: DeepDiveFaculty | null;
  peers: DeepDivePeers | null;
  trends: DeepDiveTrends | null;
  decisions: DeepDiveDecisions | null;
}

const SECTIONS = [
  { id: 'header', label: 'Overview' },
  { id: 'narrative', label: 'Strategic narrative' },
  { id: 'demand', label: 'Demand funnel' },
  { id: 'financials', label: 'Financials' },
  { id: 'skills', label: 'Skills coverage' },
  { id: 'outcomes', label: 'Outcomes' },
  { id: 'faculty', label: 'Faculty capability' },
  { id: 'peers', label: 'Peer comparison' },
  { id: 'trends', label: 'Trend exposure' },
  { id: 'decisions', label: 'Decision history' },
];

export function DeepDiveClient(props: Props) {
  const [activeSection, setActiveSection] = React.useState('header');
  const [narrative, setNarrative] = React.useState<string | null>(null);
  const [narrativeBusy, setNarrativeBusy] = React.useState(false);
  const [narrativeAiId, setNarrativeAiId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const onRegenerateNarrative = async () => {
    setNarrativeBusy(true);
    const r = await regenerateNarrativeAction(props.programId, 'thai-narrative');
    setNarrativeBusy(false);
    if (r.ok) {
      setNarrative(r.text);
      setNarrativeAiId(r.aiInferenceId);
    } else {
      toast.error(r.message);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      {/* Left rail */}
      <aside className="sticky top-16 h-fit self-start">
        <ul className="flex flex-col gap-1 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={
                  'block rounded px-2 py-1 transition-colors ' +
                  (activeSection === s.id
                    ? 'bg-accent-subtle text-accent'
                    : 'text-text-secondary hover:bg-surface-2')
                }
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex flex-col gap-8">
        <HeaderSection overview={props.overview} />
        <NarrativeSection
          programId={props.programId}
          narrative={narrative}
          busy={narrativeBusy}
          onRegenerate={onRegenerateNarrative}
          aiInferenceId={narrativeAiId}
        />
        <DemandFunnelSection data={props.demandFunnel} />
        <FinancialsSection data={props.financials} />
        <SkillsSection data={props.skills} programId={props.programId} />
        <OutcomesSection data={props.outcomes} />
        <FacultySection data={props.faculty} />
        <PeersSection data={props.peers} />
        <TrendsSection data={props.trends} />
        <DecisionsSection data={props.decisions} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sections
// ──────────────────────────────────────────────────────────────────────────

function HeaderSection({ overview }: { overview: DeepDiveOverview }) {
  const h = overview.health;
  const dims = h
    ? [
        { label: 'Demand', value: h.dimensions.demand.score },
        { label: 'Financial', value: h.dimensions.financial.score },
        { label: 'Quality', value: h.dimensions.quality.score },
        { label: 'Relevance', value: h.dimensions.relevance.score },
        { label: 'Capability', value: h.dimensions.capability.score },
      ]
    : [];
  return (
    <section id="header" className="scroll-mt-16">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Badge tone={statusTone(overview.program.status)}>{overview.program.status}</Badge>
              <span className="text-xs text-text-tertiary">
                {overview.program.level}
                {overview.program.yearEstablished
                  ? ` · est. ${overview.program.yearEstablished}`
                  : ''}
              </span>
            </div>
            <h2 className="text-2xl font-semibold">{overview.program.nameTh}</h2>
            <p className="text-sm text-text-secondary">
              {overview.program.nameEn} · {overview.program.code}
            </p>
          </div>
          {h && (
            <div className="mt-4 flex items-center gap-4">
              <div className="flex items-baseline gap-2">
                <span className="text-xs uppercase tracking-wide text-text-tertiary">
                  Overall
                </span>
                <span
                  className={
                    'font-tabular text-3xl font-semibold ' +
                    (h.overall.score === null
                      ? 'text-text-tertiary'
                      : h.overall.score < 40
                        ? 'text-danger'
                        : h.overall.score < 65
                          ? 'text-warning'
                          : 'text-success')
                  }
                >
                  {h.overall.score === null ? '—' : Math.round(h.overall.score)}
                </span>
              </div>
              {h.latestFreshness && <FreshnessBadge freshnessDate={h.latestFreshness} />}
              <span className="text-xs text-text-tertiary">
                {h.methodologyVersion} · data {Math.round(h.overall.dataCompletenessPct)}%
              </span>
            </div>
          )}
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Health radar</h3>
          {h ? (
            <RadarChartSmall points={dims} />
          ) : (
            <p className="text-sm text-text-tertiary">Health score unavailable.</p>
          )}
        </Card>
      </div>
    </section>
  );
}

function NarrativeSection({
  narrative,
  busy,
  onRegenerate,
  aiInferenceId,
  programId,
}: {
  programId: string;
  narrative: string | null;
  busy: boolean;
  onRegenerate: () => void;
  aiInferenceId: string | null;
}) {
  const [disagreeOpen, setDisagreeOpen] = React.useState(false);
  const [disagreeText, setDisagreeText] = React.useState('');
  const router = useRouter();
  const onSubmit = async () => {
    if (!disagreeText.trim()) {
      toast.error('Describe your disagreement');
      return;
    }
    const r = await submitDisagreementAction({
      programId,
      sectionKey: 'narrative',
      aiInferenceId: aiInferenceId ?? undefined,
      bodyEn: disagreeText,
    });
    if (r.ok) {
      toast.success('Disagreement recorded — thank you');
      setDisagreeOpen(false);
      setDisagreeText('');
      router.refresh();
    } else toast.error(r.message);
  };
  return (
    <Section id="narrative" title="Strategic narrative">
      <Card>
        {narrative ? (
          <>
            <p className="whitespace-pre-wrap text-sm leading-relaxed" lang="th">
              {narrative}
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs text-text-tertiary">
              <span>AI-generated. Confidence rough; see full prompt in /admin/ai-inferences.</span>
              <Button size="xs" variant="ghost" onClick={() => setDisagreeOpen(true)}>
                Disagree with this?
              </Button>
              <Button size="xs" variant="ghost" disabled={busy} onClick={onRegenerate}>
                Regenerate
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">
              Click regenerate to produce a Thai-primary narrative summarising this program's
              current strategic position. Graceful no-LLM fallback when provider isn't configured.
            </p>
            <Button disabled={busy} onClick={onRegenerate}>
              {busy ? 'Generating…' : 'Generate narrative'}
            </Button>
          </div>
        )}

        {disagreeOpen && (
          <div className="mt-3 flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-subtle p-3">
            <div className="text-sm font-semibold">Disagreement with this narrative</div>
            <textarea
              className="rounded border border-border-default bg-surface-0 p-2 text-sm"
              rows={3}
              value={disagreeText}
              onChange={(e) => setDisagreeText(e.target.value)}
              placeholder="What's wrong / missing / misleading? Specifics help the next model version."
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="danger" onClick={() => void onSubmit()}>
                Submit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDisagreeOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>
    </Section>
  );
}

function DemandFunnelSection({ data }: { data: DeepDiveDemandFunnel | null }) {
  if (!data) return <EmptyCard title="Demand funnel" note="No enrolment data at this scope." />;
  const stages = data.stages.filter((s) => s.value > 0);
  return (
    <Section id="demand" title="Demand funnel">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          {stages.length === 0 ? (
            <EmptyState
              title="No funnel data"
              description="Enrolment metrics for the latest year are empty. Run the ingestion worker or check kku-registry connector."
            />
          ) : (
            <FunnelPipeline stages={stages} />
          )}
        </Card>
        <Card>
          <h4 className="mb-2 text-sm font-semibold">Stage conversion</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {data.conversions.map((c) => (
              <li key={`${c.fromKey}-${c.toKey}`} className="flex justify-between">
                <span>
                  {c.fromKey} → {c.toKey}
                </span>
                <span className="font-tabular">
                  {c.rate === null ? '—' : `${(c.rate * 100).toFixed(1)}%`}
                </span>
              </li>
            ))}
          </ul>
          {data.benchmarks && (
            <div className="mt-3 border-t border-border-subtle pt-3 text-xs text-text-tertiary">
              Faculty admit yield:{' '}
              {data.benchmarks.faculty?.admissionYield !== null &&
              data.benchmarks.faculty?.admissionYield !== undefined
                ? `${(data.benchmarks.faculty.admissionYield * 100).toFixed(1)}%`
                : '—'}
              &nbsp;· University admit yield:{' '}
              {data.benchmarks.university?.admissionYield !== null &&
              data.benchmarks.university?.admissionYield !== undefined
                ? `${(data.benchmarks.university.admissionYield * 100).toFixed(1)}%`
                : '—'}
            </div>
          )}
        </Card>
      </div>
    </Section>
  );
}

function FinancialsSection({ data }: { data: DeepDiveFinancials | null }) {
  if (!data || data.waterfall.length === 0) {
    return (
      <EmptyCard title="Financials" note="Financial metrics not available — financial role required." />
    );
  }
  return (
    <Section id="financials" title="Financials">
      <Card>
        <Waterfall
          steps={data.waterfall}
          valueFormat={(n) => n.toLocaleString('en-US')}
        />
        {data.sensitivity && (
          <div className="mt-3 rounded-md bg-surface-2 p-3 text-sm">
            <strong>Sensitivity — tuition + 5%:</strong> net contribution becomes{' '}
            <span className="font-tabular">
              {data.sensitivity.tuitionPlus5Pct.netContribution.toLocaleString('en-US')} THB
            </span>
          </div>
        )}
        <p className="mt-2 text-xs text-text-tertiary">
          Cost methodology {data.costMethodologyVersion}. Detailed allocation split (faculty /
          facilities / overhead) lands with the real KKU-Finance connector (prompt 14).
        </p>
      </Card>
    </Section>
  );
}

function SkillsSection({
  data,
  programId,
}: {
  data: DeepDiveSkills | null;
  programId: string;
}) {
  if (!data) return <EmptyCard title="Skills coverage" note="Skills data unavailable." />;
  void programId;
  const match = data.matchScore;
  return (
    <Section id="skills" title="Skills coverage">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Card>
            <h4 className="mb-2 text-sm font-semibold">Taught (top 20)</h4>
            <ul className="flex flex-col gap-1 text-sm">
              {data.taught.slice(0, 20).map((s) => (
                <li key={s.skillId} className="flex justify-between">
                  <span className="truncate">{s.nameEn}</span>
                  <span className="font-tabular text-text-tertiary">w {s.weight.toFixed(2)}</span>
                </li>
              ))}
              {data.taught.length === 0 && (
                <li className="text-text-tertiary">
                  No taught skills yet — run the ExtractCourseSkills job in /admin/extraction-review.
                </li>
              )}
            </ul>
          </Card>
          <Card>
            <h4 className="mb-2 text-sm font-semibold">Demanded (top 20)</h4>
            <ul className="flex flex-col gap-1 text-sm">
              {data.demanded.slice(0, 20).map((s) => (
                <li key={s.skillId} className="flex justify-between">
                  <span className="truncate">{s.nameEn}</span>
                  <span className="font-tabular text-text-tertiary">{s.jobCount} jobs</span>
                </li>
              ))}
              {data.demanded.length === 0 && (
                <li className="text-text-tertiary">No demand signal yet.</li>
              )}
            </ul>
          </Card>
        </div>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Match score</div>
          <div
            className={
              'mt-1 font-tabular text-3xl font-semibold ' +
              (match < 40 ? 'text-danger' : match < 65 ? 'text-warning' : 'text-success')
            }
          >
            {Math.round(match)}
          </div>
          {data.gaps.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-danger">Gaps</div>
              <ul className="mt-1 text-xs">
                {data.gaps.slice(0, 5).map((g) => (
                  <li key={g.skillId}>
                    {g.nameEn} ({g.jobCount})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.surplus.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-warning">Surplus</div>
              <ul className="mt-1 text-xs">
                {data.surplus.slice(0, 5).map((s) => (
                  <li key={s.skillId}>{s.nameEn}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </Section>
  );
}

function OutcomesSection({ data }: { data: DeepDiveOutcomes | null }) {
  if (!data || !data.latest) {
    return <EmptyCard title="Outcomes" note="No graduate outcome surveys yet." />;
  }
  const l = data.latest;
  return (
    <Section id="outcomes" title="Outcomes">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Employment rate (1yr)
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {(l.employmentRate * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-text-tertiary">n = {l.sampleSize}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Avg salary</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {l.averageSalary.toLocaleString('en-US')} THB
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Job relevance</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {(l.jobRelevanceScore * 100).toFixed(0)}%
          </div>
        </Card>
      </div>
      <Card className="mt-3">
        <h4 className="mb-2 text-sm font-semibold">Top employers</h4>
        <ul className="flex flex-col gap-1 text-sm">
          {data.topEmployers.slice(0, 10).map((e, i) => (
            <li key={i} className="flex justify-between">
              <span>{e.name}</span>
              <span className="font-tabular text-text-tertiary">
                {e.year} · sat {(e.satisfactionScore * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-3">
        <h4 className="mb-2 text-sm font-semibold">Geographic distribution</h4>
        <p className="text-sm text-text-tertiary">
          Thailand choropleth deferred — we don't yet collect per-graduate location. Stub table will
          land when the KKU-Alumni connector adds home province.
        </p>
      </Card>
    </Section>
  );
}

function FacultySection({ data }: { data: DeepDiveFaculty | null }) {
  if (!data) return <EmptyCard title="Faculty capability" note="Faculty data unavailable." />;
  return (
    <Section id="faculty" title="Faculty capability">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Active faculty</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">{data.totalActive}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Avg age</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {data.averageAgeYears === null ? '—' : `${data.averageAgeYears.toFixed(0)} yrs`}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Succession risk (5yr)
          </div>
          <div
            className={
              'mt-1 font-tabular text-2xl font-semibold ' +
              (data.successionRiskPct > 30 ? 'text-danger' : 'text-text-primary')
            }
          >
            {data.successionRiskPct.toFixed(0)}%
          </div>
          <div className="text-xs text-text-tertiary">
            {data.retiringWithin5Years} of {data.totalActive}
          </div>
        </Card>
      </div>
      <Card className="mt-3">
        <h4 className="mb-2 text-sm font-semibold">Rank distribution</h4>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.ranks).map(([rank, count]) => (
            <Badge key={rank} tone="neutral">
              {rank}: {count}
            </Badge>
          ))}
        </div>
        {data.visibility === 'aggregates-only' && (
          <p className="mt-3 text-xs text-text-tertiary">
            Individual faculty detail hidden — your role sees aggregates only. Council members see
            anonymised ranks + retirement horizon; names + specialisation are EXECUTIVE / ANALYST /
            DEAN / DEPT_HEAD only.
          </p>
        )}
      </Card>
    </Section>
  );
}

function PeersSection({ data }: { data: DeepDivePeers | null }) {
  if (!data) return <EmptyCard title="Peer comparison" note="Peer data unavailable." />;
  if (data.peers.length === 0) {
    return (
      <Section id="peers" title="Peer comparison">
        <Card>
          <EmptyState
            title="No peer programs loaded"
            description="Peer data arrives via the peer-programs-scraper connector (prompt 03 — mocked). Auto-suggestion lands with Benchmarking module (prompt 10)."
          />
        </Card>
      </Section>
    );
  }
  return (
    <Section id="peers" title="Peer comparison">
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-text-secondary">
              <tr>
                <th className="px-3 py-2 text-left">Institution</th>
                <th className="px-3 py-2 text-left">Country</th>
                <th className="px-3 py-2 text-left">Program</th>
                <th className="px-3 py-2 text-left">Level</th>
                <th className="px-3 py-2 text-right">Ranking</th>
              </tr>
            </thead>
            <tbody>
              {data.peers.map((p) => (
                <tr key={p.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2 font-medium">{p.institution}</td>
                  <td className="px-3 py-2">{p.country}</td>
                  <td className="px-3 py-2">{p.programName}</td>
                  <td className="px-3 py-2">{p.programLevel}</td>
                  <td className="px-3 py-2 text-right font-tabular">{p.ranking ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Section>
  );
}

function TrendsSection({ data }: { data: DeepDiveTrends | null }) {
  if (!data || data.signals.length === 0) {
    return (
      <Section id="trends" title="Trend exposure">
        <Card>
          <EmptyState
            title="No trend signals"
            description="Trend Signals arrive from policy documents + research alerts once Trends Radar (prompt 07) is wired."
          />
        </Card>
      </Section>
    );
  }
  return (
    <Section id="trends" title="Trend exposure">
      <div className="flex flex-col gap-2">
        {data.signals.map((s) => (
          <Card key={s.id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-xs text-text-tertiary">
                  {s.signalType} · detected {new Date(s.detectedDate).toLocaleDateString()}
                  {s.isTargetedAtProgram ? ' · targeted' : ' · general'}
                </div>
                {s.summaryTh && (
                  <p className="mt-2 text-sm" lang="th">
                    {s.summaryTh}
                  </p>
                )}
              </div>
              <Badge
                tone={s.impactScore > 0.6 ? 'danger' : s.impactScore > 0.3 ? 'warning' : 'neutral'}
              >
                impact {(s.impactScore * 100).toFixed(0)}
              </Badge>
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function DecisionsSection({ data }: { data: DeepDiveDecisions | null }) {
  if (!data || (data.decisions.length === 0 && data.annotations.length === 0)) {
    return <EmptyCard title="Decision history" note="No Council decisions or annotations yet." />;
  }
  return (
    <Section id="decisions" title="Decision history">
      <div className="flex flex-col gap-2">
        {data.decisions.map((d) => (
          <Card key={d.id}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{d.decisionType}</div>
                <div className="text-xs text-text-tertiary">
                  {d.status} · decided {new Date(d.createdAt).toLocaleDateString()} by{' '}
                  {d.decidedBy}
                </div>
                {d.rationaleTh && (
                  <p className="mt-2 text-sm" lang="th">
                    {d.rationaleTh}
                  </p>
                )}
              </div>
              <Badge
                tone={
                  d.status === 'APPROVED' || d.status === 'IMPLEMENTED'
                    ? 'success'
                    : d.status === 'REJECTED'
                      ? 'danger'
                      : 'neutral'
                }
              >
                {d.status}
              </Badge>
            </div>
          </Card>
        ))}
        {data.annotations.map((a) => (
          <Card key={a.id}>
            <div className="text-xs text-text-tertiary">
              {a.kind} · by {a.author} · {new Date(a.createdAt).toLocaleString()}
            </div>
            {a.bodyEn && <p className="mt-1 text-sm">{a.bodyEn}</p>}
            {a.bodyTh && (
              <p className="mt-1 text-sm" lang="th">
                {a.bodyTh}
              </p>
            )}
          </Card>
        ))}
      </div>
    </Section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function EmptyCard({ title, note }: { title: string; note: string }) {
  return (
    <Section id={title.toLowerCase().replace(/\s/g, '-')} title={title}>
      <Card>
        <p className="text-sm text-text-tertiary">{note}</p>
      </Card>
    </Section>
  );
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'PAUSED') return 'warning';
  if (status === 'SUNSET') return 'danger';
  return 'neutral';
}
