'use client';

import * as React from 'react';

import { DEFAULT_ORG_SHORT_NAMES, type OrgShortNames } from '@/lib/org-names';

export { DEFAULT_ORG_SHORT_NAMES, type OrgShortNames };

const OrgNamesContext = React.createContext<OrgShortNames>(DEFAULT_ORG_SHORT_NAMES);

export function OrgNamesProvider({
  value,
  children,
}: {
  value: OrgShortNames;
  children: React.ReactNode;
}) {
  return <OrgNamesContext.Provider value={value}>{children}</OrgNamesContext.Provider>;
}

export function useOrgNames(): OrgShortNames {
  return React.useContext(OrgNamesContext);
}
