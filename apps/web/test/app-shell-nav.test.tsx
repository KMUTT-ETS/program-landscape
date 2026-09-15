import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ────────────────────────────────────────────────────────────────────────────
// The collapsible left nav, asserted at the only two layers that can be
// asserted without a DOM: the markup the shell emits, and the stylesheet that
// markup is a contract with.
//
// The rail is drawn by CSS keyed off `data-nav` on the shell root — that is
// what lets a collapsed nav arrive collapsed in the first byte of HTML instead
// of snapping narrow after hydration. The cost of doing it in CSS is that a
// class-name rename on either side is silent: the markup still renders, the
// stylesheet still parses, and the nav is simply 280px of labels inside a 56px
// column. So the class names are asserted in BOTH files here. Deleting
// `kku-nav-collapsible` from the section header, or renaming
// `.kku-nav-rail-scope` in tokens.css, fails this suite.
//
// Static markup rather than a driven DOM: this workspace has no jsdom and no
// @testing-library (see vitest.config.ts). That rules out asserting a click on
// the toggle — what is asserted instead is that both of its states render the
// right `aria-expanded`, which is the part a screen-reader user depends on.
// ────────────────────────────────────────────────────────────────────────────

// `next/navigation` is deliberately NOT mocked. `vi.mock` keys on the
// RESOLVED module, and packages/ui resolves its own copy of next, so a mock
// declared here would apply to apps/web's copy and quietly not to the nav's.
// Instead both components tolerate the null pathname that `usePathname`
// returns with no router above — which is the same thing that happens in any
// static render.
import {
  AppShell,
  LeftNav,
  TooltipProvider,
  isNavVariant,
  navVariantFromCookie,
  type NavSection,
} from '@kku/ui';

const sections: NavSection[] = [
  {
    label: 'Portfolio',
    items: [
      { href: '/cockpit', label: 'Cockpit', moduleKey: 'cockpit' },
      { href: '/programs', label: 'Programs', moduleKey: 'programs', badge: '297' },
    ],
  },
  {
    label: 'Governance',
    items: [{ href: '/decisions', label: 'Decisions', moduleKey: 'decisions' }],
  },
];

function shell(initialVariant?: 'expanded' | 'rail'): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <AppShell
        initialVariant={initialVariant}
        topBar={<div>top bar</div>}
        leftNav={<LeftNav sections={sections} brand={<span>Brand</span>} />}
      >
        <p>content</p>
      </AppShell>
    </TooltipProvider>,
  );
}

const tokensCss = readFileSync(
  path.resolve(__dirname, '../../../packages/design/src/css/tokens.css'),
  'utf8',
);

describe('app shell — collapsible navigation', () => {
  it('renders the collapse toggle as an expanded disclosure over the nav column', () => {
    const html = shell('expanded');
    // aria-controls must point at an element that is actually in the
    // document, or the disclosure announces a target that does not exist.
    expect(html).toContain('id="app-left-nav"');
    expect(html).toContain('aria-controls="app-left-nav"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Collapse navigation"');
  });

  it('renders the toggle as collapsed, and marks the column as the rail scope', () => {
    const html = shell('rail');
    expect(html).toContain('data-nav="rail"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Expand navigation"');
    expect(html).toContain('kku-nav-rail-scope');
  });

  it('defaults to expanded when no preference cookie was set', () => {
    expect(shell()).toContain('data-nav="expanded"');
  });

  it('marks section headers and tile labels as the parts the rail drops', () => {
    const html = shell('rail');
    // Both of these must sit on an element carrying the collapsible class,
    // otherwise they render full-width inside a 56px column.
    expect(html).toMatch(/class="kku-nav-collapsible[^"]*"[^>]*>(?:(?!<\/div>).)*Portfolio/s);
    expect(html).toMatch(/class="kku-nav-collapsible[^"]*"[^>]*>Cockpit</);
    // The badge too — a "297" chip beside no label is nonsense.
    expect(html).toMatch(/class="[^"]*kku-nav-collapsible[^"]*"[^>]*>297</);
  });

  it('keeps an accessible name on rail tiles, whose visible label is hidden', () => {
    const html = shell('rail');
    expect(html).toContain('aria-label="Cockpit"');
    expect(html).toContain('aria-label="Decisions"');
  });

  it('exposes the mobile drawer behind a labelled hamburger', () => {
    const html = shell('expanded');
    expect(html).toContain('aria-label="Open navigation menu"');
    // Radix wires the dialog semantics on the trigger.
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it("gives the hamburger a real aria-controls value, whatever Radix's per-render id is", () => {
    // What this suite CANNOT check: that the id resolves to a mounted
    // element. Radix's drawer content is portaled, and its Portal only
    // calls createPortal after `mounted` flips true inside a
    // useLayoutEffect — which never runs under renderToStaticMarkup, open
    // or closed, so the portal renders null regardless of dialog state
    // (verified directly: forcing a real createPortal in this same
    // react-dom/server throws "Portals are not currently supported by the
    // server renderer"). There is no rendered-open case to fall back on
    // without jsdom + @testing-library, which this workspace has neither
    // of (see the file-level comment). The id/aria-controls linkage is
    // instead confirmed against a live page in the authenticated check.
    const html = shell('expanded');
    const trigger = html.match(/<button[^>]*aria-label="Open navigation menu"[^>]*>/);
    expect(trigger).not.toBeNull();
    const controls = trigger![0].match(/aria-controls="([^"]+)"/);
    expect(controls).not.toBeNull();
    expect(controls![1]!.length).toBeGreaterThan(0);
  });

  it('is backed by stylesheet rules that actually hide those parts on the rail', () => {
    // The markup contract above is only worth anything if tokens.css still
    // keys off the same names.
    expect(tokensCss).toContain("[data-nav='rail'] .kku-nav-rail-scope .kku-nav-collapsible");
    expect(tokensCss).toMatch(
      /\[data-nav='rail'\] \.kku-nav-rail-scope \.kku-nav-collapsible \{\s*display: none;/,
    );
    // …and that the column narrows rather than merely losing its labels.
    expect(tokensCss).toMatch(/\[data-nav='rail'\] \{\s*--app-nav-width: 56px;/);
    expect(tokensCss).toMatch(/--app-nav-width: 280px;/);
  });

  it('respects a reduced-motion preference on the drawer entry animation', () => {
    expect(tokensCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.kku-nav-drawer\[data-state='open'\] \{\s*animation: none;/,
    );
  });

  it('pins the mobile bar height and the top bar offset to the same variable', () => {
    // A literal offset here was 28px on this half-scale spacing scale while
    // reading as 56px, so the two rows overlapped by whatever they disagreed.
    expect(tokensCss).toMatch(/--app-mobile-bar-h: \d+px;/);
    expect(shell('expanded')).toContain('h-[var(--app-mobile-bar-h)]');
    const topBarSource = readFileSync(
      path.resolve(__dirname, '../../../packages/ui/src/layout/top-bar.tsx'),
      'utf8',
    );
    expect(topBarSource).toContain('top-[var(--app-mobile-bar-h)]');
  });
});

describe('nav preference cookie', () => {
  it('reads only the exact word `rail` as collapsed', () => {
    expect(navVariantFromCookie('rail')).toBe('rail');
  });
  it.each([
    ['expanded', 'the other valid value'],
    [undefined, 'no cookie at all — first visit'],
    [null, 'a cleared cookie'],
    ['', 'an empty value'],
    ['Rail', 'wrong case — cookie values are not normalised'],
    ['rail ', 'a trailing space from a hand-edited cookie'],
    ['rail;expanded', 'a value carrying a second cookie'],
    ['true', 'a boolean from some older build'],
    ['<script>alert(1)</script>', 'hostile input — it reaches an HTML attribute'],
  ])('falls back to expanded for %j (%s)', (value, _description) => {
    expect(navVariantFromCookie(value as string | undefined | null)).toBe('expanded');
  });
  it('never returns anything outside the union, whatever it is handed', () => {
    for (const v of ['rail', 'expanded', undefined, null, '', 'nope', '0']) {
      expect(isNavVariant(navVariantFromCookie(v as string | undefined | null))).toBe(true);
    }
  });
});
