import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
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
  if (!isAdminGrade(user.role) && user.role !== 'ANALYST') redirect('/');

  const { id } = await params;
  const pdf = await apiFetch<PdfDetail | null>(`/pdfs/${id}`).catch(() => null);
  if (!pdf) notFound();

  // Signed URL fetched server-side so the client component gets a URL
  // already scoped to the user's session. TTL is short (15 min default),
  // which is fine for a single review session.
  const { url: fileUrl } = await apiFetch<{ url: string }>(`/pdfs/${id}/signed-url`);

  return (
    <AuthedAppShell user={user}>
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
