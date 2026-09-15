'use client';

import * as React from 'react';
import type { NavVariant } from './nav-preference';

// The shell owns the collapse state, but `LeftNav` is handed to it as a
// prop (the app composes it in a server component), so props cannot
// carry the state down. A context is the only channel.
//
// The *visual* collapse is done in CSS off `html[data-nav]` so it is
// correct on the first paint — see nav-preference.ts. This context
// carries the same fact into React for the things CSS cannot do:
// tooltips on the rail's icon-only tiles, and the toggle's
// `aria-expanded`. Those settle one frame after hydration, which is
// invisible; a column that changes width would not be.

export interface NavChromeValue {
  variant: NavVariant;
  /** `true` when the persistent desktop column is the icon rail. */
  railed: boolean;
  /** `true` inside the mobile off-canvas drawer, which never rails. */
  inDrawer: boolean;
}

const NavChromeContext = React.createContext<NavChromeValue>({
  variant: 'expanded',
  railed: false,
  inDrawer: false,
});

export function NavChromeProvider({
  value,
  children,
}: {
  value: NavChromeValue;
  children: React.ReactNode;
}) {
  return <NavChromeContext.Provider value={value}>{children}</NavChromeContext.Provider>;
}

/** Defaults to expanded when no provider is above — `LeftNav` renders
 *  standalone in the styleguide and in tests. */
export function useNavChrome(): NavChromeValue {
  return React.useContext(NavChromeContext);
}
