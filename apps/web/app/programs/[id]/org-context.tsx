'use client';

import * as React from 'react';

/** The organisation's short names, as the chrome shows them. */
export interface OrgShortNames {
  en: string;
  th: string;
}

/** Shown when the install has no organisation profile yet. */
export const DEFAULT_ORG_SHORT_NAMES: OrgShortNames = { en: 'University', th: 'มหาวิทยาลัย' };

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
