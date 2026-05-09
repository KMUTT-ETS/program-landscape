import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/role-gate';

// Thin proxy for `GET /pdfs/:id` on the NestJS API — used by the
// create-from-PDF wizard to poll for extraction readiness after upload.
// Browsers can't read the HttpOnly session cookie directly, so we mint
// the bearer here.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireSession({ minRole: 'admin' });
  if (guard.kind === 'deny') return guard.response;
  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  const token = (await cookies()).get(cookieName)?.value;

  const { id } = await params;
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const upstream = await fetch(`${API_BASE}/api/v1/pdfs/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  // Unwrap envelope and re-emit shape the client expects.
  const json = (await upstream.json()) as {
    data?: {
      id: string;
      originalFilename: string;
      processingStatus: string;
      processingError: string | null;
      extractions: Array<{
        id: string;
        extractionType: string;
        confidence: number;
        methodVersion: string;
        reviewStatus: string;
        payloadJson: unknown;
      }>;
    };
    error?: { code: string; message?: string };
  };
  if (!upstream.ok || !json.data) {
    return NextResponse.json(json, { status: upstream.status });
  }
  return NextResponse.json({
    data: {
      pdfDocumentId: json.data.id,
      originalFilename: json.data.originalFilename,
      processingStatus: json.data.processingStatus,
      processingError: json.data.processingError,
      extractions: json.data.extractions,
    },
  });
}
