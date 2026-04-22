'use client';

import * as React from 'react';
import type { ApiMeta } from '@kku/shared';

// Two-way contract between provenance producers (charts, KPIs, AI cards)
// and the single <ProvenanceDrawer> instance at the app root. Any
// component that wants to expose "ⓘ source" passes its ApiMeta upward
// through this context; the drawer renders whatever is active.

interface ProvenanceItem {
  id: string;
  title: string;
  meta: ApiMeta;
}

interface Ctx {
  show: (item: ProvenanceItem) => void;
  hide: () => void;
  active: ProvenanceItem | null;
}

const ProvenanceContext = React.createContext<Ctx | null>(null);

export function ProvenanceProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = React.useState<ProvenanceItem | null>(null);
  const value = React.useMemo<Ctx>(
    () => ({
      show: setActive,
      hide: () => setActive(null),
      active,
    }),
    [active],
  );
  return (
    <ProvenanceContext.Provider value={value}>{children}</ProvenanceContext.Provider>
  );
}

export function useProvenance(): Ctx {
  const ctx = React.useContext(ProvenanceContext);
  if (!ctx) {
    throw new Error('useProvenance() outside of <ProvenanceProvider>');
  }
  return ctx;
}

export type { ProvenanceItem };
