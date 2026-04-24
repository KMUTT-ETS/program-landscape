import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Card, EmptyState, PageHeader, Section } from '@kku/ui';
import { FixFilenamesButton } from './fix-filenames-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PDF Review — Admin' };

interface PdfRow {
  id: string;
  originalFilename: string;
  sourceCategory: string;
  sourceOrg: string | null;
  pageCount: number;
  uploadedAt: string;
  processingStatus: string;
  processingError: string | null;
  classificationConfidence: number | null;
  _count: { extractions: number };
  extractions: Array<{ id: string; extractionType: string; confidence: number }>;
}

export default async function AdminPdfReviewPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  // pdf:approve_extraction is ANALYST + ADMIN.
  if (user.role !== 'ADMIN' && user.role !== 'ANALYST') redirect('/');

  const pending = await apiFetch<PdfRow[]>('/pdfs/pending?status=PENDING_REVIEW').catch(
    () => [] as PdfRow[],
  );

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="PDF review queue"
        subtitle="PDFs whose extractions landed below the auto-approve threshold. Open one to inspect the source + verify the extracted structured data before it affects downstream analytics."
        actions={user.role === 'ADMIN' ? <FixFilenamesButton /> : null}
      />
      <Section title={`Pending review (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState
            title="No PDFs awaiting review"
            description="The worker auto-approves extractions above the configured confidence threshold. Anything below it surfaces here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {pending.map((pdf) => (
              <Link key={pdf.id} href={`/admin/pdf-review/${pdf.id}`} className="block">
                <Card className="h-full transition-shadow hover:shadow-elevation-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {pdf.originalFilename}
                        </div>
                        <div className="truncate text-xs text-text-tertiary">
                          {pdf.sourceOrg ?? 'Unknown source'}
                        </div>
                      </div>
                      <Badge tone="neutral">{pdf.sourceCategory}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      <span className="font-tabular">{pdf.pageCount} pages</span>
                      <span>·</span>
                      <span>{pdf._count.extractions} extraction{pdf._count.extractions === 1 ? '' : 's'}</span>
                      {pdf.classificationConfidence !== null && (
                        <>
                          <span>·</span>
                          <span className="font-tabular">
                            cls {Math.round(pdf.classificationConfidence * 100)}%
                          </span>
                        </>
                      )}
                    </div>
                    {pdf.processingError && (
                      <div className="text-xs text-warning">{pdf.processingError}</div>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </AuthedAppShell>
  );
}
