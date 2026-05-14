import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Button, EdgeGlow, PageHeader } from '@kku/ui';
import { ArrowLeft, FileSearch, Upload } from 'lucide-react';
import { FixFilenamesButton } from './fix-filenames-button';
import { LibraryClient, type LibraryRow, type LibraryResponse } from './library-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PDF library — Admin' };

interface SearchParams {
  category?: string;
  status?: string;
  lifecycle?: string;
  q?: string;
  page?: string;
}

export default async function AdminPdfLibraryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.category) params.set('sourceCategory', sp.category);
  if (sp.status) params.set('processingStatus', sp.status);
  if (sp.lifecycle) params.set('lifecycleStatus', sp.lifecycle);
  if (sp.q) params.set('q', sp.q);
  if (sp.page) params.set('page', sp.page);
  params.set('pageSize', '25');

  const data = await apiFetch<LibraryResponse>(`/pdfs/library?${params.toString()}`).catch(
    () => ({ rows: [] as LibraryRow[], total: 0 }),
  );

  const isSuper = user.role === 'SUPER_ADMIN';

  return (
    <AuthedAppShell user={user}>
      <div className="flex items-baseline gap-3 mb-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Admin
          </Link>
        </Button>
        <span className="text-xs uppercase tracking-wide text-text-tertiary">
          External data · PDF library
        </span>
      </div>
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-accent-default/30 bg-accent-default/10 text-accent-default">
              <FileSearch className="h-5 w-5" aria-hidden />
            </div>
            <span>PDF library</span>
          </div>
        }
        subtitle="Non-curriculum PDFs — government, MHESI, KKU, faculty policy + reports. Re-extract on failure, archive when stale, deprecate when superseded, delete when no longer relevant."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{data.total.toLocaleString()} total</Badge>
            <EdgeGlow inline>
              <Button variant="primary" asChild>
                <Link href="/upload">
                  <Upload className="h-4 w-4" aria-hidden /> Upload PDF
                </Link>
              </Button>
            </EdgeGlow>
            {isSuper ? <FixFilenamesButton /> : null}
          </div>
        }
      />
      <LibraryClient
        initial={data}
        searchParams={sp}
        canDelete={isSuper}
      />
    </AuthedAppShell>
  );
}
