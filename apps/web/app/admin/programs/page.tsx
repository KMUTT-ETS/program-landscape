import { redirect } from 'next/navigation';
import type { SessionUser, ApiSuccess } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Button, EdgeGlow, PageHeader, Section } from '@kku/ui';
import Link from 'next/link';
import { FileUp, Plus } from 'lucide-react';
import { ProgramsListClient, type ProgramListRow } from './list-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Programs — Admin' };

type PaginatedEnvelope = ApiSuccess<ProgramListRow[]> & {
  meta: { pagination?: { page: number; pageSize: number; total: number } };
};

export default async function AdminProgramsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (user.role !== 'ADMIN' && user.role !== 'ANALYST') redirect('/');

  const params = await searchParams;
  const query = new URLSearchParams();
  const q = typeof params.q === 'string' ? params.q : undefined;
  const facultyId =
    typeof params.facultyId === 'string' ? params.facultyId : undefined;
  const level = typeof params.level === 'string' ? params.level : undefined;
  const status = typeof params.status === 'string' ? params.status : undefined;
  if (q) query.set('q', q);
  if (facultyId) query.set('facultyId', facultyId);
  if (level) query.set('level', level);
  if (status) query.set('status', status);
  query.set('pageSize', '200');

  const [rows, faculties] = await Promise.all([
    apiFetchEnvelope<ProgramListRow[]>(
      `/admin/programs?${query.toString()}`,
    ).catch(
      () =>
        ({
          data: [] as ProgramListRow[],
          meta: {
            freshnessDate: null,
            sources: [],
            pagination: { page: 1, pageSize: 200, total: 0 },
          },
          error: null,
        }) satisfies PaginatedEnvelope,
    ),
    apiFetch<Array<{ id: string; code: string; nameEn: string; nameTh: string }>>(
      '/faculties',
    ).catch(() => []),
  ]);
  const rowsEnvelope = rows as PaginatedEnvelope;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · Programs"
        title="Program management"
        subtitle="Curate the 297 KKU programs. Attach มคอ.2 curriculum PDFs, apply reviewed extractions, and edit header fields (degree, credits, plans, approvals, careers)."
        actions={
          <div className="flex items-center gap-2">
            <EdgeGlow inline>
              <Button variant="primary" asChild>
                <Link href="/admin/programs/from-pdf">
                  <FileUp className="h-4 w-4" aria-hidden />
                  New from PDF
                </Link>
              </Button>
            </EdgeGlow>
            <Button variant="outline" asChild>
              <Link href="/admin/programs/new">
                <Plus className="h-4 w-4" aria-hidden />
                New blank
              </Link>
            </Button>
          </div>
        }
      />
      <Section>
        <ProgramsListClient
          rows={rowsEnvelope.data ?? []}
          total={rowsEnvelope.meta.pagination?.total ?? (rowsEnvelope.data?.length ?? 0)}
          faculties={faculties}
          initialFilters={{ q, facultyId, level, status }}
        />
      </Section>
    </AuthedAppShell>
  );
}
