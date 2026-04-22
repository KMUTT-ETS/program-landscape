# Design system

Tokens, components, and the rules that make every module feel like the
same app. Source of truth: `packages/design/src/css/tokens.css` (values)
and `packages/ui/src/*` (components). This document summarises both and
adds the "when to use which" guidance that isn't in the code.

Visual benchmark: **Linear · Stripe Dashboard · Vercel · Retool · Notion · Height**.
What we are NOT: generic shadcn-on-Inter defaults, legacy university IT
chrome, consumer BI chartjunk.

## Typography

- **Body / UI:** IBM Plex Sans Thai — weights 400, 500, 600, 700. Thai-
  native, 7-weight range, pairs with IBM Plex Mono for tabular data.
- **Mono / tabular:** IBM Plex Mono — every numeric column, every
  timestamp, every code / id.
- **Display:** same family, 600–700 weights. No separate display font.
- **Thai rendering:** `word-break: keep-all` on `[lang='th']` (Thai
  breaks at character boundaries by default — we break at words). Line
  height ≥ 1.5 so Thai diacritics don't clash.
- Decision to re-test in prompt 05 against real Thai content at 14px: if
  Plex reads thin at UI sizes, fallback is Sarabun + Prompt (a Cadson
  Demak pair). Not TH Sarabun New — that's the Cabinet-mandated **PDF**
  font and must stay scoped to PDF output.

### Scale (names, not sizes)

| Role | Class | Size |
|---|---|---|
| Display | `text-display` | 2.25rem (36px) |
| h1 | `text-3xl` | 1.75rem (28px) |
| h2 | `text-2xl` | 1.375rem (22px) |
| h3 | `text-xl` | 1.125rem (18px) |
| h4 | `text-lg` | 1rem (16px) |
| Body | `text-base` | 0.875rem (14px) |
| Body small | `text-sm` | 0.8125rem (13px) |
| Caption | `text-xs` | 0.75rem (12px) |
| Code | `font-mono` + `text-sm` | — |

Numeric columns use the `.font-tabular` utility — it sets both
`font-variant-numeric: tabular-nums` and the mono family so column
widths don't jitter when the digit composition changes.

## Colour — semantic, not literal

Values live in OKLCH inside CSS variables. Components consume them via
Tailwind utilities (the preset blocks the default palette, so
`bg-slate-500` is a compile-time error — there is no `slate-500`).

### Surface ladder

| Token | Light | Dark |
|---|---|---|
| `surface-0` | paper (near-white warm) | warm near-black |
| `surface-1` | cards, top bar, nav | lifted one step |
| `surface-2` | subtle-highlight rows, table headers | another step |
| `surface-3` | selected nav items, chips | |
| `surface-4` | hover on selected surfaces | |

### Text

| Token | Role |
|---|---|
| `text-primary` | body + headings |
| `text-secondary` | supporting content |
| `text-tertiary` | labels, helper, caption |
| `text-disabled` | disabled inputs |
| `text-inverse` | on-accent surfaces |

### Brand accent (use sparingly)

| Token | Use |
|---|---|
| `accent-default` | primary CTA (one per view), brand marks, live indicators |
| `accent-hover` / `accent-active` | interaction states |
| `accent-subtle` | backgrounds of accent badges, AI-insight rails |
| `accent-fg` | readable foreground on accent surfaces |

**Not** used for nav backgrounds, default buttons, or hover surfaces.
Default interactive tone is `info` (indigo) — that keeps interaction
signalling separate from institutional branding.

### Semantic

| Token | Use |
|---|---|
| `success` | "healthy" metrics, completed mutations |
| `warning` | stale data, caution states |
| `danger` | errors, *and* at-risk metrics (deliberately a different hue from the brand red) |
| `info` | informational banners, default interactive links |

Every semantic colour has a `-subtle` background variant for badge / banner fills.

### Data sentiment

| Token | Use |
|---|---|
| `data-positive` | revenue growth, improved outcomes |
| `data-negative` | at-risk metrics, declines |
| `data-neutral` | sparklines without a sign |

`data-negative` is the same hue as `danger` — deliberately **different**
from the KKU brand red so a red badge on a program card doesn't read as
institutional rejection.

### Chart palette

12 colours, chroma held near 0.15, lifted lightness values in dark mode.
Order is curated so the first-4 are distinguishable under
deuteranopia / protanopia. Modules that want a sequential (not
categorical) ladder should derive it from `chart-3` via OKLCH lightness
steps (utility coming in a later prompt).

## Spacing, radius, shadow

- Spacing scale in `spacing.ts` — curated 8pt adjacents, deliberately
  sparse (no 13px or 17px). If a module needs "between 16 and 20", that's
  a design conversation.
- Radius: `sm` 4, `md` 6, `lg` 8, `xl` 12, `2xl` 16, `full` (pill).
  Default component radius is `md`.
- Shadows: `elevation-0..4` for general surfaces; `card` and `popover`
  for their specific roles. Dark mode shadows deeper and sharper.

## Motion

All animation durations ≤ 200ms unless user-initiated (e.g. drawer
slide). Tokens:

| Token | Duration |
|---|---|
| `--motion-fast` | 100ms — hover, press |
| `--motion-base` | 150ms — colour fades, state changes |
| `--motion-slow` | 200ms — modal / drawer enter |

Easing: `--ease-standard` (Linear-like, cubic-bezier(0.2, 0, 0, 1)).

## Density

`data-density` on the root element switches three CSS variables that
components pick up: `cell-px`, `cell-py`, `row-h`, `gap`. Applied to
DataTable row heights, Card padding, sidebar spacing.

| Mode | When |
|---|---|
| `compact` | Council members on external monitors |
| `comfortable` (default) | laptop |
| `spacious` | projected display in the Council chamber |

User preference persists — DB column in prompt 13.

## Components

See `packages/ui/src` for the source. Story-driven Storybook is deferred;
`/styleguide` in the app is the visual contract.

### Primitives

`Button`, `Badge`, `Card` + sub-parts, `Skeleton`, `Divider`, `Tooltip`,
`Dialog`, `Drawer` (right-side slide-in), `DropdownMenu`, `Popover`,
`Input`, `Label`, `Segmented` (tab-style toggle).

### Layout

- `<AppShell>` — the frame. TopBar + LeftNav + content (+ optional drawer).
- `<TopBar>` — grid of brand / centre (scope + command) / right (user).
- `<LeftNav>` — sectioned, active-state aware, badge / hint per item.
- `<RightPanel>` — Linear-style slide-in for detail views; caller keeps
  its context visible.
- `<PageHeader>` — title / subtitle / actions / filters row.
- `<Section>` — labelled content group inside a page.

### Data

- `<DataTable>` — TanStack Table v8. Sort, filter, paginate, sticky
  header, density-aware, `.font-tabular` on `meta.numeric` columns.
  **Virtualization deferred** to a follow-up prompt.
- `<KPI>` — metric tile with label / value / delta / sparkline +
  mandatory `meta` for provenance + freshness.
- `<Stat>` — inline number + label, for dense dashboards and drawer
  content.
- `<EmptyState>` — illustration slot + description + action; never
  just "no data".

### Feedback (Council-readiness trio + more)

| Component | Role |
|---|---|
| `<ProvenanceButton>` + `<ProvenanceDrawer>` | ⓘ icon next to every chart / metric → app-global drawer with sources, freshness, method. Required on every output. |
| `<FreshnessBadge>` | "Updated 2h ago" with exact timestamp tooltip; tone scales with age (fresh / stale / very stale). |
| `<ConfidenceBadge>` | High / medium / low for AI outputs; shows rationale tooltip. |
| `<Banner>` | Page-level persistent notice. |

### Visualisation

- `<ChartFrame>` — universal wrapper. Owns the title row, provenance,
  freshness, confidence, show-data toggle. Every chart type plugs in as
  `<chart>` + `<dataTable>` children.
- `<TrendLine>` — Recharts bridge. Auto-reads palette from CSS vars;
  re-renders on theme switch.
- `<Sparkline>` — inline mini-line for KPIs / table cells.
- **Deferred to module prompts** (scaffolded via the same pattern): Bar
  comparison, Horizontal bars, Heatmap, Bubble matrix, Funnel, Sankey,
  Radar, Waterfall, Choropleth (Thailand provinces).

### Navigation

- `<ScopeSelector>` — URL-synced, RBAC-aware, hierarchical picker. Full
  entity list filtered by `scopeAccess` from `/me`. Compare mode
  deferred.
- `<CommandPalette>` — Cmd/Ctrl+K. Fuzzy over faculties / departments /
  programs + custom module actions.
- `<KeyboardShortcuts>` — `?` opens this sheet. Modules register their
  own shortcuts via the `shortcuts` prop.

### AI surfaces

- `<AiInsight>` — wraps any AI output with confidence + sources +
  reasoning expandable + regenerate + disagree.
- `<AiNarrative>` — Thai-primary with on-demand EN translation toggle.
  Translator function is injected (prompt 04 wires to the LLM service).
- `<AiBrief>` — multi-section layout composed of AiInsight cards.
  Printable (ready for prompt 02c PDF export).

## Usage rules — when to use what

### Chart or DataTable?

- **Chart** when the story is the shape: trend, gap, imbalance.
- **Table** when the story is the specific number: this program, this
  year, this cost. Always provide the "show data" toggle on a chart so
  Council members can drill in.

### Side panel or new page?

- **Side panel** (`<RightPanel>`) when the deeper view is a variation
  on the list — e.g. "drill into this program's outcomes". User keeps
  context in view on the left.
- **New page** when the view has its own URL to share (Program
  Deep-Dive, Scenario Planner, Decision Record).

### Banner or Toast?

- **Banner** for persistent conditions (data source down, policy
  change).
- **Toast** for transient confirmations ("Scenario saved", "Council
  pack exported").
- **Modal** only when the user must stop and decide before proceeding —
  destructive confirmations, un-saved-work warnings.

### Brand accent (KKU Cardinal)?

- Use it on the **one** primary CTA per view.
- Use it on the brand mark in the top bar.
- Use it on a live/critical indicator (e.g. Council session in progress).
- **Not** on default buttons, nav surfaces, hover states, or large
  backgrounds.

## Accessibility checklist

- Every interactive element has a `focus-visible` ring (accent-coloured).
- Colour never carries meaning alone — always paired with text or icon.
- Chart palette tested for deuteranopia / protanopia distinguishability
  on the first 4 series. Sequential ladders should be monotonic in
  lightness.
- Text contrast ≥ AA (normal) on `surface-0` and `surface-1` for every
  text-* token.
- `<Tooltip>` is keyboard-accessible (Radix).
- `<DataTable>` headers carry `scope="col"`; numeric columns are
  right-aligned.

## Open decisions (unresolved from prompt 00)

1. IBM Plex Sans Thai legibility at 14px — validate with real Thai
   program names beside English headers in prompt 05.
2. Exact KKU Cardinal hex — confirm `#A6192E` against the official KKU
   brand guide (we're using that as the OKLCH target; a few percent
   shift is painless).
3. Dark-mode surface OKLCH ladder step count — currently 5 (0..4). Add
   a 5 if density mode needs it.
4. Whether to ship a separate "projector / Council chamber" density or
   fold it into `spacious`. Current: folded.
