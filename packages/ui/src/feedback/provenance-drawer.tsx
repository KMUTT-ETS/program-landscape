'use client';

import * as React from 'react';
import { ExternalLink } from 'lucide-react';
import type { ApiMetaSourceComposition } from '@kku/shared';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '../primitives/drawer';
import { useProvenance } from './provenance-context';

// One instance of <ProvenanceDrawer /> lives at the app root. Any
// ProvenanceButton shows its item here. We read the envelope's `meta`
// field (see @kku/shared ApiMeta) and render:
//   - data sources with timestamps and URLs
//   - calculation method: the methodologyVersion, a doc link, and the
//     parameters in force for THIS request (thresholds a reader can move
//     from the URL are part of the method, not decoration)
//   - last refreshed
//   - source composition, when a figure draws on more than one writer
//   - caveats, in plain English

function formatFreshness(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = Date.now();
  const ms = now - d.getTime();
  const hours = Math.floor(ms / 36e5);
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// A second writer's share of the figure — see ApiMetaSourceCompositionSchema.
//
// The numbers are separated from the words STRUCTURALLY, not by a flex gap:
// "3" and "of 41 staff" set adjacent in a tabular face read as one token, and
// the reader who most needs this line is the one skimming it.
//
// Both ratios are shown. Staff coverage says how many people acted; paper
// coverage says how much of the figure moved, and they routinely disagree —
// one prolific importer in a large roster is a small staff ratio and a large
// paper ratio.
//
// The `countedInFigure: false` wording says ROWS, deliberately. Excluding a
// writer's rows is not the same as excluding its effect, and on this codebase
// it genuinely is not: a Scholar import also raises citation counts on
// existing library rows, which keep their ingestion-run provenance and so
// still reach analyses that filter Scholar out. That is what `caveats` is for
// and why this line does not claim more than it can.
function CompositionRatio({
  covered,
  total,
  unit,
}: {
  covered: number;
  total: number;
  unit: string;
}) {
  return (
    <span>
      <span className="font-tabular">{covered.toLocaleString('en-US')}</span>
      <span> of </span>
      <span className="font-tabular">{total.toLocaleString('en-US')}</span>
      <span> {unit}</span>
    </span>
  );
}

function SourceComposition({ value }: { value: ApiMetaSourceComposition }) {
  const { label, staffCovered, staffTotal, papersCovered, papersTotal, denominator, countedInFigure } =
    value;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-subtle bg-surface-2 px-3 py-2">
      {staffTotal === 0 ? (
        <p className="text-text-primary">
          No publication record on file for this group, so there is no source
          mix to report.
        </p>
      ) : (
        <>
          <p className="text-text-primary">
            <span>{label}: </span>
            <CompositionRatio covered={staffCovered} total={staffTotal} unit="staff" />
            <span>, </span>
            <CompositionRatio covered={papersCovered} total={papersTotal} unit="papers" />
            <span>.</span>
          </p>
          <p className="text-xs text-text-tertiary">Staff counted out of {denominator}.</p>
        </>
      )}
      <p className="text-xs text-text-tertiary">
        {countedInFigure
          ? `This figure includes ${label} records, so it moves when someone imports their own profile.`
          : `This figure excludes ${label} rows — they carry no ingestion-run provenance, which this analysis requires.`}
      </p>
    </div>
  );
}

export function ProvenanceDrawer() {
  const prov = useProvenance();
  const open = prov.active !== null;
  const item = prov.active;

  return (
    <Drawer open={open} onOpenChange={(o) => !o && prov.hide()}>
      <DrawerContent aria-describedby="provenance-description">
        <DrawerHeader>
          <DrawerTitle>Provenance</DrawerTitle>
          <DrawerDescription id="provenance-description">
            {item?.title ?? 'Source, freshness, and method.'}
          </DrawerDescription>
        </DrawerHeader>

        {item && (
          <DrawerBody className="flex flex-col gap-5 text-sm">
            <section>
              <h3 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
                Last refreshed
              </h3>
              <p className="text-text-primary">
                {formatFreshness(item.meta.freshnessDate)}
              </p>
              {item.meta.freshnessDate && (
                <p className="text-xs text-text-tertiary">
                  {new Date(item.meta.freshnessDate).toLocaleString()}
                </p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
                Data sources
              </h3>
              {item.meta.sources.length === 0 ? (
                <p className="text-text-tertiary">No sources declared.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {item.meta.sources.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-start justify-between gap-3 rounded-md border border-border-subtle bg-surface-2 px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-text-primary">{s.name}</span>
                        <span className="text-xs text-text-tertiary">{s.id}</span>
                      </div>
                      {s.url && (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent-default hover:underline"
                        >
                          Open
                          <ExternalLink className="size-icon-xs" aria-hidden />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {item.meta.sourceComposition && (
              <section>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
                  Source composition
                </h3>
                <SourceComposition value={item.meta.sourceComposition} />
              </section>
            )}

            {(item.meta.methodologyVersion ||
              (item.meta.methodologyParameters && item.meta.methodologyParameters.length > 0)) && (
              <section>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
                  Methodology
                </h3>
                {item.meta.methodologyVersion && (
                  <p className="text-text-primary">
                    Version{' '}
                    <span className="font-tabular">
                      {item.meta.methodologyVersion}
                    </span>
                  </p>
                )}
                {item.meta.methodologyParameters && item.meta.methodologyParameters.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {item.meta.methodologyParameters.map((p) => (
                      <li
                        key={p.label}
                        className="flex items-baseline justify-between gap-3 text-text-secondary"
                      >
                        <span>{p.label}</span>
                        <span className="font-tabular text-text-primary">{p.value}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-xs text-text-tertiary">
                  See <code>docs/methodologies/</code> in the repo for the full
                  spec of this metric.
                </p>
              </section>
            )}

            {item.meta.confidence !== undefined && (
              <section>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
                  Confidence
                </h3>
                <p className="font-tabular text-text-primary">
                  {(item.meta.confidence * 100).toFixed(0)}%
                </p>
              </section>
            )}

            {item.meta.caveats && item.meta.caveats.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
                  Caveats
                </h3>
                <ul className="flex flex-col gap-2">
                  {item.meta.caveats.map((c) => (
                    <li key={c} className="text-text-secondary">
                      {c}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {item.meta.scope && (
              <section>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
                  Scope
                </h3>
                <p className="text-text-primary">
                  {item.meta.scope.level}
                  {item.meta.scope.id && (
                    <span className="ml-2 rounded-sm bg-surface-3 px-1.5 py-0.5 font-tabular text-xs">
                      {item.meta.scope.id}
                    </span>
                  )}
                </p>
              </section>
            )}
          </DrawerBody>
        )}
      </DrawerContent>
    </Drawer>
  );
}
