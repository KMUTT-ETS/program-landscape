# Plan — Prompt 16: Frontend bundle, render, accessibility audit

**Mode:** code change + operator-doc. Bundle analysis runs locally; Lighthouse + 4× CPU-throttle FCP requires staging.

## Initial recon (already gathered)

| Concern | Finding |
|---|---|
| Heavy viz libs | **No deck.gl, no visx imports anywhere.** Recharts is the only chart lib, used in 4 `packages/ui/src/viz/*` files (funnel, sparkline, radar, trend-line). |
| react-pdf | Used only in `apps/web/app/admin/pdf-review/[id]/client.tsx` (admin-only route, not on Council hot path). |
| `next/dynamic` | **Zero usage.** No code-split anywhere — heavy components ship in initial chunks of every page that renders them. |
| `next/image` | **Zero usage.** App uses raw `<img>` tags only (KKU logos in `public/brand/`). Image optimisation pipeline never engaged. |
| `next/font/google` | All 3 fonts (Inter, Sarabun, JetBrains Mono) loaded via `next/font/google` with `display: 'swap'`. Next handles preload + self-hosting automatically. |
| Local Sarabun TTFs | Present in `apps/web/public/fonts/sarabun/` but **not currently active** (kept as offline fallback per user preference). |
| Bundle analyzer | **Not installed.** No `@next/bundle-analyzer` in deps. |
| Client component density | 58 of 72 pages have `'use client'` somewhere in their tree. Heavy default toward CSR. |

## What this prompt actually delivers from the dev machine

1. **Bundle analyzer wiring** — Install `@next/bundle-analyzer`; gate via `ANALYZE=true`. Capture HTML reports under `docs/hardening/16-frontend.bench/`. Identify top-10 client chunks.
2. **Code-splitting** — For the worst offenders (recharts-heavy pages, react-pdf admin route), wrap in `next/dynamic({ ssr: false })` with a skeleton.
3. **Font verification** — Confirm `next/font/google` is doing the right thing (preload tags emitted, no runtime gstatic fetch). Document fallback path.
4. **CSP audit** — Confirm middleware nonce flow works with recharts; document any `style-src 'unsafe-inline'` requirement.
5. **A11y static checks** — alt text grep, modal/dialog focus-trap audit, keyboard-only reachability of interactive controls. Live Lighthouse run is the operator gate.
6. **Thai sanity** — verify long Thai program names don't break layout; `lang="th"` containers tagged correctly.

## What requires staging (operator gate, documented)

- Lighthouse mobile + desktop runs (Performance ≥ 85, A11y ≥ 95, Best Practices ≥ 95).
- Cold cockpit FCP < 1.5 s under 4× CPU throttle.
- Real CSP-violation report capture (some inline-style violations only surface at render-time with real chart data).

## Out of scope

- Replacing recharts with a lighter library (e.g., uPlot) — large refactor, not justified before measuring.
- Migrating to React Server Components for currently-client routes that need genuine interactivity.
- Switching `<img>` → `<Image />` for non-hot-path KKU brand assets — measurable only for above-the-fold logos, which are tiny (PNG, <30 KB).
