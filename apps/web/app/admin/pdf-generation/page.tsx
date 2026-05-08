import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  EmptyState,
  PageHeader,
  Section,
} from '@kku/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PDF Generation — Admin' };

interface PdfGenerationRow {
  id: string;
  templateName: string;
  templateVersion: string;
  status: 'QUEUED' | 'RENDERING' | 'SUCCEEDED' | 'FAILED';
  byteSize: number | null;
  pageCount: number | null;
  generationDurationMs: number | null;
  requesterId: string | null;
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
}

interface PdfTemplate {
  name: string;
  version: string;
}

export default async function AdminPdfGenerationPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.role)) redirect('/no-access');

  const [recent, templates] = await Promise.all([
    apiFetch<PdfGenerationRow[]>('/pdf/admin/recent').catch(() => [] as PdfGenerationRow[]),
    apiFetch<PdfTemplate[]>('/pdf/templates').catch(() => [] as PdfTemplate[]),
  ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="PDF Generation"
        subtitle="Every Council Pack, brief, and report this app emits routes through Gotenberg. This page tracks what has been generated, how long it took, and what failed."
      />

      <Section title="Registered templates">
        {templates.length === 0 ? (
          <EmptyState
            title="No templates loaded"
            description="The NestJS PdfModule registers the @kku/pdf-templates package at boot. If this list is empty, the API service may be failing to start — check logs."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <Card key={t.name}>
                <CardHeader>
                  <CardTitle className="font-mono text-sm">{t.name}</CardTitle>
                  <CardDescription>version {t.version}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recent generations">
        {recent.length === 0 ? (
          <EmptyState
            title="No generations yet"
            description="Once any module calls PdfGenerationService, rows appear here. First targets: Council Pack export from the Cockpit (prompt 05) and the Program Deep-Dive brief (prompt 06)."
          />
        ) : (
          <Card padding="none">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-surface-2 text-text-secondary">
                    <th className="px-3 py-2 text-left">Template</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right font-tabular">Pages</th>
                    <th className="px-3 py-2 text-right font-tabular">KB</th>
                    <th className="px-3 py-2 text-right font-tabular">Duration</th>
                    <th className="px-3 py-2 text-left">Started</th>
                    <th className="px-3 py-2 text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row) => (
                    <tr key={row.id} className="border-b border-border-subtle">
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.templateName}
                        <span className="ml-1 text-text-tertiary">v{row.templateVersion}</span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-3 py-2 text-right font-tabular">
                        {row.pageCount ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-tabular">
                        {row.byteSize ? (row.byteSize / 1024).toFixed(0) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-tabular">
                        {row.generationDurationMs ? `${row.generationDurationMs} ms` : '—'}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-text-tertiary">
                        {row.errorCode ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>
    </AuthedAppShell>
  );
}

function StatusBadge({ status }: { status: PdfGenerationRow['status'] }) {
  const tone =
    status === 'SUCCEEDED'
      ? 'success'
      : status === 'FAILED'
        ? 'danger'
        : status === 'RENDERING'
          ? 'info'
          : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}
