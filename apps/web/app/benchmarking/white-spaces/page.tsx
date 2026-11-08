import { orgShortNamesForRequest } from '@/lib/branding';
import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Card, PageHeader } from '@kku/ui';
import Link from 'next/link';
import type { WhiteSpaceResponse } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'White-space Opportunities' };

export default async function WhiteSpacesPage({
  searchParams,
}: {
  searchParams: Promise<{ peerThreshold?: string; limit?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const org = await orgShortNamesForRequest();

  const sp = await searchParams;
  const qs = new URLSearchParams({
    peerThreshold: sp.peerThreshold ?? '3',
    limit: sp.limit ?? '50',
  });

  const data = await apiFetch<WhiteSpaceResponse>(`/benchmarking/white-spaces?${qs}`).catch(
    () => null,
  );

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="White-space Opportunities"
        subtitle={`Skills that ≥3 peer institutions teach, but ${org.en} doesn't — ranked by peer consensus.`}
      />
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 text-xs text-text-tertiary">
          <Link href="/benchmarking" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            ← Back to Benchmarking
          </Link>
          <Link href="/gap-analysis?verdict=white-space" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            Gap map white spaces →
          </Link>
        </div>

        <Card padding="md">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary">
              {data?.rows.length ?? 0} white spaces (peer threshold ≥ {data?.peerThreshold ?? 3})
            </h3>
          </div>
          {data?.lowConfidenceReason ? (
            <div className="mb-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
              {data.lowConfidenceReason}
            </div>
          ) : null}
          {!data || data.rows.length === 0 ? (
            <EmptyMessage />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary">
                    <th className="py-2 pr-3">Skill</th>
                    <th className="py-2 pr-3 text-right">Peer count</th>
                    <th className="py-2 pr-3">Top peers</th>
                    <th className="py-2 pr-3 text-right">Cohort est.</th>
                    <th className="py-2 pr-3">Fit note</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.skillId} className="border-b border-subtle last:border-0">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-text-primary">{r.nameEn}</div>
                        <div className="text-xs text-text-tertiary">
                          <span className="font-mono">{r.skillCode}</span> · {r.nameTh}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <Badge tone="danger">{r.peerCount}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs text-text-secondary">
                        {r.peerInstitutions.slice(0, 3).join(', ')}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-xs">{r.estimatedCohortSize}</td>
                      <td className="py-2 pr-3 text-xs text-text-secondary">{r.fitNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <p className="text-xs leading-relaxed text-text-tertiary">
          Cross-reference:{' '}
          <Link href="/gap-analysis?verdict=white-space" className="underline">
            the Gap Analyzer&apos;s white spaces
          </Link>{' '}
          are fields of study employers advertise for that no {org.en} programme is assigned to; this page shows skills with peer-institution consensus. The overlap is where a new track or program is most defensible to Council.
        </p>
      </div>
    </AuthedAppShell>
  );
}

function EmptyMessage() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <div className="text-sm font-semibold text-text-primary">No white spaces surfaced yet</div>
      <p className="max-w-md text-xs text-text-tertiary">
        Peer skill tags are sparse until prompt 14 wires the peer-program scraper. Seed data currently covers 12 peer programs with 4–6 skills each.
      </p>
    </div>
  );
}
