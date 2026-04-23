# Prompt 02b — Design System: Tokens, Theming, SaaS Component Library

> **When to use:** After auth & API core. Before any UI module work. This is the design foundation everything else inherits.
>
> **Skills to invoke this session (critical):**
> - `frontend-design` — for SaaS-grade visual quality
> - `theme-factory` — for light/dark token system
> - `brand-guidelines` — if KKU brand assets are available

---

Before starting, please read and apply:
- `/mnt/skills/public/frontend-design/SKILL.md`
- `/mnt/skills/examples/theme-factory/SKILL.md`
- `/mnt/skills/examples/brand-guidelines/SKILL.md`

Read `docs/design-system.md` (aesthetic direction from prompt 00) and `CLAUDE.md`.

---

Build the design system for KKU Curriculum Landscape. This is a modern enterprise SaaS — visual benchmarks: **Linear, Vercel Dashboard, Stripe Dashboard, Retool, Notion, Height**.

The output of this session is a complete design foundation that prompts 05–12 will reuse without redesigning.

### 1. Design tokens (`packages/design`)

**Color tokens** — semantic, not literal. Both light and dark variants.
- `surface/{0,1,2,3,4}` — background layers
- `border/{subtle,default,strong}`
- `text/{primary,secondary,tertiary,disabled,inverse}`
- `accent/{default,hover,active,subtle}` — KKU brand red, used sparingly
- `semantic/{success,warning,danger,info}` and matching subtle backgrounds
- `chart/{1..12}` — distinct, accessible chart colors that work in both modes (test all pairs for WCAG AA)
- `data-positive`, `data-negative`, `data-neutral` for financial/performance indicators

Implement as CSS variables under `[data-theme="light"]` and `[data-theme="dark"]` selectors. No hardcoded colors anywhere in the codebase from this point forward — enforce with an ESLint rule.

**Typography tokens:**
- Display, h1-h4, body, body-small, caption, code
- Use the fonts decided in prompt 00. Both fonts must support Thai script properly. Verify Thai rendering in both light + dark.
- Line heights tuned for Thai (Thai needs more line-height than Latin)
- Number font feature: tabular-nums for all data tables

**Spacing tokens:** 0, 1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 (px)

**Radius tokens:** none, sm (4), md (6), lg (8), xl (12), 2xl (16), full

**Shadow tokens:** elevation 0–4, plus a soft "card" and a sharp "popover" shadow. Both modes.

**Motion tokens:** durations (fast 100ms, base 150ms, slow 200ms), easings (standard, decelerate, accelerate). Nothing exceeds 200ms unless intentional.

**Density tokens:** compact, comfortable, spacious — adjusts spacing, row heights, font sizes. User-selectable in preferences.

### 2. Tailwind configuration

- Extend Tailwind to consume the design tokens
- Custom utilities for the SaaS patterns (e.g., `bg-surface-1`, `text-secondary`, `border-subtle`)
- Disable Tailwind's default color palette to prevent ad-hoc usage — only the token utilities are allowed

### 3. Theme provider

- `next-themes` SSR-safe; no flash of wrong theme
- Three modes: light, dark, system
- Persisted per-user in DB (already in `User.themePreference`)
- Theme toggle component in user menu — shadcn-style dropdown with three options
- Charts must re-render with theme-appropriate palette (Recharts `<ResponsiveContainer>` with theme-aware colors via context)

### 4. Component library (`packages/ui`)

Build these as shadcn/ui-extended components, all dark/light aware, all keyboard-accessible:

**Layout:**
- `<AppShell>` — top bar + left nav + content + optional right side panel
- `<TopBar>` — logo + scope selector + breadcrumbs + global search + cmd-k trigger + notifications + user menu
- `<LeftNav>` — collapsible, with section grouping, active state, badges
- `<RightPanel>` — slide-in detail panel (Linear-style) for inline drill-downs without leaving the page
- `<PageHeader>` — title + subtitle + actions + filters
- `<Section>` — labeled content group
- `<Card>` — surface container with consistent padding and elevation

**Data:**
- `<DataTable>` — sortable, filterable, pageable, selectable rows, bulk actions, density-aware, sticky header, virtualized for 1000+ rows. Built on TanStack Table.
- `<KPI>` — metric tile: label + value + delta + sparkline + provenance icon
- `<MetricCard>` — bigger version with trend chart inline
- `<Stat>` — inline number with label
- `<EmptyState>` — illustration + title + description + action
- `<Skeleton>` — loading placeholder, NOT spinners

**Inputs:**
- `<Combobox>` — Thai/English search-aware (uses `pg_trgm` on backend)
- `<DateRange>` — academic year + fiscal year + custom
- `<MultiSelect>` — chips, search, group by
- `<NumberInput>` — currency/percentage/integer variants
- `<SegmentedControl>` — tab-like selector for view modes

**Feedback:**
- `<Toast>` — sonner-style; never blocking
- `<Banner>` — page-level notice (info/warning/danger)
- `<ConfidenceBadge>` — high/medium/low with tooltip explanation (used on every AI output)
- `<FreshnessBadge>` — "Updated 2h ago" / "Stale" with tooltip showing exact timestamp + source
- `<ProvenanceButton>` — small ⓘ icon, opens drawer showing data lineage

**Visualization:**
- `<Chart>` — abstraction over Recharts/visx, theme-aware, with built-in provenance, freshness, and "show data table" toggle
- Pre-built chart components: `<TrendLine>`, `<BarComparison>`, `<HorizontalBars>`, `<Heatmap>`, `<BubbleMatrix>`, `<Funnel>`, `<Sankey>`, `<Radar>`, `<Waterfall>`, `<Choropleth>` (Thailand provinces)
- All accept light/dark theme automatically
- All have a "Show data" toggle exposing the underlying numbers (accessibility + audit)
- All have a "Provenance" button (small ⓘ in corner) — wired to provenance drawer

**Navigation:**
- `<CommandPalette>` — Cmd/Ctrl+K. Fuzzy search across: pages, programs, departments, faculties, recent items, actions
- `<KeyboardShortcuts>` — pressed `?` shows all shortcuts
- `<ScopeSelector>` — central component — see next section

### 5. Scope selector (`<ScopeSelector />`) — critical shared component

This appears in the top bar on every analytical page. Lets the user switch between **University / Faculty / Department / Program**.

- Hierarchical picker: choose level, then choose entity (with search)
- Shows breadcrumb after selection: "University / Faculty of Engineering / Computer Engineering / Software Engineering Program"
- Persists to URL (`?scope=department&scopeId=cse-eng`)
- Respects RBAC — DEAN sees only their faculty's tree expandable; DEPT_HEAD sees only their department
- Has a "compare" mode: pick 2–4 scopes for side-by-side comparison
- Recently used scopes for quick access
- Designed to feel like Linear's project switcher or Notion's workspace switcher

### 6. AI insight surface components

Used wherever AI generates content:

- `<AiInsight>` — wraps any AI-generated content with: confidence badge, sources list, "regenerate" button, "show reasoning" expandable, "disagree" feedback button
- `<AiNarrative>` — Thai prose with EN translation toggle, attribution, freshness
- `<AiBrief>` — multi-section AI brief layout, printable

### 7. Provenance drawer

- Slide-out drawer (right side) shown when any `<ProvenanceButton>` is clicked
- Sections: Data sources (with timestamps + URLs), Calculation method (link to methodology doc), Last refreshed, Methodology version, Caveats
- Reusable across every chart and metric

### 8. Storybook

Set up Storybook in `packages/ui`. One story per component, both light and dark, multiple states. Used as visual regression testing baseline.

### 9. Documentation

Update `docs/design-system.md` with:
- Token reference (full table)
- Component catalog
- Usage rules (when to use which chart, when to use side panel vs new page, etc.)
- Accessibility checklist
- Density behavior

### 10. Demo page

Create `/styleguide` (admin only in production, public in dev) showing all components in both themes, both densities. This is your visual contract going forward.

### Tests
- Storybook builds successfully
- Theme switch doesn't flash incorrect theme on load
- Every chart component renders correctly in both themes
- Command palette opens with Cmd+K and finds at least: a program, a faculty, a department, an action
- Density toggle changes spacing globally
- ESLint rule rejects hardcoded color values

### Deliverables
- Working `/styleguide` page
- Storybook deployed locally
- Token reference doc
- Screenshot description (or actual run) of light + dark
- 3 suggestions for next session — my plan is the data ingestion framework
