# Design system — aesthetic direction

> This document captures the **aesthetic direction** for KKU Curriculum
> Landscape. The detailed token system, component library, and Storybook
> live in `packages/design` and `packages/ui`, built in **prompt 02b**.
>
> Purpose: anchor the decisions that prompt 02b expands — so the design
> doesn't drift into generic AI aesthetics.

## Brief (from prompt 00)

> A modern enterprise SaaS for university leadership — confident, data-dense
> but breathable, professional but not boring, suggesting institutional
> gravitas without feeling bureaucratic.

**Reference points:**

- **Linear** — clarity, restraint, meaningful motion
- **Stripe Dashboard** — how to present data density without overwhelm
- **Notion** — calm density, typographic hierarchy
- (secondary) Vercel Dashboard, Retool, Height

**Anti-references (what we are *not*):**

- Generic shadcn-on-Inter default (clean but identity-less)
- University IT system aesthetics (cluttered, over-chromed, bureaucratic)
- Consumer BI tools (Power BI / Tableau chartjunk)

## Typography

The UI needs **strong Thai support** (data labels, program names) even
though UI labels are English-only. Body font must render 14–16px Thai
cleanly alongside English headers; numeric columns need a matching
monospace for tabular alignment.

**Note — name collision to avoid:** *TH Sarabun New* is the Cabinet-mandated
font for **PDF output** (see prompt 02c). It is **not** the UI body font
(its proportions and weights aren't built for on-screen UI at 14–16px). The
options below are for the **UI** only.

### Option 1 — IBM Plex Sans Thai (recommended) + IBM Plex Mono

- **Body/UI:** IBM Plex Sans Thai
- **Numeric/code:** IBM Plex Mono
- **Display:** same family, heavier weights (600–700)

**Why:**

- Distinctive without being loud. Visual vocabulary of Stripe, IBM
  enterprise, developer-facing SaaS — aligns with the "institutional
  gravitas, not bureaucratic" target.
- First-class Thai coverage across 7 weights (Thin → Bold) with matching
  Italic styles. Draws cleanly at 14px with Thai diacritics.
- Plex Mono is one of the best monospaces for tabular numerics — essential
  for dense tables (financial columns, headcount columns).
- Family cohesion simplifies the token system (one family, three roles).
- Open source (SIL OFL). Self-hostable. No Google Fonts dependency in
  production.

**Cons:**

- Slightly technical feel. Mitigated by typographic scale + generous
  leading.

### Option 2 — Sarabun + Prompt (strong Thai cultural grounding)

- **Body/UI:** Sarabun (Cadson Demak) — **not** "TH Sarabun New"; a
  different family despite similar name
- **Display:** Prompt (Cadson Demak) — loopless geometric Thai/Latin

**Why:**

- Maximally Thai-native. Sarabun reads as Thai-first in a way IBM Plex
  does not.
- Prompt's loopless display forms provide strong contrast for headings.
- Both on Google Fonts, both SIL OFL.

**Cons:**

- Sarabun is ubiquitous in Thai government contexts (risk: "feels like a
  government form"). Not the image we want.
- Name overlap with TH Sarabun New will confuse future Claude sessions;
  we'd need clear comments in the token files.

### Option 3 — Noto Sans Thai Looped + JetBrains Mono (safe cross-platform)

- **Body/UI:** Noto Sans Thai Looped (body) + Noto Sans (Latin pairing)
- **Numeric/code:** JetBrains Mono or IBM Plex Mono

**Why:**

- Google's Noto family has the broadest character coverage and aggressive
  maintenance.
- Noto Sans Thai Looped is the looped-Thai-preferred counterpart suited
  to academic contexts.

**Cons:**

- Ubiquity of Noto makes it the "safe" choice, which undermines the
  distinctiveness goal.

### Decision

**Option 1 — IBM Plex Sans Thai + IBM Plex Mono.** Reconsidered in prompt
02b against live mockups; override then if it doesn't hold up at UI sizes
with Thai text next to English headers.

## Color

Full palette and tokens (with WCAG-AA verified ratios in both modes) are
generated in prompt 02b. This section commits to the *direction* only.

### Base (both modes)

- **Warm neutrals** as base surface, not cool greys. Target a slight warm
  cast closer to Stripe's stone palette than Linear's cool greys.
- Light mode surface: off-white paper (`~#FAFAF9`), not pure `#FFFFFF`.
- Dark mode surface: warm near-black (`~#0C0A09`), not pure `#000000`.
  Chart legibility degrades on pure black; warm near-black preserves form.

### Accents

- **Brand accent — KKU Cardinal (`~#A6192E`).**
  - **Used only** for: the primary CTA in a view (at most one), brand
    marks, critical live indicators (ongoing Council session, urgent
    flags).
  - **Not used** for: nav backgrounds, default buttons, large surfaces,
    hover states. This protects the accent from wearing out.
- **Interactive secondary — indigo (`~#4F46E5` family).** For default
  interactive affordances (links, focus rings, default buttons). Keeps
  interaction signaling separate from institutional branding.

### Semantic (both modes, both WCAG AA)

- **Healthy:** emerald (warm-side green). Deliberately *not* KKU red's
  complement, to avoid confusion with risk.
- **Caution:** amber.
- **At-risk:** a **different red** from KKU Cardinal — a pure red
  (`~#DC2626`) reserved for risk states. The brand red must not double as
  the "danger" signal; deans would interpret the red badge on a program
  card as institutional rejection rather than risk flag.
- **Informational:** blue/indigo.

### Charting palette

- A curated **6-colour categorical palette**, tested for colour-blind
  safety (deuteranopia, protanopia) and for WCAG-AA contrast against both
  the light and the dark surface.
- Extended palettes derived via OKLCH lightness steps for sequential and
  diverging scales — not arbitrary HSL.
- No charting-library default palettes — every chart uses tokens.

## Motion

- **Framer Motion, ≤200ms** for page-level transitions; 120–160ms for
  affordance-level (hover, press).
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` ("exit") for entering elements;
  standard `ease-in-out` for state changes. Linear's feel.
- **No decorative motion.** Motion signals state change; if a motion
  doesn't carry information, remove it.

## Density

- Three density modes (user-selectable, persisted per user):
  - **Compact** — Council members on big external monitors
  - **Comfortable** (default) — laptop use, mixed reading + scanning
  - **Spacious** — presentation mode, Council meeting rooms on
    projected displays
- Density affects row height, padding, chart tick density — not font
  *family*, only *size* and *spacing*.

## Data-density principles (Stripe-adjacent)

- **Breathe the data.** Use whitespace to give weight to the numbers that
  matter; don't cram.
- **Tabular numerics are sacred.** All numeric columns in tables use
  `font-variant-numeric: tabular-nums` + mono family. Right-aligned.
- **Secondary data in lower contrast**, not smaller size — readers
  fatigue with 11px text.
- **Sparklines over big charts** when the context is already a row.
- **Side panels over full-page navigation** (Linear pattern) for detail
  views that supplement a list.

## Surfaces & components (to be built in prompt 02b)

This list exists so prompt 02b has a concrete target:

- `<ScopeSelector>` (university / faculty / department / program)
- `<ProvenanceButton>` + `<ProvenanceDrawer>`
- `<ConfidenceBadge>`
- `<FreshnessBadge>`
- `<Chart>` wrapper (the single charting entry point)
- `<Table>` with sort / filter / bulk / saved-view
- `<CommandPalette>` (cmdk)
- `<SidePanel>` (Linear-style detail view)
- `<EmptyState>` (helpful, not decorative)
- `<AiInsightCard>` (narrative + confidence + sources + disagree button)

## What NOT to do

- ❌ Don't default to Inter.
- ❌ Don't use KKU Cardinal red as a surface colour or default button.
- ❌ Don't use the same red for "at-risk" that we use for the KKU brand.
- ❌ Don't hardcode colour, font, spacing — everything through tokens.
- ❌ Don't introduce Material or Ant Design — shadcn + Tailwind + tokens.
- ❌ Don't use emojis as icons; use Lucide (consistent with shadcn).
- ❌ Don't put anything critical behind colour alone — always back with
  text label, icon, or pattern for colour-blind users.

## Open decisions for prompt 02b

1. Confirm IBM Plex Sans Thai holds up at 14px alongside English headers
   in real mockups before we commit.
2. Exact KKU Cardinal hex — confirm against the official KKU brand guide;
   `#A6192E` is a common internet approximation.
3. Dark-mode surface OKLCH ladder: 6 steps? 8?
4. Whether to ship a separate "print / projector" density or fold it into
   "spacious".
