'use client';

// Building blocks for showing one programme pair's overlap evidence
// (program-overlap.v1): layer bars, shared / equivalent course lists, the PLO
// match table, the no-course-data note and the AI recommendation with its
// Council-readiness elements (confidence, reasoning, sources, disagree).
// Shared by the Education dashboard's pair panel and the Deep-Dive section.
//
// Type-only imports from @kku/db: a runtime import of that barrel would drag
// Prisma into the client bundle.

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { OverlapRecommendationView, PairEvidence } from '@kku/db';
import { Badge, Button, ConfidenceBadge } from '@kku/ui';
import { submitDisagreementAction } from '@/lib/actions/program-deep-dive';
import {
  NO_COURSE_DATA_DETAIL,
  NO_COURSE_DATA_LABEL,
  OVERLAP_ACTION_LABEL,
  hasNoCourseData,
  pct,
  type OverlapActionKey,
} from './labels';

export function OverlapPanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-[8px]">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{title}</h3>
      {children}
    </section>
  );
}

export function OverlapLayerBar({
  label,
  value,
  strong,
  nullText,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
  /** Shown instead of "—" when the value is null, e.g. "Not scored". */
  nullText?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-[12px]">
      <span className={strong ? 'font-medium text-text-primary' : 'text-text-secondary'}>{label}</span>
      <OverlapMiniBar value={value} strong={strong} />
      <span
        className={`min-w-[36px] text-right tabular-nums ${value === null ? 'text-text-tertiary' : 'text-text-primary'}`}
      >
        {value === null && nullText ? nullText : pct(value)}
      </span>
    </div>
  );
}

/** A bare 0–100 bar; an empty track when the layer could not be measured. */
export function OverlapMiniBar({
  value,
  strong,
  className,
}: {
  value: number | null;
  strong?: boolean;
  className?: string;
}) {
  return (
    <span className={`block h-[6px] overflow-hidden rounded-full bg-surface-2 ${className ?? ''}`}>
      {value !== null ? (
        <span
          className="block h-full rounded-full bg-accent-default"
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, opacity: strong ? 1 : 0.7 }}
        />
      ) : null}
    </span>
  );
}

/** Muted, never alarming: missing course data is a coverage fact, not a finding (D9). */
export function NoCourseDataNote({ compact }: { compact?: boolean }) {
  return (
    <p className="text-xs text-text-tertiary" title={compact ? NO_COURSE_DATA_DETAIL : undefined}>
      <span className="font-medium text-text-secondary">{NO_COURSE_DATA_LABEL}.</span>
      {compact ? null : <> {NO_COURSE_DATA_DETAIL}</>}
    </p>
  );
}

/** The evidence note a pair needs, if any: today only "no course data". */
export function EvidenceQualityNote({
  evidence,
  compact,
}: {
  evidence: PairEvidence | null | undefined;
  compact?: boolean;
}) {
  if (hasNoCourseData(evidence)) return <NoCourseDataNote compact={compact} />;
  return null;
}

export function SharedCoursesTable({ evidence }: { evidence: PairEvidence | null }) {
  if (!evidence || evidence.sharedCourses.length === 0) {
    return <p className="text-sm text-text-tertiary">No major course is shared by code.</p>;
  }
  return (
    <table className="w-full text-xs">
      <tbody>
        {evidence.sharedCourses.map((c) => (
          <tr key={c.code} className="border-t border-subtle first:border-t-0">
            <td className="py-[6px] pr-[12px] font-mono tabular-nums text-text-secondary">{c.code}</td>
            <td className={`py-[6px] ${c.nameTh ? '' : 'text-text-tertiary'}`} lang="th">
              {c.nameTh ?? 'Name not recorded'}
            </td>
            <td className="py-[6px] pl-[12px] text-right tabular-nums">{c.credits} cr</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EquivalentCoursesList({ evidence }: { evidence: PairEvidence | null }) {
  if (!evidence || evidence.equivalentCourses.length === 0) {
    return <p className="text-sm text-text-tertiary">No equivalent course pairs with different codes.</p>;
  }
  return (
    <ul className="flex flex-col">
      {evidence.equivalentCourses.map((c) => (
        <li
          key={`${c.codeA}|${c.codeB}`}
          className="grid grid-cols-[1fr_auto] gap-x-[12px] border-t border-subtle py-[6px] text-xs first:border-t-0"
        >
          <span lang="th">
            <span className="font-mono text-text-secondary">{c.codeA}</span> {c.nameA ?? '—'}
            <span className="mx-[6px] text-text-tertiary">↔</span>
            <span className="font-mono text-text-secondary">{c.codeB}</span> {c.nameB ?? '—'}
          </span>
          <span className="text-right tabular-nums">
            <span className="block">{Math.round(c.similarity * 100)}% similar</span>
            <span className="block text-text-secondary">{c.credits} cr</span>
            {c.basis === 'name' ? <span className="block text-text-tertiary">name match</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PloMatchView({
  evidence,
  labelA,
  labelB,
}: {
  evidence: PairEvidence | null;
  /** Who side A is, e.g. "A · <name>" or "This programme". */
  labelA: string;
  labelB: string;
}) {
  if (!evidence) return <p className="text-sm text-text-tertiary">Evidence unavailable.</p>;
  const ev = evidence;
  return (
    <div className="flex flex-col gap-[8px] text-xs">
      <p className="text-text-secondary">
        {ev.matchedPlos.length} matched pair{ev.matchedPlos.length === 1 ? '' : 's'} · {ev.coverage.plosA} PLOs
        in {labelA} · {ev.coverage.plosB} in {labelB}
      </p>
      {ev.matchedPlos.length > 0 ? (
        <details>
          <summary className="cursor-pointer select-none text-text-secondary hover:text-text-primary">
            Matched PLOs
          </summary>
          <ul className="mt-[6px] flex flex-col">
            {ev.matchedPlos.map((m) => (
              <li key={`${m.ordinalA}|${m.ordinalB}`} className="border-t border-subtle py-[6px] first:border-t-0">
                <span className="tabular-nums text-text-tertiary">
                  A{m.ordinalA} ↔ B{m.ordinalB} · {Math.round(m.similarity * 100)}%
                </span>
                <span className="mt-[2px] block">{m.textA}</span>
                <span className="mt-[2px] block text-text-secondary">{m.textB}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <UnmatchedPlos label={`Only in ${labelA}`} items={ev.unmatchedPlosA} />
      <UnmatchedPlos label={`Only in ${labelB}`} items={ev.unmatchedPlosB} />
    </div>
  );
}

function UnmatchedPlos({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer select-none text-text-secondary hover:text-text-primary" lang="th">
        {label} ({items.length})
      </summary>
      <ul className="mt-[6px] flex list-disc flex-col gap-[4px] pl-[18px]">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </details>
  );
}

export interface OverlapRecProgramme {
  id: string;
  code: string;
}

/**
 * The AI recommendation for one pair, with confidence, "show reasoning",
 * sources and a disagree button (Council-readiness rule 2). `programmes`
 * is [A, B] in the same orientation as `recommendation.distinctiveA/B`.
 */
export function OverlapRecommendation({
  pairId,
  recommendation: r,
  primaryAction,
  programmes,
  labelA,
  labelB,
  showLinks = true,
}: {
  pairId: string;
  recommendation: OverlapRecommendationView | null;
  primaryAction: OverlapActionKey | null;
  programmes: readonly [OverlapRecProgramme, OverlapRecProgramme];
  labelA: string;
  labelB: string;
  /** False where the reader is already on one side's Deep-Dive. */
  showLinks?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  if (!r) {
    return (
      <OverlapPanelSection title="AI suggestion">
        <p className="text-sm text-text-tertiary">
          None written. A suggestion is drafted only for pairs with at least one action and an index of 50 or
          more.
        </p>
      </OverlapPanelSection>
    );
  }

  const [a, b] = programmes;
  const onSubmit = async () => {
    if (!text.trim()) {
      toast.error('Describe your disagreement');
      return;
    }
    setBusy(true);
    const input = {
      sectionKey: `overlap:${pairId}`.slice(0, 60),
      aiInferenceId: r.aiInferenceId ?? undefined,
      bodyEn: text,
    };
    // The note attaches to a programme the caller can see; either side of the
    // pair may be outside their scope, so try A, then B.
    let res = await submitDisagreementAction({ programId: a.id, ...input });
    if (!res.ok) res = await submitDisagreementAction({ programId: b.id, ...input });
    setBusy(false);
    if (res.ok) {
      toast.success('Disagreement recorded — thank you');
      setOpen(false);
      setText('');
    } else toast.error(res.message);
  };

  return (
    <OverlapPanelSection title="AI suggestion">
      <div className="flex flex-wrap items-center gap-[8px]">
        <ConfidenceBadge value={r.confidence} />
        {r.stale ? <Badge tone="warning">Evidence changed since this was written</Badge> : null}
        <span className="ml-auto text-xs text-text-tertiary">{r.promptVersion}</span>
      </div>
      <p className="text-sm leading-relaxed text-text-primary">{r.rationale}</p>
      {r.disagreesWithAction && primaryAction ? (
        <div className="rounded-md border border-subtle bg-surface-2 p-[10px] text-xs">
          <span className="font-semibold text-text-primary">
            The AI disagrees with “{OVERLAP_ACTION_LABEL[primaryAction]}”.
          </span>{' '}
          <span className="text-text-secondary">
            {r.disagreementReason ?? 'No reason given.'} The rule-chosen action stands until a person reviews it.
          </span>
        </div>
      ) : null}
      <details>
        <summary className="cursor-pointer select-none text-xs text-text-secondary hover:text-text-primary">
          Show reasoning
        </summary>
        <div className="mt-[8px] flex flex-col gap-[8px] text-xs">
          <p>
            <span className="font-semibold">What is distinctive about {labelA}.</span>{' '}
            <span className="text-text-secondary">{r.distinctiveA}</span>
          </p>
          <p>
            <span className="font-semibold">What is distinctive about {labelB}.</span>{' '}
            <span className="text-text-secondary">{r.distinctiveB}</span>
          </p>
          <div>
            <span className="font-semibold">Next steps</span>
            <ol className="mt-[4px] flex list-decimal flex-col gap-[2px] pl-[18px] text-text-secondary">
              {r.nextSteps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-xs text-text-tertiary">
        <span>Sources:</span>
        {showLinks ? (
          <>
            <Link href={`/programs/${a.id}`} className="text-accent-default hover:underline">
              {a.code} Deep-Dive
            </Link>
            <Link href={`/programs/${b.id}`} className="text-accent-default hover:underline">
              {b.code} Deep-Dive
            </Link>
          </>
        ) : null}
        <span>the overlap evidence above</span>
        {r.aiInferenceId ? <span className="font-mono">inference {r.aiInferenceId}</span> : null}
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setOpen(true)}>
          Disagree
        </Button>
      </div>
      {open ? (
        <div className="flex flex-col gap-[8px] rounded-md border border-subtle bg-surface-2 p-[12px]">
          <label htmlFor={`disagree-${pairId}`} className="text-xs font-semibold">
            Disagreement with this suggestion
          </label>
          <textarea
            id={`disagree-${pairId}`}
            className="rounded border border-subtle bg-surface-0 p-[8px] text-sm"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What is wrong, missing or misleading? Specifics help the next model version."
          />
          <div className="flex items-center gap-[8px]">
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void onSubmit()}>
              {busy ? 'Submitting…' : 'Submit'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </OverlapPanelSection>
  );
}
