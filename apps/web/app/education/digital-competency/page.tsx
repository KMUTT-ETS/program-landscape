import { orgShortNamesForRequest } from '@/lib/branding';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { Badge, Card, PageHeader } from '@kku/ui';
import type {
  DqLensDemandDto,
  DqSkillConfidenceDto,
  DqSkillLensResponse,
  DqSkillLensRowDto,
  // The lens still reads /gap/digital-competency, so its DTOs stay beside
  // the Gap Analyzer's; only the page moved. `@/…` is aliased to `src/`, not
  // to the app root, so this import is relative.
} from '../../gap-analysis/types';

// Digital-competency attainment lens.
//
// The Gap Analyzer infers supply from what programmes TEACH. This page
// shows what students demonstrably ACQUIRED, measured by KKU's Digital
// Intelligence (DQ) test. It is a separate axis and it modifies nothing:
// no figure on /gap-analysis is derived from anything here. That is why
// it lives under /education rather than inside the Gap Analyzer — the old
// /gap-analysis/digital-competency URL redirects here.
//
// Server component throughout — no client bundle, so no runtime
// @kku/shared or @kku/db import can leak into one.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Digital Competency Attainment' };

const CONFIDENCE_BADGE: Record<
  DqSkillConfidenceDto,
  { label: string; tone: 'success' | 'warning' | 'outline' }
> = {
  exact: { label: 'Exact match', tone: 'success' },
  near: { label: 'Near match — read the caveat', tone: 'warning' },
  none: { label: 'No taxonomy counterpart', tone: 'outline' },
};

// The note means something different per verdict, so it is labelled per
// verdict. A `near` note is the reason not to trust the pairing at face
// value; a `none` note is the record of what was looked for.
const NOTE_LABEL: Record<DqSkillConfidenceDto, string> = {
  exact: 'Note: ',
  near: 'Caveat: ',
  none: 'What was searched for: ',
};

export default async function DigitalCompetencyPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; scopeId?: string }>;
}) {
  const org = await orgShortNamesForRequest();
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const qs = new URLSearchParams({ scope: sp.scope ?? 'university' });
  if (sp.scopeId) qs.set('scopeId', sp.scopeId);

  const res = await apiFetchSafe<DqSkillLensResponse>(`/gap/digital-competency?${qs}`);
  const data = res.ok ? res.data : null;

  const mapped = data?.rows.filter((r) => r.confidence !== 'none') ?? [];
  const unmapped = data?.rows.filter((r) => r.confidence === 'none') ?? [];
  // Demand first where there is any, so the lens leads with the rows it
  // can actually place against the labour market.
  const mappedSorted = [...mapped].sort(
    (a, b) => demandOf(b) - demandOf(a) || a.moduleNo - b.moduleNo,
  );

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Digital Competency Attainment"
        subtitle={`What ${org.en} students measurably score on the digital competencies the labour market asks for — measured attainment, not taught coverage.`}
      />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
          <Link href="/education" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            ← Back to Education
          </Link>
          <Link href="/education/student-dq" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            Student DQ scores →
          </Link>
          <Link href="/gap-analysis" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            Gap Analyzer →
          </Link>
        </div>

        <Card padding="md">
          <h3 className="text-sm font-semibold text-text-primary">
            A separate axis — nothing else on the Gap Analyzer moves
          </h3>
          <div className="mt-2 flex flex-col gap-2 text-xs leading-relaxed text-text-secondary">
            <p>
              Every other gap figure computes supply as{' '}
              <span className="font-medium text-text-primary">what a programme teaches</span> ×
              its graduate count — it assumes a skill taught is a skill acquired. The DQ test is
              the only evidence in the platform that measures whether students{' '}
              <span className="font-medium text-text-primary">actually acquired</span> a
              competency. That makes this new information rather than a second opinion, so it sits
              beside the existing output and changes none of it.
            </p>
            <p>
              Demand is LinkedIn labour-market data, subscribed by MHESI. KMITL hosts the API and
              nothing else.
            </p>
          </div>
        </Card>

        {!data ? (
          <DiagnosticEmptyState surface="digital-competency lens" error={res.ok ? null : res.error} />
        ) : (
          <>
            <Card padding="md">
              <h3 className="text-sm font-semibold text-text-primary">
                How far the mapping reaches
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="Exact taxonomy match"
                  value={String(data.counts.exact)}
                  unit={`of ${data.rows.length} DQ modules`}
                />
                <Stat
                  label="Near match, with caveat"
                  value={String(data.counts.near)}
                  unit={`of ${data.rows.length} DQ modules`}
                />
                <Stat
                  label="No counterpart at all"
                  value={String(data.counts.none)}
                  unit={`of ${data.rows.length} DQ modules`}
                  emphasis="warning"
                />
                <Stat
                  label="Carrying Thailand demand"
                  value={String(data.counts.withThailandDemand)}
                  unit={`of ${data.counts.exact + data.counts.near} mapped skills`}
                  emphasis={data.counts.withThailandDemand === 0 ? 'warning' : undefined}
                />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-text-secondary">
                In the Thailand × job-postings quadrant — the one the Gap Analyzer&rsquo;s demand
                figures read —{' '}
                <span className="font-medium text-text-primary">
                  {data.thailandQuadrantSkillRows.toLocaleString()} rows resolved to a taxonomy
                  skill, of {data.thailandQuadrantRows.toLocaleString()} in the quadrant
                </span>
                , and none of those resolved rows is one of the mapped digital skills. The global
                quadrant is shown alongside it so that an empty Thailand reading is legible as a
                sample-size fact rather than as absent demand. Neither figure is substituted for
                the other.
              </p>
            </Card>

            <Card padding="md">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 className="text-sm font-semibold text-text-primary">
                  Mapped competencies
                </h3>
                <span className="text-xs text-text-tertiary">
                  {mappedSorted.length} of {data.rows.length} DQ modules · demand against measured
                  attainment
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary">
                      <th className="py-2 pr-3">DQ module</th>
                      <th className="py-2 pr-3">Skill-taxonomy row</th>
                      <th className="py-2 pr-3 text-right">Demand — Thailand</th>
                      <th className="py-2 pr-3 text-right">Demand — global</th>
                      <th className="py-2 pr-3 text-right">Measured score</th>
                      <th className="py-2 pr-3 text-right">Took the module</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappedSorted.map((r) => (
                      <ModuleRows key={r.moduleKey} row={r} columns={6} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card padding="md">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 className="text-sm font-semibold text-text-primary">
                  Competencies with no taxonomy counterpart
                </h3>
                <span className="text-xs text-text-tertiary">
                  {unmapped.length} of {data.rows.length} DQ modules · no demand signal can be
                  attached
                </span>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-text-secondary">
                These are measured and scored, but the skill taxonomy holds no row that means the
                same thing — it is built from curriculum extraction and carries almost no
                general digital-competency vocabulary. There is no &ldquo;Computer Basics&rdquo;,
                no &ldquo;Word Processing&rdquo;, and the only &ldquo;Internet&rdquo; entries are
                Internet of Things and TCP/IP. The absence is the finding: it is a worklist for
                whoever curates the taxonomy, not a gap in the DQ data. Two of them — Word
                Processing and Spreadsheet — are among the lowest-scoring competencies in the
                whole test, so their weakest programmes are still named below.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary">
                      <th className="py-2 pr-3">DQ module</th>
                      <th className="py-2 pr-3">Skill-taxonomy row</th>
                      <th className="py-2 pr-3 text-right">Measured score</th>
                      <th className="py-2 pr-3 text-right">Took the module</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmapped.map((r) => (
                      <ModuleRows key={r.moduleKey} row={r} columns={4} hideDemand />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card padding="md">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 className="text-sm font-semibold text-text-primary">
                  Weakest programmes on each competency
                </h3>
                <span className="text-xs text-text-tertiary">
                  lowest {WEAKEST_SHOWN} per module · programmes with at least 5 students who took it
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.rows.map((r) => (
                  <WeakestCard key={r.moduleKey} row={r} />
                ))}
              </div>
            </Card>

            <p className="text-xs leading-relaxed text-text-tertiary">
              Attainment is{' '}
              <code className="rounded-md bg-surface-2 px-1 py-0.5 font-mono text-[10px]">
                SUM(score_sum) / SUM(taken_count)
              </code>{' '}
              at the scope shown — never an average of programme means. Bachelor programmes only:
              DQ is an undergraduate instrument. Methodology{' '}
              <code className="rounded-md bg-surface-2 px-1 py-0.5 font-mono text-[10px]">
                {data.methodologyVersion}
              </code>
              . The module → skill pairing is a hand-curated judgement about vocabulary
              equivalence and needs an analyst&rsquo;s sign-off before it drives a Council
              decision.
              {data.dqRefreshedAt && (
                <> DQ cubes last refreshed {new Date(data.dqRefreshedAt).toLocaleString()}.</>
              )}
            </p>
          </>
        )}
      </div>
    </AuthedAppShell>
  );
}

const WEAKEST_SHOWN = 5;

function demandOf(r: DqSkillLensRowDto): number {
  return (r.demandThailand?.demand ?? 0) * 1000 + (r.demandGlobal?.demand ?? 0);
}

/**
 * One module as a data row plus a full-width caveat row beneath it.
 *
 * The caveat is a row of its own rather than a tooltip because it is the
 * thing a reader most needs and least expects: a `near` pairing is not
 * the same competency, and module 7 is the sharp case — DQ tests whether
 * a student can drive presentation software, while the taxonomy's
 * "Academic Presentation" is about the act of presenting.
 */
function ModuleRows({
  row,
  columns,
  hideDemand = false,
}: {
  row: DqSkillLensRowDto;
  columns: number;
  hideDemand?: boolean;
}) {
  const badge = CONFIDENCE_BADGE[row.confidence];
  return (
    <>
      <tr className="border-b border-subtle">
        <td className="py-2 pr-3 align-top">
          <div className="font-medium text-text-primary">
            {row.moduleNo}. {row.moduleNameEn}
          </div>
          {row.moduleNameTh && (
            <div className="text-xs text-text-tertiary">{row.moduleNameTh}</div>
          )}
        </td>
        <td className="py-2 pr-3 align-top">
          {row.skillNameEn ? (
            <div className="font-medium text-text-primary">{row.skillNameEn}</div>
          ) : (
            <div className="text-text-tertiary">—</div>
          )}
          <div className="mt-1">
            <Badge tone={badge.tone} size="sm">
              {badge.label}
            </Badge>
          </div>
        </td>
        {!hideDemand && (
          <>
            <td className="py-2 pr-3 text-right align-top">
              <DemandCell
                reading={row.demandThailand}
                emptyLabel="No rows in the Thailand sample"
              />
            </td>
            <td className="py-2 pr-3 text-right align-top">
              <DemandCell reading={row.demandGlobal} emptyLabel="Not in the global sample" />
            </td>
          </>
        )}
        <td className="py-2 pr-3 text-right align-top">
          {row.mean === null ? (
            <span className="text-xs text-text-tertiary">withheld — too few students</span>
          ) : (
            <span className="font-mono text-sm text-text-primary">{row.mean.toFixed(1)}</span>
          )}
        </td>
        <td className="py-2 pr-3 text-right align-top">
          <div className="font-mono text-xs text-text-secondary">
            {row.takenCount.toLocaleString()}
          </div>
          <div className="text-xs text-text-tertiary">
            {row.coveragePct === null
              ? 'coverage unknown'
              : `${row.coveragePct.toFixed(0)}% of those tested`}
          </div>
        </td>
      </tr>
      <tr className="border-b border-subtle">
        <td colSpan={columns} className="pb-3 pr-3">
          {/* Only `border-default` / `-strong` / `-subtle` exist as border
              colours in the design tokens — there is no `border-warning`,
              so the caveat is marked by a stronger rule plus a warning-
              coloured label rather than a coloured rule. */}
          <div
            className={`border-l-2 pl-3 text-xs leading-relaxed ${
              row.confidence === 'near'
                ? 'border-strong text-text-secondary'
                : 'border-subtle text-text-tertiary'
            }`}
          >
            <span
              className={`font-medium ${
                row.confidence === 'near' ? 'text-warning' : 'text-text-primary'
              }`}
            >
              {NOTE_LABEL[row.confidence]}
            </span>
            {row.note}
          </div>
        </td>
      </tr>
    </>
  );
}

/**
 * A demand figure with the careers it came from named underneath.
 *
 * The API contract is aggregate-only and carries no employer names, so
 * the careers are the only way a reader can check that the number is
 * about the competency they think it is — a demand figure with no
 * inspectable sample is a figure nobody can challenge.
 */
function DemandCell({
  reading,
  emptyLabel,
}: {
  reading: DqLensDemandDto | null;
  emptyLabel: string;
}) {
  if (reading === null) {
    return <span className="text-xs text-text-tertiary">{emptyLabel}</span>;
  }
  return (
    <>
      <div className="font-mono text-sm text-text-primary">{reading.demand.toFixed(2)}</div>
      <div className="text-xs text-text-tertiary">
        across {reading.careerCount.toLocaleString()}{' '}
        {reading.careerCount === 1 ? 'career' : 'careers'}
      </div>
      {reading.topCareers.length > 0 && (
        <div className="mt-1 text-xs leading-snug text-text-tertiary">
          {reading.topCareers.join(' · ')}
          {reading.careerCount > reading.topCareers.length && ' · …'}
        </div>
      )}
    </>
  );
}

function WeakestCard({ row }: { row: DqSkillLensRowDto }) {
  return (
    <div className="rounded-md border border-subtle p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-text-primary">
          {row.moduleNo}. {row.moduleNameEn}
        </span>
        <span className="font-mono text-xs text-text-secondary">
          {row.mean === null ? '—' : row.mean.toFixed(1)}
        </span>
      </div>
      <div className="text-xs text-text-tertiary">
        {row.confidence === 'none' ? 'no taxonomy counterpart' : row.skillNameEn}
      </div>
      {row.weakestPrograms.length === 0 ? (
        <p className="mt-2 text-xs text-text-tertiary">
          No programme clears the 5-student floor on this module at the current scope.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {row.weakestPrograms.map((p) => (
            <li key={p.programId} className="flex items-baseline justify-between gap-3">
              <Link
                href={`/programs/${p.programId}`}
                className="text-xs text-text-secondary hover:underline"
              >
                {p.nameEn}
              </Link>
              {/* Explicit separator, not a margin: `75.6` and `n = 14`
                  set with only spacing between them read — and copy —
                  as the single token `75.6n = 14`. */}
              <span className="shrink-0 text-right">
                <span className="font-mono text-xs text-text-primary">{p.mean.toFixed(1)}</span>
                <span className="text-xs text-text-tertiary">
                  {' · '}n = {p.takenCount.toLocaleString()}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  emphasis,
}: {
  label: string;
  value: string;
  unit: string;
  emphasis?: 'warning';
}) {
  return (
    <div className="rounded-md border border-subtle p-3">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div
        className={`mt-1 font-mono text-2xl ${
          emphasis === 'warning' ? 'text-warning' : 'text-text-primary'
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-text-tertiary">{unit}</div>
    </div>
  );
}
