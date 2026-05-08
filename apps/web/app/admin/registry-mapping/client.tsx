'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, AlertTriangle, ExternalLink } from 'lucide-react';

interface Candidate {
  facultyName: string;
  programName: string;
  level: string | null;
  major: string | null;
  score: number;
  facultyMatchesProgramFaculty: boolean;
  // null = tuple is unclaimed (insert path). non-null = tuple is currently
  // mapped to ANOTHER program — confirming will reassign and that program
  // becomes unmatched on refresh. Warn in the UI before letting through.
  currentlyMappedTo: { programId: string; programCode: string; programNameTh: string } | null;
}

interface ProgramRow {
  programId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: string;
  levelTh: string;
  majors: string[];
  sequenceNoFromSheet: number | null;
  faculty: { id: string; nameTh: string; nameEn: string };
  candidates: Candidate[];
}

export function RegistryMappingClient({
  totalUnmatched,
  fixtureSize,
  fixtureLoaded,
  initialPrograms,
}: {
  totalUnmatched: number;
  fixtureSize: number;
  fixtureLoaded: boolean;
  initialPrograms: ProgramRow[];
}) {
  const router = useRouter();
  // Per-candidate pending state — only the clicked button shows "Saving…".
  const [pendingByCandidate, setPendingByCandidate] = React.useState<Record<string, boolean>>({});
  const [errorByProgram, setErrorByProgram] = React.useState<Record<string, string>>({});
  const [resolvedThisSession, setResolvedThisSession] = React.useState(0);
  const [lastSaved, setLastSaved] = React.useState<{ programCode: string; programNameTh: string } | null>(null);

  // No longer filter — the server refresh after each save returns the
  // up-to-date list (which correctly reflects reassignment side effects).
  const visiblePrograms = initialPrograms;

  function candidateKey(programId: string, idx: number): string {
    return `${programId}::${idx}`;
  }

  async function confirmMapping(program: ProgramRow, candidate: Candidate, idx: number) {
    // Warn before stealing a mapping from another program.
    if (candidate.currentlyMappedTo && candidate.currentlyMappedTo.programId !== program.programId) {
      const owner = candidate.currentlyMappedTo;
      const ok = window.confirm(
        `This registry tuple is currently mapped to ${owner.programCode} (${owner.programNameTh}).\n\n` +
          `Confirming will REASSIGN the tuple to ${program.code} (${program.nameTh}). ${owner.programCode} will lose this mapping and reappear in the unmatched list.\n\n` +
          `Proceed with reassignment?`,
      );
      if (!ok) return;
    }

    const key = candidateKey(program.programId, idx);
    setPendingByCandidate((s) => ({ ...s, [key]: true }));
    setErrorByProgram((s) => {
      const next = { ...s };
      delete next[program.programId];
      return next;
    });
    try {
      const res = await fetch('/api/admin-registry-mapping', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          programId: program.programId,
          facultyName: candidate.facultyName,
          programName: candidate.programName,
          level: candidate.level ?? program.levelTh,
          major: candidate.major ?? '',
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { id?: string; programId?: string }; error?: { code?: string; message?: string } }
        | null;
      if (!res.ok || !body || !body.data || !body.data.id) {
        throw new Error(body?.error?.message ?? `HTTP ${res.status} — unexpected response`);
      }
      // CHANGED: no longer optimistically hide the program. The upsert can
      // have side effects on OTHER programs (reassigning a tuple unmaps the
      // previous owner). Optimistic-hide showed the target as resolved while
      // hiding the fact that another program had reappeared in the list.
      // Instead: refresh the page from the server so the UI always shows
      // ground truth. Side effects become immediately visible.
      setResolvedThisSession((c) => c + 1);
      setLastSaved({ programCode: program.code, programNameTh: program.nameTh });
      router.refresh();
    } catch (err) {
      setErrorByProgram((s) => ({
        ...s,
        [program.programId]: (err as Error).message,
      }));
    } finally {
      setPendingByCandidate((s) => ({ ...s, [key]: false }));
    }
  }

  if (!fixtureLoaded) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
        Registry fixture not found at{' '}
        <code className="font-mono">apps/ingestion/test/fixtures/kku-registry/aggregated.json</code>.
        Run <code className="font-mono">pnpm registry:capture aggregate</code> on a host with Oracle access first,
        then return here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary band */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border-default bg-surface-0 p-3">
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Unmatched programs</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{totalUnmatched}</div>
          <div className="text-xs text-text-secondary">No RegistryProgramMapping row yet</div>
        </div>
        <div className="rounded-lg border border-border-default bg-surface-0 p-3">
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Fixture tuples</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{fixtureSize.toLocaleString()}</div>
          <div className="text-xs text-text-secondary">Distinct (faculty / program / level / major)</div>
        </div>
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Saves this session</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
            {resolvedThisSession}
          </div>
          <div className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
            {lastSaved ? (
              <>
                last: <span className="font-mono">{lastSaved.programCode}</span>
              </>
            ) : (
              'List refreshes after each confirm'
            )}
          </div>
        </div>
      </div>

      {visiblePrograms.length === 0 ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <div className="text-base font-semibold text-emerald-700 dark:text-emerald-300">
            🎉 All programs matched
          </div>
          <p className="mt-1 text-xs text-text-tertiary">
            Every active program has at least one RegistryProgramMapping row.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visiblePrograms.map((p) => {
            const error = errorByProgram[p.programId];
            const facultyHasCandidates = p.candidates.some((c) => c.facultyMatchesProgramFaculty);
            return (
              <li key={p.programId} className="rounded-lg border border-border-default bg-surface-0 p-4">
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono">{p.code}</span>
                      <span className="text-sm font-semibold" lang="th">
                        {p.nameTh}
                      </span>
                    </div>
                    <div className="text-xs text-text-tertiary">
                      {p.nameEn} · {p.faculty.nameTh} · {p.levelTh}
                      {p.majors.length > 0 && ' · majors: ' + p.majors.join(', ')}
                    </div>
                  </div>
                  <Link
                    href={`/programs/${p.programId}`}
                    className="inline-flex items-center gap-1 text-xs text-text-tertiary hover:text-accent-default"
                    target="_blank"
                  >
                    Program detail <ExternalLink className="h-3 w-3" />
                  </Link>
                </header>

                {!facultyHasCandidates && p.candidates.length > 0 && (
                  <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="h-3 w-3" />
                    No same-faculty registry tuples · candidates below are cross-faculty fuzzy matches
                  </div>
                )}

                {p.candidates.length === 0 ? (
                  <div className="mt-2 text-xs text-text-tertiary">
                    No registry tuples scored above threshold. Faculty name or program name in the registry probably
                    differs significantly — check the fixture manually or add a mapping via SQL.
                  </div>
                ) : (
                  <ul className="mt-3 space-y-1.5">
                    {p.candidates.map((c, i) => {
                      const key = candidateKey(p.programId, i);
                      const pending = pendingByCandidate[key] ?? false;
                      const wouldReassign =
                        c.currentlyMappedTo && c.currentlyMappedTo.programId !== p.programId;
                      const buttonClasses = wouldReassign
                        ? 'inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300'
                        : 'inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300';
                      return (
                        <li
                          key={i}
                          className="flex flex-wrap items-start gap-3 rounded-md border border-border-subtle bg-surface-1 p-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="rounded bg-accent/10 px-1.5 py-0 text-[10px] font-semibold tabular-nums text-accent">
                                {Math.round(c.score * 100)}%
                              </span>
                              <span className="text-sm" lang="th">
                                {c.programName}
                              </span>
                            </div>
                            <div className="text-[11px] text-text-tertiary">
                              <span lang="th">{c.facultyName}</span>
                              {c.level && ' · ' + c.level}
                              {c.major && ' · major: ' + c.major}
                              {!c.facultyMatchesProgramFaculty && (
                                <span className="ml-1 text-amber-600 dark:text-amber-400">
                                  ⚠ different faculty
                                </span>
                              )}
                            </div>
                            {wouldReassign && (
                              <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-200">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                Currently mapped to{' '}
                                <span className="font-mono font-semibold">
                                  {c.currentlyMappedTo!.programCode}
                                </span>{' '}
                                <span lang="th">— {c.currentlyMappedTo!.programNameTh.slice(0, 28)}</span>
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => confirmMapping(p, c, i)}
                            className={buttonClasses}
                          >
                            <Check className="h-3 w-3" />
                            {pending ? 'Saving…' : wouldReassign ? 'Reassign…' : 'Confirm match'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {error && (
                  <div className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300">
                    Error: {error}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
