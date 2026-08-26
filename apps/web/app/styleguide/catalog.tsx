'use client';

import * as React from 'react';
import {
  AiInsight,
  AiNarrative,
  Badge,
  Banner,
  Button,
  Card,
  CardHeader,
  CardTitle,
  ChartFrame,
  ConfidenceBadge,
  DataTable,
  Divider,
  EdgeGlow,
  EmptyState,
  FreshnessBadge,
  Input,
  KPI,
  Label,
  PageHeader,
  ProvenanceButton,
  Section,
  Segmented,
  SegmentedList,
  SegmentedTrigger,
  Skeleton,
  Sparkline,
  Stat,
  TrendLine,
  type ColumnDef,
} from '@kku/ui';
import { Sparkles } from 'lucide-react';
import type { ApiMeta } from '@kku/shared';

const DENSITY_MODES = ['compact', 'comfortable', 'spacious'] as const;
type Density = (typeof DENSITY_MODES)[number];

const META: ApiMeta = {
  freshnessDate: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  sources: [
    { id: 'kku-reg', name: 'KKU Registration' },
    { id: 'nso', name: 'National Statistical Office' },
  ],
  methodologyVersion: 'v1',
  scope: { level: 'university', id: null },
};

const TREND = [
  { x: '2020', a: 120, b: 80 },
  { x: '2021', a: 118, b: 95 },
  { x: '2022', a: 140, b: 110 },
  { x: '2023', a: 152, b: 128 },
  { x: '2024', a: 161, b: 139 },
];

type Row = { name: string; value: number; pct: number };
const ROWS: Row[] = [
  { name: 'Computer Engineering', value: 196, pct: 0.34 },
  { name: 'Electrical Engineering', value: 164, pct: 0.22 },
  { name: 'Mechanical Engineering', value: 142, pct: 0.18 },
  { name: 'Mathematics', value: 72, pct: 0.11 },
  { name: 'Biology', value: 68, pct: 0.08 },
];

export function StyleguideCatalog() {
  const [density, setDensity] = React.useState<Density>('comfortable');

  React.useEffect(() => {
    document.documentElement.dataset.density = density;
    return () => {
      // Reset to default when leaving the styleguide so density doesn't
      // leak into module pages. (Persistence lives in the user menu.)
      document.documentElement.dataset.density = 'comfortable';
    };
  }, [density]);

  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: 'name', header: 'Program' },
    { accessorKey: 'value', header: 'Count', meta: { numeric: true } },
    {
      accessorKey: 'pct',
      header: 'Share',
      meta: { numeric: true },
      cell: ({ getValue }) => `${Math.round(Number(getValue()) * 100)}%`,
    },
  ];

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-10 p-6">
      <PageHeader
        title="Styleguide"
        subtitle="Every primitive the app can render. Switch theme in the user menu; density below."
        actions={
          <DensityToggle value={density} onChange={setDensity} />
        }
      />

      {/* ── 2026-05-02 redesign showcase ───────────────────────────── */}
      <Section
        title="Redesign — pastel coral · glossy · razor edges"
        description="2026-05-02 visual refresh. Pill buttons, glossy Card variant, animated edge glow, Sarabun primary."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <EdgeGlow>
            <Card padding="lg" tone="glossy" className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-accent-default">
                <Sparkles className="size-icon-sm" aria-hidden /> Hero CTA
              </div>
              <h3 className="text-2xl font-semibold text-text-primary">
                Run analyse-the-landscape on the next 44 programs
              </h3>
              <p className="text-sm text-text-secondary">
                Glossy Card + EdgeGlow + pill primary button. The edge gradient
                rotates every 4.5s and respects <code className="font-mono text-xs">prefers-reduced-motion</code>.
              </p>
              <div className="mt-2 flex items-center gap-3">
                <Button variant="primary">Start digest</Button>
                <Button variant="outline">Inspect bucket</Button>
                <Button variant="ghost">Cancel</Button>
              </div>
            </Card>
          </EdgeGlow>

          <Card padding="lg" tone="glossy" className="flex flex-col gap-3">
            <CardHeader>
              <CardTitle>Glossy without edge glow</CardTitle>
            </CardHeader>
            <p className="text-sm text-text-secondary">
              Use the glossy tone for hero blocks and primary KPIs. The
              gradient is subtle — peach-cream highlight at the top fading
              into surface-1, with elevation-2 shadow.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <KPI label="Digested" value="228" />
              <KPI label="Pending review" value="0" />
            </div>
          </Card>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <EdgeGlow inline>
            <Button variant="primary" size="lg">
              Pill button + edge
            </Button>
          </EdgeGlow>
          <EdgeGlow
            inline
            colors={[
              'oklch(72% 0.155 150)',
              'oklch(78% 0.140 130)',
              'oklch(82% 0.130 95)',
            ]}
          >
            <Button variant="default" size="lg">
              Custom green edge
            </Button>
          </EdgeGlow>
          <EdgeGlow inline speed="2s" thickness="2px">
            <Button variant="outline" size="lg">
              Faster · thicker
            </Button>
          </EdgeGlow>
        </div>
      </Section>

      {/* ── Typography ─────────────────────────────────────────────── */}
      <Section title="Typography" description="Sarabun (primary, screen + Thai) · JetBrains Mono (tabular)">
        <Card padding="lg" className="flex flex-col gap-4">
          <div className="font-sans text-display font-semibold">
            ทักษทัศน์ — Curriculum Compass
          </div>
          <div className="text-3xl font-semibold">Strategic portfolio at a glance</div>
          <div className="text-2xl font-semibold">Section title example</div>
          <div className="text-xl font-medium">Subsection label</div>
          <div className="text-base">
            Body size — the same shape in Thai and Latin. รายงานสถานะหลักสูตร
            ประจำปี พ.ศ. 2568 แสดงแนวโน้มการลงทะเบียนของทั้งมหาวิทยาลัย
            (Thai text should break at word boundaries thanks to{' '}
            <code className="font-mono text-sm">word-break: keep-all</code>.)
          </div>
          <div className="text-sm text-text-secondary">Body small — for dense rows.</div>
          <div className="text-xs text-text-tertiary">Caption / helper text.</div>
          <div className="font-tabular">
            1,234,567 · 2024-04-22 · 98.5% · ฿72,938,817
          </div>
        </Card>
      </Section>

      {/* ── Surfaces ──────────────────────────────────────────────── */}
      <Section title="Surfaces & borders">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[0, 1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`flex h-16 items-center justify-center rounded-md border border-border-default bg-surface-${n as 0 | 1 | 2 | 3 | 4} text-xs text-text-tertiary`}
            >
              surface-{n}
            </div>
          ))}
        </div>
      </Section>

      {/* ── Colours ───────────────────────────────────────────────── */}
      <Section title="Accent, semantic, data sentiment">
        <div className="flex flex-wrap gap-3">
          <Swatch name="accent" className="bg-accent text-accent-fg" />
          <Swatch name="success" className="bg-success text-text-inverse" />
          <Swatch name="warning" className="bg-warning text-text-primary" />
          <Swatch name="danger" className="bg-danger text-text-inverse" />
          <Swatch name="info" className="bg-info text-text-inverse" />
          <Divider orientation="vertical" />
          <Swatch name="data-positive" className="bg-data-positive text-text-inverse" />
          <Swatch name="data-negative" className="bg-data-negative text-text-inverse" />
          <Swatch name="data-neutral" className="bg-data-neutral text-text-primary" />
        </div>
      </Section>

      {/* ── Chart palette ─────────────────────────────────────────── */}
      <Section title="Chart palette (12)">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              className={`h-10 w-10 rounded-md bg-chart-${n as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`}
              title={`chart-${n}`}
            />
          ))}
        </div>
      </Section>

      {/* ── Buttons ───────────────────────────────────────────────── */}
      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="xs">XS</Button>
          <Button size="sm">SM</Button>
          <Button size="md">MD</Button>
          <Button size="lg">LG</Button>
        </div>
      </Section>

      {/* ── Badges ────────────────────────────────────────────────── */}
      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>neutral</Badge>
          <Badge tone="accent">accent</Badge>
          <Badge tone="success">success</Badge>
          <Badge tone="warning">warning</Badge>
          <Badge tone="danger">danger</Badge>
          <Badge tone="info">info</Badge>
          <Badge tone="outline">outline</Badge>
        </div>
      </Section>

      {/* ── Council-readiness trio ────────────────────────────────── */}
      <Section title="Council-readiness trio (non-negotiable)">
        <Card padding="md" className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm">Provenance →</span>
            <ProvenanceButton title="Sample metric" meta={META} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FreshnessBadge freshnessDate={META.freshnessDate} label="enrolment" />
            <FreshnessBadge
              freshnessDate={new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString()}
              label="4-day-old sample"
            />
            <FreshnessBadge
              freshnessDate={new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString()}
              label="stale sample"
            />
            <FreshnessBadge freshnessDate={null} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceBadge value={0.92} rationale="Large sample, reliable source." />
            <ConfidenceBadge value={0.65} rationale="Partial data." />
            <ConfidenceBadge value={0.28} rationale="Early signal — verify." />
            <ConfidenceBadge value={null} />
          </div>
        </Card>
      </Section>

      {/* ── KPI + Stat ────────────────────────────────────────────── */}
      <Section title="KPI / Stat / Sparkline">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPI
            label="Enrolled, 2024"
            value="3,075"
            delta={{ value: 2.4, goodDirection: 'up', display: '+2.4% YoY' }}
            sparkline={<Sparkline tone="positive" data={[2450, 2380, 2794, 3002, 3075]} />}
            meta={META}
          />
          <KPI
            label="Graduates, 2023"
            value="2,168"
            delta={{ value: -1.2, goodDirection: 'up', display: '−1.2% YoY' }}
            sparkline={<Sparkline tone="negative" data={[2200, 2250, 2210, 2168]} />}
            meta={META}
          />
          <KPI label="Programs at risk" value="5" delta={{ value: 2, goodDirection: 'down', display: '+2 YoY' }} meta={META} />
          <KPI label="Net contribution" value="฿3.67M" meta={META} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card padding="sm">
            <Stat label="Freshness" value="2h ago" />
          </Card>
          <Card padding="sm">
            <Stat label="Confidence" value="0.78" hint="medium" />
          </Card>
          <Card padding="sm">
            <Stat label="Scope" value="University" hint="30 programs" />
          </Card>
          <Card padding="sm">
            <Stat label="Records" value="1,234,567" />
          </Card>
        </div>
      </Section>

      {/* ── DataTable ─────────────────────────────────────────────── */}
      <Section title="DataTable">
        <DataTable<Row> columns={columns} data={ROWS} variant="bordered" pageSize={10} />
      </Section>

      {/* ── Chart ─────────────────────────────────────────────────── */}
      <Section title="Chart frame + TrendLine">
        <ChartFrame
          title="Applications vs admitted"
          description="University scope, 5 years"
          meta={{ ...META, confidence: 0.88 }}
          chart={<TrendLine data={TREND} series={['a', 'b']} ariaLabel="Trend" />}
          dataTable={
            <DataTable
              columns={[
                { accessorKey: 'x', header: 'Year' },
                { accessorKey: 'a', header: 'Series A', meta: { numeric: true } },
                { accessorKey: 'b', header: 'Series B', meta: { numeric: true } },
              ]}
              data={TREND}
              variant="ghost"
            />
          }
        />
      </Section>

      {/* ── Banners ───────────────────────────────────────────────── */}
      <Section title="Banners (persistent notices)">
        <div className="flex flex-col gap-3">
          <Banner tone="info" title="Data refresh in progress" description="Last sync 12 minutes ago." />
          <Banner tone="success" title="Council pack exported" description="sent to Finance Division." />
          <Banner
            tone="warning"
            title="KKU SSO degraded"
            description="Falling back to dev credentials. Contact IT."
          />
          <Banner tone="danger" title="Ingestion failed" description="MHESI connector returned 503." />
        </div>
      </Section>

      {/* ── Inputs ────────────────────────────────────────────────── */}
      <Section title="Inputs">
        <Card padding="md" className="grid max-w-md gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="q">Search</Label>
            <Input id="q" placeholder="Find a program…" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="n">Threshold</Label>
            <Input id="n" type="number" placeholder="0.80" />
          </div>
        </Card>
      </Section>

      {/* ── Skeleton ──────────────────────────────────────────────── */}
      <Section title="Skeleton (not spinners)">
        <Card padding="md" className="grid gap-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-36 w-full" />
        </Card>
      </Section>

      {/* ── EmptyState ────────────────────────────────────────────── */}
      <Section title="EmptyState">
        <EmptyState
          title="No scenarios yet"
          description="Create a what-if to compare program portfolios."
          action={<Button variant="primary">New scenario</Button>}
        />
      </Section>

      {/* ── AI surfaces ───────────────────────────────────────────── */}
      <Section title="AI insight surfaces">
        <div className="grid gap-4 md:grid-cols-2">
          <AiInsight
            title="Mock: retention cliff"
            confidence={0.74}
            sources={[{ id: 'kku-reg', name: 'KKU Registration, 2020–2024' }]}
            reasoning="Year-2 retention has fallen 3 ppt each of the last two years, driven entirely by the Faculty of Humanities. The financial model masks this because tuition is recognised on enrolment rather than retention."
            onRegenerate={() => {}}
            onDisagree={() => {}}
          >
            <strong>Retention is weakening at the second-year gate.</strong>{' '}
            University-wide Y2 retention fell from 92% → 86% between 2022 and
            2024 — concentrated in the Faculty of Humanities. Prompt 09 will
            explore the scenarios.
          </AiInsight>
          <AiNarrative
            titleTh="บทสรุปแนวโน้มการลงทะเบียน"
            bodyTh="จำนวนผู้สมัครเข้าศึกษาทั้งมหาวิทยาลัยเพิ่มขึ้น 5.2% เทียบกับปีก่อน แต่การคงอยู่ในปีที่สองลดลงอย่างต่อเนื่อง โดยเฉพาะในคณะมนุษยศาสตร์ฯ"
            confidence={0.68}
            sources={[{ id: 'kku-reg', name: 'KKU REG · 2024' }]}
          />
        </div>
      </Section>
    </div>
  );
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className={`flex h-14 w-28 items-center justify-center rounded-md text-xs font-medium ${className}`}>
      {name}
    </div>
  );
}

function DensityToggle({
  value,
  onChange,
}: {
  value: Density;
  onChange: (v: Density) => void;
}) {
  return (
    <Segmented value={value} onValueChange={(v) => onChange(v as Density)}>
      <SegmentedList>
        {DENSITY_MODES.map((m) => (
          <SegmentedTrigger key={m} value={m} className="capitalize">
            {m}
          </SegmentedTrigger>
        ))}
      </SegmentedList>
    </Segmented>
  );
}
