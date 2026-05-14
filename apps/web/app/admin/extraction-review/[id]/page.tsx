import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { Badge, Button, ConfidenceBadge, PageHeader } from '@kku/ui';
import { ArrowLeft } from 'lucide-react';
import { ReviewClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Extraction — Review' };

export interface AiExtractionDetail {
  id: string;
  sourceEntityType: string;
  sourceEntityId: string;
  extractionKind: string;
  payloadJson: unknown;
  confidence: number;
  methodVersion: string;
  reviewStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED';
  reasoning: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
  aiInference: {
    id: string;
    module: string;
    kind: string | null;
    model: string;
    prompt: string;
    response: string;
    tokensInput: number | null;
    tokensOutput: number | null;
    latencyMs: number | null;
    costEstimateUsd: number | null;
  } | null;
  reviewedBy: { id: string; name: string | null; email: string } | null;
}

export default async function AdminAiExtractionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  const { id } = await params;
  const extractionRes = await apiFetchSafe<AiExtractionDetail | null>(`/ai/extractions/${id}`);
  if (!extractionRes.ok) {
    if (extractionRes.error.category === 'notFound') notFound();
    return (
      <AuthedAppShell user={user}>
        <AdminBackNav current="Extraction detail" group="AI extraction review" groupHref="/admin/extraction-review" />
        <PageHeader title="AI extraction" />
        <DiagnosticEmptyState surface="this AI extraction" error={extractionRes.error} />
      </AuthedAppShell>
    );
  }
  if (!extractionRes.data) notFound();
  const extraction = extractionRes.data;

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="Extraction detail" group="AI extraction review" groupHref="/admin/extraction-review" />
      <PageHeader
        title={extraction.extractionKind}
        subtitle={`${extraction.sourceEntityType} · ${extraction.sourceEntityId} · ${extraction.methodVersion}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/extraction-review">
                <ArrowLeft className="h-4 w-4" />
                Back to queue
              </Link>
            </Button>
            <ConfidenceBadge value={extraction.confidence} />
            <Badge tone={statusTone(extraction.reviewStatus)}>{extraction.reviewStatus}</Badge>
          </div>
        }
      />
      <ReviewClient extraction={extraction} />
    </AuthedAppShell>
  );
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'APPROVED' || status === 'AUTO_APPROVED') return 'success';
  if (status === 'REJECTED') return 'danger';
  if (status === 'PENDING_REVIEW') return 'warning';
  return 'neutral';
}
