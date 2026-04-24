import { redirect, notFound } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Card, CoverageMatrix, PageHeader, type CoverageRow, type CoverageSkill } from '@kku/ui';
import Link from 'next/link';
import type { ProgramPeersResponse } from '../../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Program Benchmarking' };

interface ProgramOverview {
  program: {
    id: string;
    nameEn: string;
    nameTh: string;
    level: string;
    code: string;
  };
}

interface SkillListItem {
  skillId: string;
  nameEn: string;
  nameTh: string;
  weight: number;
}

interface ProgramSkillListResponse {
  taught: SkillListItem[];
}

export default async function ProgramBenchmarkingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ peerSetId?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const { id } = await params;
  const sp = await searchParams;
  const peerSetQs = sp.peerSetId ? `peerSetId=${encodeURIComponent(sp.peerSetId)}&` : '';

  const [overview, peersResp, kkuSkillsResp] = await Promise.all([
    apiFetch<ProgramOverview>(`/programs/${id}/overview`).catch(() => null),
    apiFetch<ProgramPeersResponse>(`/benchmarking/programs/${id}/peers?${peerSetQs}limit=5`).catch(
      () => null,
    ),
    apiFetch<ProgramSkillListResponse>(`/programs/${id}/skills`).catch(() => ({
      taught: [] as SkillListItem[],
    })),
  ]);

  if (!overview) notFound();
  const program = overview.program;
  const kkuSkills = kkuSkillsResp.taught ?? [];

  const skillsUnion: CoverageSkill[] = kkuSkills.map((s) => ({
    id: s.skillId,
    label: s.nameEn,
  }));
  const rows: CoverageRow[] = [
    {
      id: `kku-${program.id}`,
      label: `${program.nameEn} (KKU)`,
      sublabel: program.nameTh,
      highlight: true,
      weights: Object.fromEntries(kkuSkills.map((s) => [s.skillId, s.weight])),
    },
  ];
  if (peersResp) {
    for (const peer of peersResp.peers) {
      rows.push({
        id: peer.id,
        label: `${peer.institution}`,
        sublabel: peer.programName,
        // Peer skill weights aren't returned by /peers today; pass 0 so the
        // row renders with empty cells — coverage comes from peer-program-
        // skill joins that the side-panel already summarises.
        weights: Object.fromEntries(kkuSkills.map((s) => [s.skillId, 0])),
      });
    }
  }

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title={`Benchmarking · ${program.nameEn}`}
        subtitle={program.nameTh}
        actions={
          peersResp ? (
            <div className="flex items-center gap-2">
              <Badge tone="accent">{peersResp.scorerUsed}</Badge>
              <span className="text-xs text-text-tertiary">
                Distinctiveness {peersResp.distinctiveness.score}/100
              </span>
            </div>
          ) : null
        }
      />
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 text-xs text-text-tertiary">
          <Link href={`/programs/${id}`} className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            ← Program deep-dive
          </Link>
          <Link href="/benchmarking" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            Benchmarking home →
          </Link>
        </div>

        {!peersResp ? (
          <EmptyState title="Peer suggestion unavailable" />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-4">
              <Card padding="md">
                <h3 className="mb-3 text-sm font-semibold text-text-primary">Top peers</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary">
                        <th className="py-2 pr-3">Institution</th>
                        <th className="py-2 pr-3">Country</th>
                        <th className="py-2 pr-3 text-right">Rank</th>
                        <th className="py-2 pr-3 text-right">Similarity</th>
                        <th className="py-2 pr-3 text-right">Skill overlap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {peersResp.peers.map((p) => (
                        <tr key={p.id} className="border-b border-subtle last:border-0">
                          <td className="py-2 pr-3 font-medium text-text-primary">{p.institution}</td>
                          <td className="py-2 pr-3 text-xs text-text-tertiary">{p.country}</td>
                          <td className="py-2 pr-3 text-right font-mono text-xs">#{p.ranking ?? '—'}</td>
                          <td className="py-2 pr-3 text-right font-mono text-xs">
                            {(p.similarityScore * 100).toFixed(0)}%
                          </td>
                          <td className="py-2 pr-3 text-right font-mono text-xs">{p.skillOverlapCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {peersResp.scorerUsed !== 'skill-overlap' ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-text-tertiary">
                    ⚠ Using <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">{peersResp.scorerUsed}</code>: one or both sides lack skill tags.
                    Real embedding similarity ships when the peer scraper fills PeerProgram.embedding (prompt 14).
                  </p>
                ) : null}
              </Card>

              <Card padding="md">
                <h3 className="mb-3 text-sm font-semibold text-text-primary">Skill coverage vs peers</h3>
                <CoverageMatrix rows={rows} skills={skillsUnion} />
                <p className="mt-2 text-[11px] text-text-tertiary">
                  KKU row shown highlighted. Peer-skill weights land when the peer scraper is wired (prompt 14).
                </p>
              </Card>
            </div>

            <aside className="flex flex-col gap-3">
              <Card padding="md">
                <h3 className="mb-2 text-sm font-semibold text-text-primary">Distinctiveness</h3>
                <div className="mb-2 text-3xl font-semibold text-text-primary">
                  {peersResp.distinctiveness.score}
                  <span className="text-sm text-text-tertiary">/100</span>
                </div>
                <p className="text-xs leading-relaxed text-text-secondary">
                  {peersResp.distinctiveness.score >= 60
                    ? 'Distinctive — plenty of skills not present in peer curricula.'
                    : peersResp.distinctiveness.score >= 30
                      ? 'Moderately distinctive — some unique strengths, but significant overlap with peers.'
                      : 'Undifferentiated — most skills this program teaches are also taught by peers.'}
                </p>
              </Card>

              {peersResp.distinctiveness.distinctiveSkills.length > 0 ? (
                <Card padding="md">
                  <h3 className="mb-2 text-sm font-semibold text-text-primary">Unique to KKU</h3>
                  <ul className="space-y-1 text-sm">
                    {peersResp.distinctiveness.distinctiveSkills.slice(0, 8).map((s) => (
                      <li key={s.id} className="text-text-secondary">
                        {s.nameEn}
                        <span className="ml-1 text-xs text-text-tertiary">· {s.nameTh}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {peersResp.distinctiveness.sharedWithNPeers.length > 0 ? (
                <Card padding="md">
                  <h3 className="mb-2 text-sm font-semibold text-text-primary">Shared with peers</h3>
                  <ul className="space-y-1 text-sm">
                    {peersResp.distinctiveness.sharedWithNPeers.slice(0, 6).map((s) => (
                      <li key={s.skillId} className="flex items-center justify-between">
                        <span className="text-text-secondary">{s.nameEn}</span>
                        <Badge tone="outline">{s.count} peers</Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </aside>
          </div>
        )}
      </div>
    </AuthedAppShell>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <Card padding="lg">
      <p className="text-center text-sm text-text-tertiary">{title}</p>
    </Card>
  );
}
