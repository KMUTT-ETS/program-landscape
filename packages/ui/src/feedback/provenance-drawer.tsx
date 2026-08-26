'use client';

import * as React from 'react';
import { ExternalLink } from 'lucide-react';
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
//   - calculation method (via methodologyVersion) with a doc link
//   - last refreshed
//   - caveats placeholder (populated once methodology docs are live)

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

            {item.meta.methodologyVersion && (
              <section>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
                  Methodology
                </h3>
                <p className="text-text-primary">
                  Version{' '}
                  <span className="font-tabular">
                    {item.meta.methodologyVersion}
                  </span>
                </p>
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
