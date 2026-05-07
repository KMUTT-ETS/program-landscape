import * as React from 'react';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Button, Card, PageHeader } from '@kku/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Data setup — raw view' };

interface ColumnSpec {
  key: string;
  label: string;
  numeric?: boolean;
  format?: 'date' | 'datetime' | 'currency-thb' | 'percent' | 'json' | 'truncate' | 'link';
  linkTemplate?: string;
  linkDisplayKey?: string;
}

interface RawDatasetResult {
  title: string;
  description: string;
  columns: ColumnSpec[];
  items: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

const DATASET_TITLES: Record<string, string> = {
  'enrollment-metrics': 'Student information (enrollment)',
  'student-demographics': 'Student demographics',
  'financial-metrics': 'Financial — per program',
  'faculty-budgets': 'Faculty budgets',
  'faculty-members': 'Academic staff roster',
  'faculty-compensation': 'Faculty compensation (aggregate)',
  'kmitl-careers': 'Labour-market career taxonomy (LinkedIn data, MHESI subscription)',
  'kmitl-skill-demands': 'Labour-market skill demand — LinkedIn data, subscribed by MHESI',
  'kmitl-skill-growths': 'Labour-market skill growth — LinkedIn data, subscribed by MHESI',
  'research-outputs': 'Research outputs',
  'skill-aliases': 'Skill alias cache',
  'curriculum-pdfs': 'Curriculum PDFs',
  'proposed-skills': 'Proposed skills (review queue)',
};

export default async function RawDatasetPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataset: string }>;
  searchParams: Promise<{ page?: string; pageSize?: string; q?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (user.role !== 'ADMIN' && user.role !== 'ANALYST') redirect('/');

  const { dataset } = await params;
  if (!(dataset in DATASET_TITLES)) notFound();

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));
  const pageSize = Math.min(1000, Math.max(1, parseInt(sp.pageSize ?? '200', 10)));
  const q = sp.q ?? '';

  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q) qs.set('q', q);

  const result = await apiFetch<RawDatasetResult>(
    `/admin/data-setup/raw/${encodeURIComponent(dataset)}?${qs}`,
  ).catch((err: Error) => {
    return {
      title: 'Error loading dataset',
      description: err.message,
      columns: [],
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    } as RawDatasetResult;
  });

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
  const fromIdx = (page - 1) * pageSize + 1;
  const toIdx = Math.min(page * pageSize, result.total);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <Link href="/admin/data-setup" className="hover:underline">
              <span className="inline-flex items-center gap-1">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Data setup hub
              </span>
            </Link>
            <span>·</span>
            <span>Raw view</span>
          </span>
        }
        title={result.title}
        subtitle={result.description}
      />

      <Card padding="md" tone="quiet" className="flex flex-wrap items-center justify-between gap-4">
        <form action={`/admin/data-setup/raw/${dataset}`} method="get" className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="uppercase tracking-wide">Search</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Filter by name, code, …"
              className="rounded-md border border-default bg-surface-1 px-3 py-1.5 text-sm text-text-primary"
            />
          </label>
          <input type="hidden" name="pageSize" value={pageSize} />
          <Button type="submit" variant="outline" size="sm">
            Apply
          </Button>
        </form>
        <div className="text-sm text-text-tertiary">
          {result.total > 0 ? (
            <>
              Showing <span className="font-mono text-text-secondary">{fromIdx.toLocaleString()}–{toIdx.toLocaleString()}</span> of{' '}
              <span className="font-mono font-semibold text-text-primary">{result.total.toLocaleString()}</span> rows
            </>
          ) : (
            'No rows'
          )}
        </div>
      </Card>

      {result.items.length === 0 ? (
        <Card padding="lg">
          <p className="text-center text-sm text-text-tertiary">
            {q ? `No rows match "${q}".` : 'No rows. Run the matching connector to populate this dataset.'}
          </p>
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-subtle bg-surface-2 text-left text-xs uppercase tracking-wide text-text-tertiary">
                <tr>
                  {result.columns.map((c) => (
                    <th
                      key={c.key}
                      className={
                        'px-3 py-3 font-medium ' + (c.numeric ? 'text-right tabular-nums' : '')
                      }
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.items.map((row, i) => (
                  <tr key={i} className="border-b border-subtle last:border-0 hover:bg-surface-2/40">
                    {result.columns.map((c) => (
                      <td
                        key={c.key}
                        className={
                          'px-3 py-2.5 ' +
                          (c.numeric ? 'text-right tabular-nums font-mono text-xs' : '') +
                          (c.format === 'truncate' ? ' max-w-[280px] truncate' : '')
                        }
                        title={c.format === 'truncate' ? formatCell(row[c.key], c) : undefined}
                      >
                        {renderCell(row, c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <div className="text-text-tertiary">
            Page <span className="font-mono">{page}</span> of <span className="font-mono">{totalPages}</span>
          </div>
          <div className="flex items-center gap-2">
            <PageLink dataset={dataset} page={1} pageSize={pageSize} q={q} disabled={page === 1}>
              First
            </PageLink>
            <PageLink dataset={dataset} page={Math.max(1, page - 1)} pageSize={pageSize} q={q} disabled={page === 1}>
              Previous
            </PageLink>
            <PageLink
              dataset={dataset}
              page={Math.min(totalPages, page + 1)}
              pageSize={pageSize}
              q={q}
              disabled={page === totalPages}
            >
              Next
            </PageLink>
            <PageLink dataset={dataset} page={totalPages} pageSize={pageSize} q={q} disabled={page === totalPages}>
              Last
            </PageLink>
          </div>
        </div>
      )}
    </AuthedAppShell>
  );
}

function PageLink({
  dataset,
  page,
  pageSize,
  q,
  disabled,
  children,
}: {
  dataset: string;
  page: number;
  pageSize: number;
  q: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q) qs.set('q', q);
  const href = `/admin/data-setup/raw/${dataset}?${qs}`;
  if (disabled) {
    return (
      <Badge tone="outline" className="cursor-not-allowed opacity-50">
        {children}
      </Badge>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center rounded-md border border-default bg-surface-1 px-3 text-xs font-medium text-text-primary hover:bg-surface-2"
    >
      {children}
    </Link>
  );
}

function renderCell(row: Record<string, unknown>, col: ColumnSpec): React.ReactNode {
  const value = row[col.key];
  if (value === null || value === undefined || value === '') return '—';
  if (col.format === 'link' && typeof value === 'string') {
    const href = col.linkTemplate
      ? col.linkTemplate.replace('{value}', encodeURIComponent(value))
      : value;
    const display = col.linkDisplayKey
      ? String(row[col.linkDisplayKey] ?? value)
      : String(value);
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs text-accent-default hover:underline"
        title={display}
      >
        {display.length > 24 ? `${display.slice(0, 24)}…` : display}
      </a>
    );
  }
  return formatCell(value, col);
}

function formatCell(value: unknown, col: ColumnSpec): string {
  if (value === null || value === undefined) return '—';
  if (col.format === 'date') {
    const d = new Date(value as string);
    if (isNaN(d.getTime())) return '—';
    return d.toISOString().slice(0, 10);
  }
  if (col.format === 'datetime') {
    const d = new Date(value as string);
    if (isNaN(d.getTime())) return '—';
    return d.toISOString().replace('T', ' ').slice(0, 16);
  }
  if (col.format === 'currency-thb') {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  if (col.format === 'percent') {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(2) + '%';
  }
  if (col.format === 'json') {
    try {
      return JSON.stringify(value).slice(0, 200);
    } catch {
      return '—';
    }
  }
  if (typeof value === 'boolean') return value ? '✓' : '·';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value).slice(0, 200);
    } catch {
      return '—';
    }
  }
  return String(value);
}
