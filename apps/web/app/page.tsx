import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { redirect } from 'next/navigation';
import {
  AiInsight,
  Button,
  Card,
  CardHeader,
  CardTitle,
  ChartFrame,
  DataTable,
  EmptyState,
  KPI,
  PageHeader,
  Section,
  Sparkline,
  Stat,
  TrendLine,
  type ColumnDef,
} from '@kku/ui';
import type {
  ApiMeta,
  FacultyDto,
  MeResponse,
  ProgramDto,
  SessionUser,
} from '@kku/shared';
import { AuthedAppShell } from '@/components/shell/app-shell-server';

export const dynamic = 'force-dynamic';

const SAMPLE_TREND = [
  { x: '2020', enrolled: 2450, applications: 7800 },
  { x: '2021', enrolled: 2380, applications: 8100 },
  { x: '2022', enrolled: 2794, applications: 8900 },
  { x: '2023', enrolled: 3002, applications: 9600 },
  { x: '2024', enrolled: 3075, applications: 10096 },
];

const SAMPLE_META: ApiMeta = {
  freshnessDate: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
  sources: [
    { id: 'kku-reg', name: 'KKU Registration' },
    { id: 'kku-finance', name: 'KKU Finance (projected)' },
  ],
  methodologyVersion: 'v1',
  scope: { level: 'university', id: null },
};

const programColumns: ColumnDef<ProgramDto, unknown>[] = [
  { accessorKey: 'code', header: 'Code' },
  { accessorKey: 'nameEn', header: 'Program (EN)' },
  { accessorKey: 'nameTh', header: 'Program (TH)' },
  { accessorKey: 'level', header: 'Level' },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { align: 'right' },
  },
];

export default async function HomePage() {
  const session = await auth();
  if (!session?.user || !(session.user as SessionUser).userId) {
    redirect('/signin');
  }
  const user = session.user as SessionUser;
  // Council + senior-leadership roles land on the cockpit by default
  // (prompt 05 contract). Analysts stay on this overview page which
  // doubles as the "everything at once" snapshot used during build.
  if (
    user.role === 'COUNCIL' ||
    user.role === 'EXECUTIVE' ||
    user.role === 'DEAN' ||
    user.role === 'DEPT_HEAD'
  ) {
    redirect('/cockpit');
  }

  const [me, faculties, programsResponse] = await Promise.all([
    apiFetch<MeResponse>('/me').catch(() => null),
    apiFetch<FacultyDto[]>('/faculties').catch(() => []),
    apiFetch<ProgramDto[]>('/programs?scope=university').catch(() => []),
  ]);
  const programs = Array.isArray(programsResponse) ? programsResponse : [];

  return (
    <AuthedAppShell user={user}>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-8 p-6">
        <PageHeader
          title="Portfolio overview"
          subtitle="Prompt 02b shell. KPIs are mock values; the table is live via /api/v1/programs."
          actions={
            <Button variant="outline" size="sm" asChild>
              <a href="/styleguide">Open styleguide →</a>
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <KPI
            label="Active programs"
            value={<span className="font-tabular">{programs.length}</span>}
            meta={SAMPLE_META}
            sparkline={<Sparkline data={[28, 29, 29, 30, 30]} />}
          />
          <KPI
            label="Enrolled (2024)"
            value={<span className="font-tabular">3,075</span>}
            delta={{ value: 2.4, goodDirection: 'up', display: '+2.4% YoY' }}
            meta={SAMPLE_META}
            sparkline={<Sparkline data={[2450, 2380, 2794, 3002, 3075]} tone="positive" />}
          />
          <KPI
            label="Applications (2024)"
            value={<span className="font-tabular">10,096</span>}
            delta={{ value: 5.2, goodDirection: 'up', display: '+5.2% YoY' }}
            meta={SAMPLE_META}
          />
          <KPI
            label="Net contribution (2024)"
            value={<span className="font-tabular">฿3.67M</span>}
            delta={{ value: -8.1, goodDirection: 'up', display: '−8.1% YoY' }}
            meta={SAMPLE_META}
          />
        </div>

        <Section
          title="Enrolment & applications"
          description="University scope, last five academic years."
        >
          <ChartFrame
            title="Enrolment vs applications"
            description="Pipeline conversion across the last five years."
            meta={SAMPLE_META}
            chart={
              <TrendLine
                data={SAMPLE_TREND}
                series={['applications', 'enrolled']}
                ariaLabel="Applications and enrolment, 2020–2024"
              />
            }
            dataTable={
              <DataTable<(typeof SAMPLE_TREND)[number]>
                columns={[
                  { accessorKey: 'x', header: 'Year' },
                  {
                    accessorKey: 'applications',
                    header: 'Applications',
                    meta: { numeric: true },
                  },
                  {
                    accessorKey: 'enrolled',
                    header: 'Enrolled',
                    meta: { numeric: true },
                  },
                ]}
                data={SAMPLE_TREND}
                variant="ghost"
              />
            }
          />
        </Section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="mb-3">
              <CardTitle>Programs ({programs.length})</CardTitle>
            </CardHeader>
            {programs.length === 0 ? (
              <EmptyState
                title="No programs returned"
                description="Is the API running on port 4000?"
                action={
                  <Button variant="outline" size="sm" asChild>
                    <a href="http://localhost:4000/api/v1/healthz">Check API</a>
                  </Button>
                }
              />
            ) : (
              <DataTable<ProgramDto>
                columns={programColumns}
                data={programs}
                pageSize={12}
                variant="ghost"
              />
            )}
          </Card>

          <div className="flex flex-col gap-4">
            <Card padding="md">
              <CardHeader className="mb-3">
                <CardTitle>Your access</CardTitle>
              </CardHeader>
              {me ? (
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Role" value={me.role} />
                  <Stat label="Permissions" value={me.permissions.length} />
                  <Stat label="Faculty" value={me.scopeAccess.ownFacultyId ?? '—'} />
                  <Stat label="Department" value={me.scopeAccess.ownDepartmentId ?? '—'} />
                </div>
              ) : (
                <p className="text-sm text-text-tertiary">/me unavailable</p>
              )}
            </Card>

            <AiInsight
              title="Enrolment summary (mock)"
              confidence={0.78}
              sources={[{ id: 'kku-reg', name: 'KKU Registration, 2020–2024' }]}
              reasoning="Mock reasoning: enrolment has risen every year since the COVID dip in 2021; conversion from applications has remained flat, suggesting capacity is the bottleneck rather than demand."
            >
              Enrolment is up <strong>25.5%</strong> across the five-year window,
              while applications have grown <strong>29.4%</strong>. The two curves
              are diverging gently — a capacity signal, not a demand signal. Real
              AI wiring lands in prompt 04.
            </AiInsight>
          </div>
        </div>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {faculties.map((f) => (
            <Card key={f.id} padding="sm">
              <CardHeader className="mb-0">
                <CardTitle>{f.nameEn}</CardTitle>
              </CardHeader>
              <div className="text-xs text-text-tertiary">
                {f.code} · {f.nameTh}
              </div>
            </Card>
          ))}
        </section>
      </div>
    </AuthedAppShell>
  );
}
