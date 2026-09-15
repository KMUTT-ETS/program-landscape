// Left-nav collapse preference.
//
// NOT a 'use client' module. It is plain data + pure functions, so the
// server component that composes the shell can read the preference and
// hand it down without pulling the client shell into its module graph.
//
// ── Why a cookie and not localStorage ──────────────────────────────
// The width of the nav column is a LAYOUT decision, and a layout
// decision that arrives after hydration is a visible jump. The usual
// fix is next-themes' trick — a tiny synchronous script in <head> that
// stamps an attribute before first paint — but this app's CSP
// (apps/web/middleware.ts) drops `'unsafe-inline'` from `script-src`
// entirely, so a hand-written inline <script> would need a per-request
// nonce, which means `headers()` in the ROOT layout, which opts every
// route out of static rendering. Too much blast radius for a sidebar.
//
// A cookie costs none of that: `AuthedAppShell` already calls
// `cookies()`, so reading one more is free, the server renders the
// attribute in the first byte of HTML, and there is no flash and no
// hydration mismatch to suppress. It is still a per-viewer convenience
// living on the device — the reason CLAUDE.md sends persistent state to
// the DB does not apply to "is this browser window narrow".
//
// The cookie is deliberately NOT httpOnly: the toggle writes it from
// the client. It carries one of two literal words and nothing else.

export type NavVariant = 'expanded' | 'rail';

/** Cookie name. Value is the literal variant. */
export const NAV_PREFERENCE_COOKIE = 'kku-nav';

/** Attribute on the shell root; CSS reads it to size the column. */
export const NAV_VARIANT_ATTRIBUTE = 'data-nav';

/** id of the persistent desktop nav column — the toggle's aria-controls. */
export const NAV_ELEMENT_ID = 'app-left-nav';

export const NAV_DEFAULT_VARIANT: NavVariant = 'expanded';

/** One year. The preference is a habit, not a session. */
export const NAV_PREFERENCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isNavVariant(value: unknown): value is NavVariant {
  return value === 'rail' || value === 'expanded';
}

/** Anything that is not the exact word `rail` means expanded. */
export function navVariantFromCookie(value: string | undefined | null): NavVariant {
  return value === 'rail' ? 'rail' : NAV_DEFAULT_VARIANT;
}

/**
 * Persist the preference from the browser. Wrapped because
 * `document.cookie` throws when cookies are blocked outright — the
 * toggle still works for the session, it just is not remembered.
 */
export function writeNavVariantCookie(variant: NavVariant): void {
  try {
    document.cookie = `${NAV_PREFERENCE_COOKIE}=${variant}; path=/; max-age=${NAV_PREFERENCE_MAX_AGE_SECONDS}; samesite=lax`;
  } catch {
    /* cookies blocked — not remembered, still usable */
  }
}

/** Read the preference back from the browser. `null` when unset or unreadable. */
export function readNavVariantCookie(): NavVariant | null {
  try {
    const hit = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${NAV_PREFERENCE_COOKIE}=(rail|expanded)(?:;|$)`),
    );
    return hit ? (hit[1] as NavVariant) : null;
  } catch {
    return null;
  }
}
