import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { Badge, Button, PageHeader } from '@kku/ui';
import { ReviewClient } from './client';
import { ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PDF Review — Detail' };

export interface PdfDetail {
  id: string;
  originalFilename: string;
  storageUrl: string;
  fileSize: number;
  pageCount: number;
  sourceCategory: string;
  sourceCategoryHint: string | null;
  sourceOrg: string | null;
  language: string;
  processingStatus: string;
  processingError: string | null;
  ocrApplied: boolean;
  ocrConfidence: number | null;
  classificationConfidence: number | null;
  uploadedAt: string;
  pages: Array<{
    pageNumber: number;
    textContent: string | null;
    hasImages: boolean;
    hasTables: boolean;
  }>;
  extractions: Array<{
    id: string;
    extractionType: string;
    confidence: number;
    methodVersion: string;
    reviewStatus: 'PENDING_REVIEW' | 'AUTO_APPROVED' | 'APPROVED' | 'REJECTED';
    payloadJson: unknown;
    reasoning: string | null;
    reviewNotes: string | null;
    reviewedAt: string | null;
  }>;
}

export default async function AdminPdfReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.role)) redirect('/no-access');

  const { id } = await params;
  const pdfRes = await apiFetchSafe<PdfDetail | null>(`/pdfs/${id}`);
  if (!pdfRes.ok) {
    if (pdfRes.error.category === 'notFound') notFound();
    return (
      <AuthedAppShell user={user}>
        <AdminBackNav current="PDF detail" group="PDF library" groupHref="/admin/pdf-review" />
        <PageHeader title="PDF" />
        <DiagnosticEmptyState surface="this PDF" error={pdfRes.error} />
      </AuthedAppShell>
    );
  }
  if (!pdfRes.data) notFound();
  const pdf = pdfRes.data;

  // Same-origin streaming proxy. The browser never sees the internal
  // MinIO endpoint, and this URL works in prod where MinIO is on the
  // docker network only. See apps/web/app/api/pdfs/[id]/file/route.ts.
  const fileUrl = `/api/pdfs/${id}/file`;

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current={pdf?.originalFilename ?? 'PDF detail'} group="PDF library" groupHref="/admin/pdf-review" />
      <PageHeader
        title={pdf.originalFilename}
        subtitle={`${pdf.pageCount} pages · ${pdf.sourceOrg ?? 'Unknown source'} · uploaded ${new Date(pdf.uploadedAt).toLocaleString()}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/pdf-review">
                <ArrowLeft className="h-4 w-4" />
                Back to queue
              </Link>
            </Button>
            <Badge tone={statusTone(pdf.processingStatus)}>{pdf.processingStatus}</Badge>
            <Badge tone="neutral">{pdf.sourceCategory}</Badge>
          </div>
        }
      />
      {pdf.processingError && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm text-warning">
          {pdf.processingError}
        </div>
      )}
      <ReviewClient pdf={pdf} fileUrl={fileUrl} />
    </AuthedAppShell>
  );
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'PROCESSING') return 'info';
  return 'neutral';
}
