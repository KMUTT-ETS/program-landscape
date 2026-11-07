# Rebrand the platform

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/guides/rebrand.md)

**Outcome.** You can replace KKU's marks and colours with your own, as the licence requires.

## The token system

Design tokens are **OKLCH triplets** in `packages/design/src/css/tokens.css`, scoped under `[data-theme='light']` and `[data-theme='dark']`. Tailwind utilities wrap them so alpha modifiers work (`bg-surface-1/80`).

`packages/design/src/tailwind-preset.ts` **replaces** — not extends — Tailwind's colour, spacing, radius, font-size, and shadow scales. `bg-slate-500` is a compile-time error by design. ESLint additionally bans literal hex and literal-numeric `rgb()`/`oklch()` calls via a `no-restricted-syntax` rule in `eslint.config.mjs`; wrappers around CSS variables are allowed.

Theme is switched via a `data-theme` attribute (not a `dark` class), through `next-themes` configured SSR-safe so there is no flash of wrong theme.

**Token naming matters more than it looks.** The convention is `--color-<family>-default`, not a bare `--color-<family>`. A wrong name does not fall back — it renders as a black box in SVG or black in HTML. Grep `tokens.css` before inventing a token name. Related: in SVG, paint `<text>` via the `fill=` attribute rather than `style.fill`.

## Rebranding checklist

| Asset | Path |
|---|---|
| Logos, light and dark | `apps/web/public/brand/kku-logo-light.png`, `kku-logo-dark.png` |
| Favicon | `apps/web/app/icon.png` — rebuild with `pnpm tsx scripts/build-favicon.ts` after replacing logos |
| Brand accent colour | `packages/design/src/tokens/color.ts` → `brandCardinal` (`default` / `hover` / `subtle`) |
| Fonts | `apps/web/app/layout.tsx`; local Sarabun fallbacks exist at `apps/web/public/fonts/sarabun/` for networks that cannot reach Google Fonts |

**Roughly 101 files under `apps/web` (`.ts`/`.tsx`) reference "KKU" or "Khon Kaen".** That is more than you would guess and includes page copy, empty-state text, PDF template headers, AI system prompts, and comments. Plan a deliberate sweep, and do it *early* — before you have written your own code on top, so the diff stays reviewable.

Consider renaming `brand-cardinal` to a neutral token name (`brand-primary`) as your first branding change. It makes every subsequent colour decision institution-agnostic and it is a mechanical find-and-replace now versus an archaeology exercise later.

## The name

The canonical product name is **"Program Landscape — KKU Curriculum Intelligence Platform"** (short form: *Program Landscape*). Three earlier names are retired and have been purged from user-facing text: *Curriculum Compass* and *ทักษทัศน์* (former internal codenames — the latter is not a meaningful Thai word), and *KKU Curriculum Landscape* (the former title). Treat all three as dead: if you find one in a comment or a historical prompt under `prompts/`, leave it as the historical record it is, but never surface it to a user. Thai copy does not translate the product name — it wraps the English name in a Thai noun phrase, e.g. *แพลตฟอร์ม Program Landscape*.

## Next step

Continue with [Adapt a methodology](./adapt-a-methodology.md).
