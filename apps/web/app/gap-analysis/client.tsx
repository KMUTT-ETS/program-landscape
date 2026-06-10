'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card } from '@kku/ui';
import type { GapAnalysisResponse, GapLensKey, GapProgRefDto } from './types';

// Multi-lens Gap Analyzer — tabbed. Each lens is a 0–100 gap-severity view
// (higher = wider gap); the Composite tab rolls them up per program.

const LENS_LABEL: Record<GapLensKey, string> = {
  skill: 'Skill',
  content: 'Content',
  aiReadiness: 'AI',
  recruitment: 'Recruit',
  staff: 'Staff',
  demographic: 'Demo',
};
const LENS_ORDER: GapLensKey[] = ['skill', 'content', 'aiReadiness', 'recruitment', 'staff', 'demographic'];

const TABS = [
  { key: 'overview', label: 'Composite index' },
  { key: 'skill', label: 'Skill / market' },
  { key: 'content', label: 'Content' },
  { key: 'ai', label: 'AI readiness' },
  { key: 'recruitment', label: 'Recruitment' },
  { key: 'staff', label: 'Staff capability' },
  { key: 'demographic', label: 'Demographic' },
  { key: 'whitespace', label: 'White-space' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function sevClasses(v: number | null): string {
  if (v === null) return 'bg-surface-2 text-text-tertiary';
  if (v >= 66) return 'bg-danger-subtle text-danger';
  if (v >= 33) return 'bg-warning-subtle text-warning';
  return 'bg-success-subtle text-success';
}
function GapCell({ v }: { v: number | null }) {
  return (
    <span className={`inline-flex min-w-[2.25rem] justify-center rounded px-1.5 py-0.5 font-tabular text-xs font-semibold ${sevClasses(v)}`}>
      {v === null ? '—' : Math.round(v)}
    </span>
  );
}

// Program reference cell — same name style + language as the /programs table:
// English name (bold link), Thai name beneath, code in mono. Falls back to the
// Thai name when English is blank (16 programs have no nameEn).
function ProgRef({ p, faculty }: { p: GapProgRefDto; faculty?: boolean }) {
  const primary = p.nameEn || p.nameTh;
  return (
    <div className="leading-tight">
      <Link href={`/programs/${p.programId}`} className="font-medium text-text-primary hover:underline">
        {primary}
      </Link>
      {p.nameEn && <div className="text-xs text-text-secondary" lang="th">{p.nameTh}</div>}
      <div className="font-mono text-[10px] text-text-tertiary">
        {p.code}
        {faculty && p.facultyNameEn && <span className="ml-1.5 font-sans">· {p.facultyNameEn}</span>}
      </div>
    </div>
  );
}

export function GapAnalysisClient({ data }: { data: GapAnalysisResponse }) {
  const [tab, setTab] = React.useState<TabKey>('overview');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 border-b border-border-subtle">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-sm transition-colors ${
              tab === t.key ? 'border-accent-default font-semibold text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab data={data} />}
      {tab === 'skill' && <SkillTab data={data} />}
      {tab === 'content' && <ContentTab data={data} />}
      {tab === 'ai' && <AiTab data={data} />}
      {tab === 'recruitment' && <RecruitmentTab data={data} />}
      {tab === 'staff' && <StaffTab data={data} />}
      {tab === 'demographic' && <DemographicTab data={data} />}
      {tab === 'whitespace' && <WhiteSpaceTab data={data} />}
    </div>
  );
}

// ── Composite — faculty → program drill-down ───────────────────────────────
function OverviewTab({ data }: { data: GapAnalysisResponse }) {
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const progsByFaculty = React.useMemo(() => {
    const m = new Map<string, GapAnalysisResponse['composite']['rows']>();
    for (const p of data.composite.rows) {
      const arr = m.get(p.facultyId) ?? [];
      arr.push(p);
      m.set(p.facultyId, arr);
    }
    return m;
  }, [data]);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="flex flex-col gap-4">
      <Card padding="md">
        <h3 className="text-sm font-semibold text-text-primary">Composite Gap Index</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-text-tertiary">
          Each program scored 0–100 per lens (higher = wider gap), averaged across the lenses with data.
          Click a faculty to expand its programs, sorted worst-first. Cells:
          <span className="mx-1 rounded bg-success-subtle px-1 text-success">low</span>
          <span className="mr-1 rounded bg-warning-subtle px-1 text-warning">moderate</span>
          <span className="rounded bg-danger-subtle px-1 text-danger">wide</span>.
        </p>
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-text-tertiary [&_th]:whitespace-nowrap">
              <tr>
                <th className="px-4 py-2">Faculty / program</th>
                <th className="py-2 text-center">Composite</th>
                {LENS_ORDER.map((k) => (
                  <th key={k} className="py-2 text-center">{LENS_LABEL[k]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.composite.facultyHeatmap.map((f) => {
                const isOpen = open.has(f.facultyId);
                const progs = progsByFaculty.get(f.facultyId) ?? [];
                return (
                  <React.Fragment key={f.facultyId}>
                    <tr
                      className="cursor-pointer border-t border-border-subtle bg-surface-1/60 hover:bg-surface-2/60"
                      onClick={() => toggle(f.facultyId)}
                    >
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2 font-medium">
                          <span className="w-4 shrink-0 text-center text-xs text-text-tertiary">{isOpen ? '▾' : '▸'}</span>
                          <span lang="th">{f.facultyNameEn}</span>
                          <span className="font-tabular text-[11px] font-normal text-text-tertiary">· {f.programCount}</span>
                        </span>
                      </td>
                      <td className="py-2 text-center"><GapCell v={f.avgComposite} /></td>
                      {LENS_ORDER.map((k) => (
                        <td key={k} className="py-2 text-center"><GapCell v={f.subScores[k]} /></td>
                      ))}
                    </tr>
                    {isOpen &&
                      progs.map((p) => (
                        <tr key={p.programId} className="border-t border-border-subtle hover:bg-surface-2/40">
                          <td className="py-1.5 pl-10 pr-4"><ProgRef p={p} /></td>
                          <td className="py-1.5 text-center"><GapCell v={p.composite} /></td>
                          {LENS_ORDER.map((k) => (
                            <td key={k} className="py-1.5 text-center"><GapCell v={p.subScores[k]} /></td>
                          ))}
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── building blocks ────────────────────────────────────────────────────────
function Kpi({ label, value, hint, ink, tip }: { label: string; value: React.ReactNode; hint?: string; ink?: string; tip?: string }) {
  return (
    <Card padding="md" className={tip ? 'cursor-help' : undefined}>
      <div className="flex items-center gap-1 text-xs text-text-tertiary" title={tip}>
        {label}
        {tip && <span className="text-[10px] opacity-60">ⓘ</span>}
      </div>
      <div className={`mt-1 font-tabular text-2xl font-bold ${ink ?? 'text-text-primary'}`} title={tip}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-text-tertiary">{hint}</div>}
    </Card>
  );
}
function SimpleTable({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-text-tertiary [&_th]:whitespace-nowrap">{head}</thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Card>
  );
}
const RefCell = ({ p }: { p: GapProgRefDto }) => (
  <td className="px-4 py-2"><ProgRef p={p} faculty /></td>
);

// ── Skill / market ─────────────────────────────────────────────────────────
function SkillTab({ data }: { data: GapAnalysisResponse }) {
  // Only skills with a real demand signal (demand > 0). Skills with demand = 0
  // are NOT measured by the labour-market feed, so calling them "oversupply"
  // would be wrong — they're excluded. Soft skills are also excluded upstream.
  const rows = data.skill.rows.filter((r) => r.demand > 0);
  const shortage = rows.filter((r) => r.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 20);
  const oversupply = rows.filter((r) => r.gap < 0).sort((a, b) => a.gap - b.gap).slice(0, 20);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-text-tertiary">
        Labour-market skill demand (LinkedIn, subscribed by MHESI) vs KKU graduate supply, for the{' '}
        <span className="font-medium text-text-secondary">{rows.length}</span> skills with a measured demand signal.
        Skills the labour-market feed doesn&rsquo;t measure are excluded (we can&rsquo;t judge their gap), and
        soft skills are excluded (postings systematically under-list them).
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-1.5 text-sm font-semibold text-warning">Need more graduates (shortage)</h4>
          {shortage.length === 0 ? <Empty /> : (
            <SimpleTable head={<tr><th className="px-4 py-2">Skill</th><th className="py-2 text-right">Demand</th><th className="py-2 pr-4 text-right">Supply</th></tr>}>
              {shortage.map((r) => (
                <tr key={r.skillId} className="border-t border-border-subtle">
                  <td className="px-4 py-1.5"><div className="leading-tight">{r.nameEn}<div className="text-[10px] text-text-tertiary" lang="th">{r.nameTh}</div></div></td>
                  <td className="py-1.5 text-right font-tabular text-xs font-semibold text-warning">{Math.round(r.demand)}</td>
                  <td className="py-1.5 pr-4 text-right font-tabular text-xs text-text-tertiary">{Math.round(r.supply)}</td>
                </tr>
              ))}
            </SimpleTable>
          )}
        </div>
        <div>
          <h4 className="mb-1.5 text-sm font-semibold text-info">Too many graduates (oversupply)</h4>
          {oversupply.length === 0 ? <Empty /> : (
            <SimpleTable head={<tr><th className="px-4 py-2">Skill</th><th className="py-2 text-right">Supply</th><th className="py-2 pr-4 text-right">Demand</th></tr>}>
              {oversupply.map((r) => (
                <tr key={r.skillId} className="border-t border-border-subtle">
                  <td className="px-4 py-1.5"><div className="leading-tight">{r.nameEn}<div className="text-[10px] text-text-tertiary" lang="th">{r.nameTh}</div></div></td>
                  <td className="py-1.5 text-right font-tabular text-xs font-semibold text-info">{Math.round(r.supply)}</td>
                  <td className="py-1.5 pr-4 text-right font-tabular text-xs text-text-tertiary">{Math.round(r.demand)}</td>
                </tr>
              ))}
            </SimpleTable>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Content ────────────────────────────────────────────────────────────────
function ContentTab({ data }: { data: GapAnalysisResponse }) {
  const c = data.content;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-tertiary">
        Curriculum content gaps from the AI peer reviews ({c.reviewedPrograms} programs) — specific topics
        where KKU lags the named peer programs.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Reviewed programs" value={c.reviewedPrograms} />
        <Kpi label="Major gaps" value={c.severity.major} ink="text-danger" />
        <Kpi label="Moderate gaps" value={c.severity.moderate} ink="text-warning" />
        <Kpi label="Minor gaps" value={c.severity.minor} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-1.5 text-sm font-semibold text-text-primary">Most-flagged missing topics</h4>
          <SimpleTable head={<tr><th className="px-4 py-2">Topic</th><th className="py-2 text-right">Major</th><th className="py-2 pr-4 text-right">Total</th></tr>}>
            {c.topTopics.map((t) => (
              <tr key={t.topic} className="border-t border-border-subtle">
                <td className="px-4 py-1.5">{t.topic}</td>
                <td className="py-1.5 text-right font-tabular text-xs text-danger">{t.major}</td>
                <td className="py-1.5 pr-4 text-right font-tabular text-xs">{t.total}</td>
              </tr>
            ))}
          </SimpleTable>
        </div>
        <div>
          <h4 className="mb-1.5 text-sm font-semibold text-text-primary">Programs furthest behind</h4>
          <SimpleTable head={<tr><th className="px-4 py-2">Program</th><th className="py-2 text-right">Major</th><th className="py-2 pr-4 text-right">Total</th></tr>}>
            {c.worstPrograms.map((p) => (
              <tr key={p.programId} className="border-t border-border-subtle hover:bg-surface-2/40">
                <RefCell p={p} />
                <td className="py-2 text-right font-tabular text-xs text-danger">{p.major}</td>
                <td className="py-2 pr-4 text-right font-tabular text-xs">{p.total}</td>
              </tr>
            ))}
          </SimpleTable>
        </div>
      </div>
    </div>
  );
}

// ── AI readiness ───────────────────────────────────────────────────────────
function AiTab({ data }: { data: GapAnalysisResponse }) {
  const a = data.aiReadiness;
  const m = a.skillMix;
  const total = m.aiNative + m.aiAugmented + m.aiDisplaceable + m.neutral;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-text-tertiary">
        AI readiness measured from the curriculum skills ({a.scoredPrograms} programs). KKU curricula are
        currently <span className="font-medium text-text-secondary">AI-thin</span>: across the whole portfolio
        only <span className="font-medium text-text-secondary">{m.aiNative}</span> AI-native skills are taught,
        so most programs sit at &ldquo;neutral&rdquo; resilience (50) — neither AI-native nor AI-displaceable.
        The gap is the broad <em>absence</em> of AI content.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Avg resilience" value={`${a.avgResilience ?? '—'}`} hint="50 = neutral" tip="Skill resilience: 50 = neutral mix; above 50 = more AI-native/augmented than AI-displaceable skills; below 50 = curriculum skewed to AI-displaceable tasks." />
        <Kpi label="AI-native skills" value={m.aiNative} hint={`${pct(m.aiNative)}% of skills`} ink="text-success" tip="Explicit AI/ML/DL/LLM/NLP/CV/data-science skills taught across the portfolio." />
        <Kpi label="AI-augmented" value={m.aiAugmented} hint={`${pct(m.aiAugmented)}%`} ink="text-info" tip="Judgment / design / strategy skills that AI augments rather than replaces." />
        <Kpi label="AI-displaceable" value={m.aiDisplaceable} hint={`${pct(m.aiDisplaceable)}%`} ink="text-warning" tip="Rote / repetitive skills most exposed to automation." />
        <Kpi label="Avg AI integration" value={`${a.avgIntegration ?? '—'}`} hint="/ 100" tip="Weighted AI-native share of the curriculum (0 for programs that teach no AI skills). Near-zero across most programs — included for transparency." />
      </div>
      <div>
        <h4 className="mb-1.5 text-sm font-semibold text-text-primary">Least AI-resilient programs</h4>
        <SimpleTable head={<tr><th className="px-4 py-2">Program</th><th className="py-2 text-right">Resilience</th><th className="py-2 text-right">AI-native</th><th className="py-2 pr-4 text-right">AI-displaceable</th></tr>}>
          {a.worstPrograms.map((p) => (
            <tr key={p.programId} className="border-t border-border-subtle hover:bg-surface-2/40">
              <RefCell p={p} />
              <td className={`py-2 text-right font-tabular text-xs font-semibold ${p.skillResilience < 50 ? 'text-warning' : ''}`}>{p.skillResilience}</td>
              <td className="py-2 text-right font-tabular text-xs text-success">{p.aiNative}</td>
              <td className="py-2 pr-4 text-right font-tabular text-xs text-warning">{p.aiDisplaceable}</td>
            </tr>
          ))}
        </SimpleTable>
      </div>
    </div>
  );
}

// ── Recruitment ────────────────────────────────────────────────────────────
function RecruitmentTab({ data }: { data: GapAnalysisResponse }) {
  const r = data.recruitment;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-tertiary">
        Recruitment health ({r.coveredPrograms} programs with admission-campaign data) — fill rate vs plan,
        applicants per planned seat, and registration yield. Worst-first.
      </p>
      <SimpleTable head={<tr><th className="px-4 py-2">Program</th><th className="py-2 text-right">Year (BE)</th><th className="py-2 text-right">Fill vs plan</th><th className="py-2 text-right">Applicants/seat</th><th className="py-2 pr-4 text-right">Reg. yield</th></tr>}>
        {r.underFilling.map((p) => (
          <tr key={p.programId} className="border-t border-border-subtle hover:bg-surface-2/40">
            <RefCell p={p} />
            <td className="py-2 text-right font-tabular text-xs text-text-tertiary">{p.entryYearBE}</td>
            <td className={`py-2 text-right font-tabular text-xs font-semibold ${p.fillRateVsPlan < 80 ? 'text-danger' : 'text-text-primary'}`}>{p.fillRateVsPlan}%</td>
            <td className={`py-2 text-right font-tabular text-xs ${p.competitionRatio < 1.5 ? 'text-warning' : ''}`}>{p.competitionRatio.toFixed(2)}</td>
            <td className="py-2 pr-4 text-right font-tabular text-xs">{p.registrationYield !== null ? `${p.registrationYield}%` : '—'}</td>
          </tr>
        ))}
      </SimpleTable>
    </div>
  );
}

// ── Staff capability ───────────────────────────────────────────────────────
function StaffTab({ data }: { data: GapAnalysisResponse }) {
  const s = data.staff;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-tertiary">
        Staff capability ({s.coveredPrograms} programs with roster data) — succession risk (retiring ≤5y),
        ageing, senior-rank share, and 3-yr research output per active head. Worst-first.
      </p>
      <SimpleTable head={<tr><th className="px-4 py-2">Program</th><th className="py-2 text-right">Active</th><th className="py-2 text-right">Succession ≤5y</th><th className="py-2 text-right">Avg age</th><th className="py-2 text-right">Senior %</th><th className="py-2 pr-4 text-right">Pubs/head</th></tr>}>
        {s.atRisk.map((p) => (
          <tr key={p.programId} className="border-t border-border-subtle hover:bg-surface-2/40">
            <RefCell p={p} />
            <td className="py-2 text-right font-tabular text-xs text-text-tertiary">{p.active}</td>
            <td className={`py-2 text-right font-tabular text-xs font-semibold ${p.successionRiskPct >= 30 ? 'text-danger' : ''}`}>{p.successionRiskPct}%</td>
            <td className="py-2 text-right font-tabular text-xs">{p.avgAgeYears ?? '—'}</td>
            <td className="py-2 text-right font-tabular text-xs">{p.seniorShare}%</td>
            <td className={`py-2 pr-4 text-right font-tabular text-xs ${p.pubsPerHead < 1 ? 'text-warning' : ''}`}>{p.pubsPerHead.toFixed(1)}</td>
          </tr>
        ))}
      </SimpleTable>
    </div>
  );
}

// ── Demographic ────────────────────────────────────────────────────────────
function DemographicTab({ data }: { data: GapAnalysisResponse }) {
  const d = data.demographic;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-tertiary">
        Demographic ceiling ({d.coveredPrograms} programs with recruitment data) — projecting today&rsquo;s
        applicants-per-seat against the shrinking 18–22 cohort (NESDC). &ldquo;Super-critical&rdquo; = falling
        below 1.5 applicants/seat. The national 18–22 cohort contracts ~{Math.round(d.contraction15yPct)}% over 15 years.
      </p>
      <SimpleTable head={<tr><th className="px-4 py-2">Program</th><th className="py-2 text-right">Applicants/seat now</th><th className="py-2 pr-4 text-right">Super-critical year</th></tr>}>
        {d.superCritical.map((p) => (
          <tr key={p.programId} className="border-t border-border-subtle hover:bg-surface-2/40">
            <RefCell p={p} />
            <td className={`py-2 text-right font-tabular text-xs ${p.competitionNow < 1.5 ? 'text-danger' : ''}`}>{p.competitionNow.toFixed(2)}</td>
            <td className="py-2 pr-4 text-right font-tabular text-xs font-semibold text-warning">
              {p.superCriticalYear !== null ? `BE ${p.superCriticalYear + 543} (CE ${p.superCriticalYear})` : '—'}
            </td>
          </tr>
        ))}
      </SimpleTable>
      {d.superCritical.length === 0 && (
        <p className="text-sm text-text-tertiary">No program is projected to fall super-critical within 15 years on current applicant ratios.</p>
      )}
    </div>
  );
}

// ── White-space ────────────────────────────────────────────────────────────
function WhiteSpaceTab({ data }: { data: GapAnalysisResponse }) {
  const w = data.whiteSpace;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-text-tertiary">
        White-spaces KKU could fill. Top: high labour-market demand (LinkedIn, subscribed by MHESI) that KKU
        graduates barely supply — potential new program / track areas. Bottom: curriculum topics flagged as
        gaps across ≥{w.minPrograms} programs (broad investment candidates).
      </p>

      <div>
        <h4 className="mb-1.5 text-sm font-semibold text-text-primary">High market demand, little KKU supply</h4>
        {w.marketGaps.length === 0 ? <Empty /> : (
          <SimpleTable head={<tr><th className="px-4 py-2">Skill / field</th><th className="py-2 text-right">Demand</th><th className="py-2 pr-4">Top careers</th></tr>}>
            {w.marketGaps.map((m) => (
              <tr key={m.skillId} className="border-t border-border-subtle">
                <td className="px-4 py-1.5"><div className="leading-tight font-medium text-text-primary">{m.nameEn}<div className="text-[10px] font-normal text-text-tertiary" lang="th">{m.nameTh}</div></div></td>
                <td className="py-1.5 text-right font-tabular text-xs font-semibold text-warning">{m.demand}</td>
                <td className="py-1.5 pr-4 text-[11px] text-text-tertiary">{m.topCareers.join(' · ') || '—'}</td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </div>

      <div>
        <h4 className="mb-1.5 text-sm font-semibold text-text-primary">Systemic content gaps (≥{w.minPrograms} programs)</h4>
        <SimpleTable head={<tr><th className="px-4 py-2">Topic</th><th className="py-2 text-right">Programs</th><th className="py-2 text-right">Major</th><th className="py-2 pr-4">Faculties (sample)</th></tr>}>
          {w.systemicTopics.map((t) => (
            <tr key={t.topic} className="border-t border-border-subtle">
              <td className="px-4 py-1.5 font-medium text-text-primary">{t.topic}</td>
              <td className="py-1.5 text-right font-tabular text-xs font-semibold">{t.programCount}</td>
              <td className="py-1.5 text-right font-tabular text-xs text-danger">{t.majorCount}</td>
              <td className="py-1.5 pr-4 text-[11px] text-text-tertiary" lang="th">{t.sampleFaculties.join(' · ')}</td>
            </tr>
          ))}
        </SimpleTable>
      </div>

      <p className="text-[11px] leading-relaxed text-text-tertiary">{w.staffExpertiseNote}</p>
    </div>
  );
}

function Empty() {
  return <Card padding="md"><p className="text-center text-xs text-text-tertiary">No data.</p></Card>;
}
