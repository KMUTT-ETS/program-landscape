'use client';

import * as React from 'react';

import { DEFAULT_ORG_SHORT_NAMES, type OrgShortNames } from '@/lib/org-names';

// Mounted once in the root layout from the organisation profile, so any
// client component can name the institution without prop-drilling.
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
