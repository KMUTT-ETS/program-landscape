'use client';

// Program Deep-Dive "Overlap" section (program-overlap.v1, spec §10.3).
// Lists the same-level KKU programmes whose curriculum overlaps this one by an
// index of 30 or more, with the evidence and the AI suggestion behind each.
// Hidden entirely — section and rail entry — when no run covers the programme
// or no sibling reaches 30 (D6); `shouldShowOverlapSection` is that rule.
//
// Type-only imports from @kku/db / @kku/shared: a runtime import of either
// barrel would drag node-only modules into the client bundle.

import * as React from 'react';
import Link from 'next/link';
import type { ApiMeta } from '@kku/shared';
import { Badge, Card, FreshnessBadge, ProvenanceButton, Section } from '@kku/ui';
import {
  EquivalentCoursesList,
  EvidenceQualityNote,
  OverlapMiniBar,
  OverlapPanelSection,
  OverlapRecommendation,
  PloMatchView,
  SharedCoursesTable,
} from '@/components/overlap/pair-evidence';
import {
  LANGUAGE_VARIANT_LABEL,
  actionBadgeLabel,
  hasNoCourseData,
  orientEvidence,
  orientRecommendation,
  pct,
  programmeLabel,
  sortActionsStrongestFirst,
} from '@/components/overlap/labels';
import type { OverlapSibling, ProgramOverlapSection } from './types';
import { useOrgNames } from './org-context';

/** The section's lower bound; siblings below it are never returned (D6). */
const SIBLING_FLOOR = 30;

/**
 * D6: show the section only when a run covers the programme AND at least one
 * sibling reaches an index of 30. The API already drops siblings under the
 * floor; the check is repeated so a stale payload cannot show an empty table.
 */
export function shouldShowOverlapSection(
  section: ProgramOverlapSection | null | undefined,
): section is ProgramOverlapSection {
  return !!section && section.siblings.some((s) => s.overlapIndex >= SIBLING_FLOOR);
}

/**
 * The headline the rail and the section band share: high-overlap siblings
 * when there are any, otherwise every overlapping programme.
 */
export function overlapHeadline(
  section: ProgramOverlapSection | null | undefined,
): { count: number; label: string } | undefined {
  if (!shouldShowOverlapSection(section)) return undefined;
  const shown = section.siblings.filter((s) => s.overlapIndex >= SIBLING_FLOOR);
  const high = shown.filter((s) => s.band === 'HIGH').length;
  if (high > 0) return { count: high, label: high === 1 ? 'high-overlap sibling' : 'high-overlap siblings' };
  return {
    count: shown.length,
    label: shown.length === 1 ? 'overlapping programme' : 'overlapping programmes',
  };
}

export const OVERLAP_RAIL_SECTION = {
  id: 'overlap',
  label: 'Overlap',
  subs: [{ href: '#overlap-siblings', label: 'Overlapping programmes' }],
};

/** Insert the Overlap entry right after Curriculum — only when it is shown. */
export function withOverlapSection<T extends { id: string }>(
  sections: readonly T[],
  entry: T,
  show: boolean,
): T[] {
  if (!show) return [...sections];
  const at = sections.findIndex((s) => s.id === 'curriculum');
  const i = at === -1 ? sections.length : at + 1;
  return [...sections.slice(0, i), entry, ...sections.slice(i)];
}

const BAND_LABEL: Record<OverlapSibling['band'], string> = {
  NONE: 'Low',
  LOW: 'Low',
  MODERATE: 'Moderate',
  HIGH: 'High',
};

export function OverlapSection({
  data,
  meta,
  programCode,
}: {
  data: ProgramOverlapSection;
  /** Envelope meta from GET /programs/:id/overlap; null when unavailable. */
  meta: ApiMeta | null;
  programCode: string;
}) {
  const org = useOrgNames();
  const siblings = data.siblings.filter((s) => s.overlapIndex >= SIBLING_FLOOR);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const provenance: ApiMeta = meta ?? {
    freshnessDate: data.completedAt,
    sources: [{ id: 'program-overlap', name: `Programme overlap (${data.methodologyVersion})` }],
    methodologyVersion: data.methodologyVersion,
  };

  return (
    <Section
      id="overlap-siblings"
      title="Overlapping programmes"
      description={`Same-level ${org.en} programmes whose curriculum overlaps this one by an index of 30 or more. Every action is a prompt for review by the faculty and Council, not a decision.`}
      actions={
        <div className="flex items-center gap-[8px]">
          <FreshnessBadge freshnessDate={data.completedAt} label="overlap run" />
          <ProvenanceButton title="Programme overlap" meta={provenance} />
        </div>
      }
    >
      <Card padding="none" className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="text-left text-xs text-text-tertiary">
              <th className="px-[12px] py-[8px] font-medium">Programme</th>
              <th className="px-[12px] py-[8px] font-medium">Faculty</th>
              <th className="px-[12px] py-[8px] text-right font-medium">Index</th>
              <th className="px-[12px] py-[8px] font-medium">Layers</th>
              <th className="px-[12px] py-[8px] font-medium">Containment</th>
              <th className="px-[12px] py-[8px] text-right font-medium">Shared staff</th>
              <th className="px-[12px] py-[8px] font-medium">Suggested action</th>
              <th className="px-[12px] py-[8px]" aria-label="Details" />
            </tr>
          </thead>
          <tbody>
            {siblings.map((s) => (
              <SiblingRows
                key={s.pairId}
                s={s}
                open={openId === s.pairId}
                onToggle={() => setOpenId((cur) => (cur === s.pairId ? null : s.pairId))}
                programId={data.programId}
                programCode={programCode}
              />
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-text-tertiary">
        Methodology {data.methodologyVersion}. Curriculum overlap is not market cannibalisation: two programmes can
        share courses and still recruit different students.
      </p>
    </Section>
  );
}

function SiblingRows({
  s,
  open,
  onToggle,
  programId,
  programCode,
}: {
  s: OverlapSibling;
  open: boolean;
  onToggle: () => void;
  programId: string;
  programCode: string;
}) {
  const noCourseData = hasNoCourseData(s.evidence);
  const name = programmeLabel(s.sibling);
  const detailId = `overlap-detail-${s.pairId}`;
  return (
    <>
      <tr className="border-t border-subtle align-top">
        <td className="px-[12px] py-[10px]">
          <Link href={`/programs/${s.sibling.id}`} className="font-medium text-text-primary hover:underline" lang="th">
            {name}
          </Link>
          <span className="block text-xs text-text-tertiary">
            {[s.sibling.nameEn, s.sibling.code].filter(Boolean).join(' · ')}
          </span>
          {s.languageVariant ? (
            <Badge tone="info" size="sm" className="mt-[4px]">
              {LANGUAGE_VARIANT_LABEL}
            </Badge>
          ) : null}
          {noCourseData ? (
            <div className="mt-[4px]">
              <EvidenceQualityNote evidence={s.evidence} compact />
            </div>
          ) : null}
        </td>
        <td className="px-[12px] py-[10px] text-xs text-text-secondary">
          {s.sibling.facultyNameEn ?? s.sibling.facultyCode ?? '—'}
        </td>
        <td className="px-[12px] py-[10px] text-right">
          <span className="block text-base font-semibold tabular-nums text-text-primary">{pct(s.overlapIndex)}</span>
          <span className="block text-xs text-text-tertiary">{BAND_LABEL[s.band]}</span>
        </td>
        <td className="px-[12px] py-[10px]">
          <div className="flex flex-col gap-[4px] text-xs">
            <LayerRow label="Structure" value={s.structure} />
            <LayerRow label="Content" value={s.content} />
            <LayerRow label="Outcome" value={s.outcome} />
          </div>
        </td>
        <td className="px-[12px] py-[10px] text-xs">
          <span className="block whitespace-nowrap">
            <span className="text-text-tertiary">this ⊂ sibling</span>{' '}
            <span className="tabular-nums text-text-primary">
              {s.containmentInSibling === null ? '—' : `${pct(s.containmentInSibling)} %`}
            </span>
          </span>
          <span className="mt-[2px] block whitespace-nowrap">
            <span className="text-text-tertiary">sibling ⊂ this</span>{' '}
            <span className="tabular-nums text-text-primary">
              {s.siblingContainmentInProgramme === null ? '—' : `${pct(s.siblingContainmentInProgramme)} %`}
            </span>
          </span>
        </td>
        <td className="px-[12px] py-[10px] text-right tabular-nums">{s.sharedStaff}</td>
        <td className="px-[12px] py-[10px]">
          {s.primaryAction ? (
            <Badge tone="accent">{actionBadgeLabel(s.primaryAction)}</Badge>
          ) : (
            <span className="text-xs text-text-tertiary">No action suggested</span>
          )}
        </td>
        <td className="px-[12px] py-[10px] text-right">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={detailId}
            className="whitespace-nowrap text-xs text-accent-default hover:underline"
          >
            {open ? 'Hide evidence' : 'Evidence'}
          </button>
        </td>
      </tr>
      {open ? (
        <tr id={detailId} className="bg-surface-1">
          <td colSpan={8} className="px-[16px] py-[16px]">
            <SiblingDetail s={s} programId={programId} programCode={programCode} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function LayerRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="grid grid-cols-[64px_72px_28px] items-center gap-[8px]">
      <span className="text-text-tertiary">{label}</span>
      <OverlapMiniBar value={value} />
      <span className={`text-right tabular-nums ${value === null ? 'text-text-tertiary' : 'text-text-primary'}`}>
        {pct(value)}
      </span>
    </div>
  );
}

export function SiblingDetail({
  s,
  programId,
  programCode,
}: {
  s: OverlapSibling;
  programId: string;
  programCode: string;
}) {
  // Stored evidence is oriented by the pair; here A is always this programme.
  const ev = s.evidence ? orientEvidence(s.evidence, s.programIsA) : null;
  const rec = s.recommendation ? orientRecommendation(s.recommendation, s.programIsA) : null;
  const name = programmeLabel(s.sibling);
  const actions = sortActionsStrongestFirst(s.actions);
  return (
    <div className="grid grid-cols-1 gap-[20px] text-sm lg:grid-cols-2">
      <div className="flex flex-col gap-[20px]">
        <EvidenceQualityNote evidence={s.evidence} />
        {s.languageVariant ? (
          <p className="text-xs text-text-tertiary">
            These are the Thai and international versions of one programme. They overlap by design, are never
            suggested for merging, and are left out of the risk indicators.
          </p>
        ) : null}
        {actions.length > 1 ? (
          <OverlapPanelSection title="All suggested actions">
            <div className="flex flex-wrap gap-[6px]">
              {actions.map((a) => (
                <Badge key={a} tone={a === s.primaryAction ? 'accent' : 'neutral'}>
                  {actionBadgeLabel(a)}
                </Badge>
              ))}
            </div>
          </OverlapPanelSection>
        ) : null}
        <OverlapRecommendation
          pairId={s.pairId}
          recommendation={rec}
          primaryAction={s.primaryAction}
          programmes={[
            { id: programId, code: programCode },
            { id: s.sibling.id, code: s.sibling.code },
          ]}
          labelA="this programme"
          labelB={name}
        />
      </div>
      <div className="flex flex-col gap-[20px]">
        <OverlapPanelSection title={`Shared courses · ${s.sharedCredits} credits`}>
          <SharedCoursesTable evidence={ev} />
        </OverlapPanelSection>
        <OverlapPanelSection title={`Equivalent courses · ${s.equivCredits} credits`}>
          {ev && ev.equivalentCourses.length > 0 ? (
            <p className="text-xs text-text-tertiary">This programme’s course first, then {name}’s.</p>
          ) : null}
          <EquivalentCoursesList evidence={ev} />
        </OverlapPanelSection>
        <OverlapPanelSection title="Programme learning outcomes">
          <PloMatchView evidence={ev} labelA="this programme" labelB={name} />
        </OverlapPanelSection>
      </div>
    </div>
  );
}
