# White label, Phase 2 (Brand): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin sets the organisation's brand at `/admin/organization?tab=brand`: a primary and an optional secondary colour, plus light/dark logos and a favicon. The web chrome follows the setting at runtime, with no rebuild. KKU's deployment keeps looking exactly as it does today.

**Architecture:**
- **Colour derivation.** A pure, client-safe module `@kku/shared/brand` turns a hex colour into OKLCH design-token values for light and dark mode, then runs a WCAG contrast gate.
- **Storage.** The API derives and validates the tokens on save and stores them as JSON on the existing `organization_profile` singleton. Logo files go to a MinIO bucket `branding`.
- **Serving.** The web root layout injects the stored tokens as a `<style>` tag in the first HTML response. A same-origin route `/brand/<asset>` streams the logos and favicon, falling back to a built-in neutral product mark.
- **KKU.** The KKU seed fills only the brand fields that are still empty, using KKU's current logo files and colours.

**Tech Stack:** Next.js 14 App Router (server components, route handlers, `generateMetadata`), NestJS + multer `FileInterceptor`, Prisma 5 / PostgreSQL 16, MinIO through `@kku/shared` `S3Storage` (api) and `@aws-sdk/client-s3` (web, as in `avatar-storage.ts`), Zod, Vitest, sonner.

**Spec:** `docs/superpowers/specs/2026-10-15-white-label-organization-design.md`. This plan covers §15 phase 2: §3 (brand columns), §5, §6, §7, §11 (Brand tab), §12 (brand and asset endpoints), plus the KKU seed parts of §3/§16. It builds on Phase 1 (`docs/superpowers/plans/2026-10-15-white-label-phase1-foundation.md`), which is already committed on `feat/white-label`.

## Global Constraints

- One organisation per install; the profile row id is always `'default'`. Brand fields live on `organization_profile`.
- **Tokens that move:** primary → `--color-accent-{default,hover,active,subtle,fg}`; secondary → `--color-brand-cardinal{,-hover,-subtle}`, in light and dark mode. Nothing else moves (charts, status, risk red, surfaces, text, borders). Token *names* never change.
- **Fonts stay fixed.** The product name stays **Program Landscape**. The tagline is `{shortNameEn} Curriculum Intelligence Platform`.
- **Uploads:**
  - Logos: PNG or SVG, ≤ 1 MB, ≤ 2048 px per side (PNG; read from the IHDR header).
  - Favicon: PNG only, square, ≥ 32 px.
  - Storage: MinIO bucket from env `MINIO_BUCKET_BRANDING`, default `branding`, created on first use.
- **SVG safety (deviation from spec §6, recorded on purpose).** An SVG containing any of `<script`, `<foreignObject`, an `on…=` attribute, `javascript:`, or an `href`/`xlink:href` whose value is not `#…` or `data:image/…` is **rejected** with a clear message, not stripped. Rejecting is stricter than stripping and needs no HTML-parser dependency. SVG responses carry `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `X-Content-Type-Options: nosniff`.
- **Contrast gate (deviation from spec §5.2 step 5, recorded on purpose).**
  - Primary: `fg` on `default` ≥ 4.5:1 in both modes.
  - Secondary: `default` against `surface-0` ≥ 4.5:1 in both modes. Secondary is used as text and accents on surfaces.
  - Both colours: chroma C < 0.04 is rejected ("too close to grey — pick a stronger shade").
  - The spec's "primary `default` vs `surface-0` ≥ 3:1" check is **dropped**: today's KKU pastel coral measures about 2.2:1 against the cream canvas, so that check would reject KKU's own colour and break R9 (KKU looks unchanged). The pastel accent is a fill behind dark text, not a boundary.
- **Asset URLs** are `/brand/logo-light?v=<version>`, `/brand/logo-dark?v=<version>` and `/brand/favicon?v=<version>`. Every brand or asset change bumps `version`.
- **Edit permission:** `settings:configure`. Every mutation carries `@AuditLog`.
- **The KKU seed never overwrites** a non-null field. It fills null brand fields only.
- TypeScript strict, no `any`. Zod on every input. Design tokens only (no hex literals in UI code; the hex *values* an admin enters are data). `border-default`, never `border-border-default`. For translucent status borders use `border-[oklch(var(--color-…-default)/0.4)]`. sonner toasts, not modals.
- **Migrations:** hand-written SQL in a new timestamped folder, applied with `pnpm db:migrate`. Never run the interactive Prisma migration commands (the repo guard blocks them).
- **Process:**
  - Commit trailer: `Co-Authored-By:` naming the model that wrote the commit.
  - Use `git commit -F <file>`; never `--no-verify`.
  - Never read the real `.env`.
  - No personal emails or ids in committed files.

## Review Focus

1. **The web build runs with no database or MinIO reachable.** `next build` pre-renders some pages; reading the profile must not crash it. Expect fallback chrome (no injected style, the product mark, the plain title). Tested in Task 5 (`brandingForRequest` returns `null` when the read throws).
2. **The stored brand JSON is tampered with or malformed.** A row edited by hand, or an older format, must never inject arbitrary CSS into every page. `brandCss` emits only whitelisted token names with values matching the strict OKLCH pattern; anything else is dropped. Tested in Task 1.
3. **An uploaded asset disappears from MinIO, or MinIO is down.** `/brand/<asset>` must serve the built-in mark (200), not a broken image or a 500. Tested in Task 4.
4. **An admin removes a logo after uploading one.** The UI falls back to the product mark, and the version bump busts the cached URL. Tested in Task 2 (`setOrganizationAsset(kind, null)` bumps the version) and Task 4 (null key → fallback).
5. **An install has not been configured yet.** Every page renders. The setup banner shows. The title is plain "Program Landscape". The favicon is the product mark. Tested in Task 5 (metadata helper with `null`) and Task 6 (banner render test).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/brand/color.ts` (create) | hex ⇄ OKLCH ⇄ sRGB, gamut clamp, WCAG contrast |
| `packages/shared/src/brand/derive.ts` (create) | `deriveBrandTokens`, `BrandTokens`, `BrandCheck` |
| `packages/shared/src/brand/css.ts` (create) | `brandCss(tokens)` with whitelist and value validation |
| `packages/shared/src/brand/index.ts` (create) | barrel; published as subpath `@kku/shared/brand` (client-safe) |
| `packages/shared/src/organization/schema.ts` (modify) | `OrganizationBrandInputSchema`, extended `OrganizationPublicView`, `BRAND_ASSET_KINDS` |
| `packages/db/prisma/schema.prisma` + migration (modify/create) | brand columns |
| `packages/db/src/organization.ts` (modify) | `saveOrganizationBrand`, `setOrganizationAsset`, `brandAssetUrls` |
| `apps/api/src/organization/asset-validation.ts` (create) | PNG/SVG checks (pure) |
| `apps/api/src/organization/branding-storage.service.ts` (create) | MinIO put |
| `apps/api/src/organization/*` (modify) | brand and asset endpoints, public view |
| `apps/web/src/lib/branding.ts` (create) | `brandingForRequest()`, metadata helper, storage read |
| `apps/web/src/components/brand/*` (create) | `ProductMark`, `OrgLogo`, `SetupBanner` |
| `apps/web/app/brand/[asset]/route.ts` (create) | asset streaming with fallback |
| `apps/web/app/layout.tsx`, `apps/web/middleware.ts` (modify) | style injection, metadata, public path |
| chrome files (modify) | shell, profile hero, sign-in, footer, home title |
| `apps/web/app/admin/organization/*` (modify) + proxies (create) | Brand tab |
| `apps/ingestion/assets/kku/*` (move), `org-seed-kku.ts`, `Dockerfile.prod` (modify) | KKU brand seed |

---

### Task 1: `@kku/shared/brand`: colour maths, token derivation, safe CSS

**Files:**
- Create: `packages/shared/src/brand/color.ts`, `packages/shared/src/brand/derive.ts`, `packages/shared/src/brand/css.ts`, `packages/shared/src/brand/index.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './brand';`), `packages/shared/package.json` (`exports`: add `"./brand": "./src/brand/index.ts"` and `"./src/brand": "./src/brand/index.ts"`, following the existing client-safe subpath pattern; add one sentence to the `//exports` note saying `./brand` is client-safe, pure maths with no node imports)
- Test: `packages/shared/test/brand-color.test.ts`, `packages/shared/test/brand-derive.test.ts`, `packages/shared/test/brand-css.test.ts`

**Interfaces:**
- Produces:
  - `interface Oklch { l: number /* 0..1 */; c: number; h: number /* degrees */ }`
  - `hexToOklch(hex: string): Oklch`, which throws on an invalid hex
  - `oklchToHex(o: Oklch): string` (`#rrggbb`, gamut-clamped)
  - `clampToGamut(o: Oklch): Oklch`
  - `contrastRatio(a: Oklch, b: Oklch): number`
  - `formatOklch(o: Oklch): string`, e.g. `'70.0% 0.150 45'`
  - `type BrandTokenName = 'accent-default' | 'accent-hover' | 'accent-active' | 'accent-subtle' | 'accent-fg' | 'brand-cardinal' | 'brand-cardinal-hover' | 'brand-cardinal-subtle'`
  - `interface BrandTokens { light: Partial<Record<BrandTokenName, string>>; dark: Partial<Record<BrandTokenName, string>> }`
  - `interface BrandCheck { name: string; mode: 'light' | 'dark'; ratio: number; required: number; pass: boolean }`
  - `deriveBrandTokens(primaryHex: string | null, secondaryHex: string | null): { tokens: BrandTokens; checks: BrandCheck[]; ok: boolean; errors: string[] }`
  - `brandCss(tokens: unknown): string`, which returns `''` when nothing valid remains
  - `HEX_COLOR = /^#[0-9a-fA-F]{6}$/`

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/brand-color.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clampToGamut, contrastRatio, formatOklch, hexToOklch, oklchToHex } from '../src/brand';

describe('hexToOklch', () => {
  it('white and black sit at the ends of lightness with no chroma', () => {
    expect(hexToOklch('#ffffff').l).toBeCloseTo(1, 3);
    expect(hexToOklch('#ffffff').c).toBeLessThan(0.0005);
    expect(hexToOklch('#000000').l).toBeCloseTo(0, 3);
  });

  it('matches the published OKLCH of pure sRGB red', () => {
    const red = hexToOklch('#ff0000');
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
  });

  it('rejects malformed input', () => {
    expect(() => hexToOklch('red')).toThrow();
    expect(() => hexToOklch('#ff00')).toThrow();
  });
});

describe('oklchToHex / clampToGamut', () => {
  it('round-trips an in-gamut colour', () => {
    expect(oklchToHex(hexToOklch('#3a7bd5')).toLowerCase()).toBe('#3a7bd5');
  });

  it('reduces chroma, never lightness or hue, to reach the sRGB gamut', () => {
    const out = clampToGamut({ l: 0.9, c: 0.4, h: 140 });
    expect(out.l).toBe(0.9);
    expect(out.h).toBe(140);
    expect(out.c).toBeLessThan(0.4);
    expect(oklchToHex(out)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white and symmetric', () => {
    const w = hexToOklch('#ffffff');
    const k = hexToOklch('#000000');
    expect(contrastRatio(w, k)).toBeCloseTo(21, 1);
    expect(contrastRatio(k, w)).toBeCloseTo(21, 1);
  });
});

describe('formatOklch', () => {
  it('formats like tokens.css', () => {
    expect(formatOklch({ l: 0.7, c: 0.15, h: 45 })).toBe('70.0% 0.150 45');
  });
});
```

`packages/shared/test/brand-derive.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveBrandTokens, oklchToHex } from '../src/brand';

// Today's coral and cardinal, from packages/design/src/css/tokens.css.
const CORAL = oklchToHex({ l: 0.7, c: 0.15, h: 45 });
const CARDINAL = oklchToHex({ l: 0.44, c: 0.165, h: 20 });

function parse(v: string | undefined): { L: number; C: number; H: number } {
  const m = /^(\d+\.\d)% (\d\.\d{3}) (\d+)$/.exec(v ?? '');
  if (!m) throw new Error(`bad token ${v}`);
  return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) };
}

describe('deriveBrandTokens', () => {
  it('reproduces today\'s coral accent steps (lightness exact, chroma within 0.006)', () => {
    const { tokens, ok } = deriveBrandTokens(CORAL, null);
    expect(ok).toBe(true);
    const expected: Array<[keyof typeof tokens.light, 'light' | 'dark', number, number]> = [
      ['accent-default', 'light', 70.0, 0.15],
      ['accent-hover', 'light', 76.0, 0.14],
      ['accent-active', 'light', 62.0, 0.165],
      ['accent-subtle', 'light', 95.5, 0.04],
      ['accent-default', 'dark', 53.0, 0.18],
      ['accent-hover', 'dark', 48.0, 0.19],
      ['accent-active', 'dark', 43.0, 0.195],
      ['accent-subtle', 'dark', 30.0, 0.06],
    ];
    for (const [name, mode, L, C] of expected) {
      const t = parse(tokens[mode][name]);
      expect(t.L, `${mode} ${name} L`).toBe(L);
      expect(Math.abs(t.C - C), `${mode} ${name} C`).toBeLessThanOrEqual(0.006);
    }
    expect(parse(tokens.light['accent-fg']).L).toBe(22.0); // dark text on pastel
    expect(parse(tokens.dark['accent-fg']).L).toBe(99.0); // light text in dark mode
  });

  it('reproduces today\'s cardinal steps', () => {
    const { tokens, ok } = deriveBrandTokens(CORAL, CARDINAL);
    expect(ok).toBe(true);
    expect(parse(tokens.light['brand-cardinal']).L).toBe(44.0);
    expect(parse(tokens.light['brand-cardinal-hover']).L).toBe(48.5);
    expect(parse(tokens.light['brand-cardinal-subtle']).L).toBe(95.0);
    expect(parse(tokens.dark['brand-cardinal']).L).toBe(62.0);
    expect(Math.abs(parse(tokens.dark['brand-cardinal']).C - 0.175)).toBeLessThanOrEqual(0.006);
    expect(parse(tokens.dark['brand-cardinal-subtle']).L).toBe(25.0);
  });

  it('omits the cardinal tokens when no secondary colour is given', () => {
    const { tokens } = deriveBrandTokens(CORAL, null);
    expect(tokens.light['brand-cardinal']).toBeUndefined();
    expect(tokens.dark['brand-cardinal']).toBeUndefined();
  });

  it('returns no tokens and ok:true when neither colour is set', () => {
    expect(deriveBrandTokens(null, null)).toMatchObject({ ok: true, tokens: { light: {}, dark: {} } });
  });

  it('rejects a near-grey colour with a readable reason', () => {
    const r = deriveBrandTokens('#808585', null);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/too close to grey/i);
  });

  it('reports every contrast check with its ratio', () => {
    const r = deriveBrandTokens(CORAL, CARDINAL);
    expect(r.checks.map((c) => `${c.name}/${c.mode}`).sort()).toEqual([
      'primary text on primary/dark',
      'primary text on primary/light',
      'secondary on page/dark',
      'secondary on page/light',
    ]);
    for (const c of r.checks) expect(c.pass).toBe(c.ratio >= c.required);
  });

  it('rejects an invalid hex for either colour', () => {
    expect(deriveBrandTokens('nothex', null).ok).toBe(false);
    expect(deriveBrandTokens(CORAL, '#12345').ok).toBe(false);
  });
});
```

`packages/shared/test/brand-css.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { brandCss } from '../src/brand';

describe('brandCss', () => {
  it('emits higher-specificity overrides for both modes', () => {
    const css = brandCss({ light: { 'accent-default': '70.0% 0.150 45' }, dark: { 'accent-default': '53.0% 0.180 45' } });
    expect(css).toBe(
      "html[data-theme='light']{--color-accent-default:70.0% 0.150 45;}" +
        "html[data-theme='dark']{--color-accent-default:53.0% 0.180 45;}",
    );
  });

  it('drops unknown token names and values that are not strict OKLCH triplets', () => {
    const css = brandCss({
      light: {
        'accent-default': '70.0% 0.150 45;}body{display:none',
        'surface-0': '99.0% 0.008 70',
        'accent-hover': '76.0% 0.140 45',
      },
      dark: 'nope',
    });
    expect(css).toBe("html[data-theme='light']{--color-accent-hover:76.0% 0.140 45;}");
  });

  it('returns an empty string for null, garbage or empty input', () => {
    expect(brandCss(null)).toBe('');
    expect(brandCss('x')).toBe('');
    expect(brandCss({ light: {}, dark: {} })).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @kku/shared exec vitest run test/brand-color.test.ts test/brand-derive.test.ts test/brand-css.test.ts`
Expected: FAIL with "Cannot find module '../src/brand'".

- [ ] **Step 3: Implement**

`packages/shared/src/brand/color.ts`:

```ts
// OKLCH ⇄ sRGB maths (Björn Ottosson's OKLab, 2020) and WCAG 2.x contrast.
// Pure functions, no imports — this module ships to the browser through the
// `@kku/shared/brand` subpath.

export interface Oklch {
  /** Lightness 0..1 */
  l: number;
  c: number;
  /** Hue in degrees 0..360 */
  h: number;
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type Rgb = [number, number, number];

const toLinear = (x: number): number => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const toGamma = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

function hexToLinear(hex: string): Rgb {
  if (!HEX_COLOR.test(hex)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}

function linearToOklch([r, g, b]: Rgb): Oklch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.sqrt(A * A + B * B);
  const h = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function oklchToLinear({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: Rgb): boolean => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

export function hexToOklch(hex: string): Oklch {
  return linearToOklch(hexToLinear(hex));
}

/** Lowers chroma (only) until the colour fits sRGB. */
export function clampToGamut(o: Oklch): Oklch {
  if (inGamut(oklchToLinear(o))) return o;
  let lo = 0;
  let hi = o.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear({ ...o, c: mid }))) lo = mid;
    else hi = mid;
  }
  return { ...o, c: lo };
}

export function oklchToHex(o: Oklch): string {
  const rgb = oklchToLinear(clampToGamut(o));
  return (
    '#' +
    rgb
      .map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

function luminance(o: Oklch): number {
  const [r, g, b] = oklchToLinear(clampToGamut(o)).map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Same shape as the triplets in tokens.css: `70.0% 0.150 45`. */
export function formatOklch(o: Oklch): string {
  return `${(o.l * 100).toFixed(1)}% ${o.c.toFixed(3)} ${Math.round(o.h) % 360}`;
}
```

`packages/shared/src/brand/derive.ts`:

```ts
import { HEX_COLOR, clampToGamut, contrastRatio, formatOklch, hexToOklch, type Oklch } from './color';

// The admin picks a hue; the system picks the lightness. Each step below is
// the lightness (and chroma multiplier) of today's coral / cardinal tokens in
// packages/design/src/css/tokens.css, so a coral input reproduces them.
// Spec: docs/superpowers/specs/2026-10-15-white-label-organization-design.md §5.

export type BrandTokenName =
  | 'accent-default'
  | 'accent-hover'
  | 'accent-active'
  | 'accent-subtle'
  | 'accent-fg'
  | 'brand-cardinal'
  | 'brand-cardinal-hover'
  | 'brand-cardinal-subtle';

export const BRAND_TOKEN_NAMES: readonly BrandTokenName[] = [
  'accent-default',
  'accent-hover',
  'accent-active',
  'accent-subtle',
  'accent-fg',
  'brand-cardinal',
  'brand-cardinal-hover',
  'brand-cardinal-subtle',
];

export interface BrandTokens {
  light: Partial<Record<BrandTokenName, string>>;
  dark: Partial<Record<BrandTokenName, string>>;
}

export interface BrandCheck {
  name: string;
  mode: 'light' | 'dark';
  ratio: number;
  required: number;
  pass: boolean;
}

type Mode = 'light' | 'dark';
type Step = { l: number; cx: number };

const PRIMARY_STEPS: Record<Mode, Record<'accent-default' | 'accent-hover' | 'accent-active' | 'accent-subtle', Step>> = {
  light: {
    'accent-default': { l: 0.7, cx: 1 },
    'accent-hover': { l: 0.76, cx: 0.93 },
    'accent-active': { l: 0.62, cx: 1.1 },
    'accent-subtle': { l: 0.955, cx: 0.27 },
  },
  dark: {
    'accent-default': { l: 0.53, cx: 1.2 },
    'accent-hover': { l: 0.48, cx: 1.27 },
    'accent-active': { l: 0.43, cx: 1.3 },
    'accent-subtle': { l: 0.3, cx: 0.4 },
  },
};

const SECONDARY_STEPS: Record<Mode, Record<'brand-cardinal' | 'brand-cardinal-hover' | 'brand-cardinal-subtle', Step>> = {
  light: {
    'brand-cardinal': { l: 0.44, cx: 1 },
    'brand-cardinal-hover': { l: 0.485, cx: 1 },
    'brand-cardinal-subtle': { l: 0.95, cx: 0.11 },
  },
  dark: {
    'brand-cardinal': { l: 0.62, cx: 1.06 },
    'brand-cardinal-hover': { l: 0.665, cx: 1.06 },
    'brand-cardinal-subtle': { l: 0.25, cx: 0.3 },
  },
};

/** surface-0 per mode, from tokens.css. */
const SURFACE_0: Record<Mode, Oklch> = {
  light: { l: 0.99, c: 0.008, h: 70 },
  dark: { l: 0.115, c: 0.014, h: 50 },
};

const MIN_CHROMA = 0.04;
const MIN_TEXT_CONTRAST = 4.5;
const MODES: Mode[] = ['light', 'dark'];

const step = (base: Oklch, s: Step): Oklch => clampToGamut({ l: s.l, c: base.c * s.cx, h: base.h });

function parseInput(label: string, hex: string, errors: string[]): Oklch | null {
  if (!HEX_COLOR.test(hex)) {
    errors.push(`${label} colour must look like #rrggbb.`);
    return null;
  }
  const o = hexToOklch(hex);
  if (o.c < MIN_CHROMA) {
    errors.push(`${label} colour is too close to grey — pick a stronger shade.`);
    return null;
  }
  return o;
}

export function deriveBrandTokens(
  primaryHex: string | null,
  secondaryHex: string | null,
): { tokens: BrandTokens; checks: BrandCheck[]; ok: boolean; errors: string[] } {
  const tokens: BrandTokens = { light: {}, dark: {} };
  const checks: BrandCheck[] = [];
  const errors: string[] = [];

  const primary = primaryHex ? parseInput('Primary', primaryHex, errors) : null;
  const secondary = secondaryHex ? parseInput('Secondary', secondaryHex, errors) : null;

  if (primary) {
    for (const mode of MODES) {
      const steps = PRIMARY_STEPS[mode];
      const def = step(primary, steps['accent-default']);
      for (const [name, s] of Object.entries(steps) as [keyof typeof steps, Step][]) {
        tokens[mode][name] = formatOklch(step(primary, s));
      }
      const dark: Oklch = clampToGamut({ l: 0.22, c: Math.min(0.05, primary.c), h: primary.h });
      const light: Oklch = { l: 0.99, c: 0.005, h: primary.h };
      const fg = contrastRatio(dark, def) >= contrastRatio(light, def) ? dark : light;
      tokens[mode]['accent-fg'] = formatOklch(fg);
      const ratio = contrastRatio(fg, def);
      checks.push({ name: 'primary text on primary', mode, ratio, required: MIN_TEXT_CONTRAST, pass: ratio >= MIN_TEXT_CONTRAST });
    }
  }

  if (secondary) {
    for (const mode of MODES) {
      const steps = SECONDARY_STEPS[mode];
      for (const [name, s] of Object.entries(steps) as [keyof typeof steps, Step][]) {
        tokens[mode][name] = formatOklch(step(secondary, s));
      }
      const ratio = contrastRatio(step(secondary, steps['brand-cardinal']), SURFACE_0[mode]);
      checks.push({ name: 'secondary on page', mode, ratio, required: MIN_TEXT_CONTRAST, pass: ratio >= MIN_TEXT_CONTRAST });
    }
  }

  for (const c of checks) {
    if (!c.pass) errors.push(`${c.name} (${c.mode} mode) is ${c.ratio.toFixed(2)}:1; needs ${c.required}:1.`);
  }
  return { tokens, checks, ok: errors.length === 0, errors };
}
```

`packages/shared/src/brand/css.ts`:

```ts
import { BRAND_TOKEN_NAMES, type BrandTokenName } from './derive';

// Turns stored tokens into the <style> the root layout injects. The input is
// read back from the database, so it is treated as untrusted: only whitelisted
// token names and strict `L% C H` values survive — nothing else can reach the
// page's CSS. `html[data-theme=…]` outranks tokens.css's `[data-theme=…]`
// regardless of stylesheet order.

const VALUE = /^\d{1,3}\.\d% \d\.\d{3} \d{1,3}$/;
const MODES = ['light', 'dark'] as const;

export function brandCss(tokens: unknown): string {
  if (!tokens || typeof tokens !== 'object') return '';
  let css = '';
  for (const mode of MODES) {
    const block = (tokens as Record<string, unknown>)[mode];
    if (!block || typeof block !== 'object') continue;
    let decls = '';
    for (const name of BRAND_TOKEN_NAMES) {
      const v = (block as Record<string, unknown>)[name as BrandTokenName];
      if (typeof v === 'string' && VALUE.test(v)) decls += `--color-${name}:${v};`;
    }
    if (decls) css += `html[data-theme='${mode}']{${decls}}`;
  }
  return css;
}
```

`packages/shared/src/brand/index.ts`:

```ts
export * from './color';
export * from './derive';
export * from './css';
```

Make the two `package.json` edits and the barrel line listed under Files.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @kku/shared exec vitest run test/brand-color.test.ts test/brand-derive.test.ts test/brand-css.test.ts && pnpm --filter @kku/shared typecheck`
Expected: PASS and a clean typecheck.

If the coral reproduction test fails on chroma, inspect the gamut clamp before touching the multipliers. The multipliers are copied from tokens.css and are correct by construction. Report any value that is out of tolerance rather than widening the tolerance.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/brand packages/shared/src/index.ts packages/shared/package.json packages/shared/test/brand-*.test.ts
printf 'feat(shared): brand colour derivation and safe CSS emitter\n\nHex to OKLCH token steps matching today'"'"'s coral/cardinal, WCAG contrast\ngate, whitelisted CSS output. Client-safe subpath @kku/shared/brand.\n\nCo-Authored-By: <your model name> <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 2: DB: brand columns and brand/asset writers

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (`model OrganizationProfile`)
- Create: `packages/db/prisma/migrations/20261016120000_organization_brand/migration.sql`
- Modify: `packages/db/src/organization.ts`
- Modify: `packages/shared/src/organization/schema.ts` (brand input schema, asset kinds, public view)
- Test: `packages/db/test/organization.test.ts` (extend), `packages/shared/test/organization-schema.test.ts` (extend)

**Interfaces:**
- Consumes (Task 1): `deriveBrandTokens`, `HEX_COLOR`.
- Produces:
  - `BRAND_ASSET_KINDS = ['logo-light', 'logo-dark', 'favicon'] as const`; `type BrandAssetKind`
  - `OrganizationBrandInputSchema`: `{ primaryColor: string | null; secondaryColor: string | null; expectedVersion: number }`. Hex values are lower-cased; an empty string becomes null.
  - `OrganizationPublicView` (configured branch) gains `logoLightUrl: string | null; logoDarkUrl: string | null; faviconUrl: string | null; primaryColor: string | null; secondaryColor: string | null`
  - `saveOrganizationBrand(input: OrganizationBrandInput, brandTokensJson: BrandTokens | null, userId: string, client?: OrgClient): Promise<OrganizationProfile>`, which throws `OrganizationVersionConflictError` or `OrganizationNotConfiguredError`
  - `setOrganizationAsset(kind: BrandAssetKind, key: string | null, userId: string, client?: OrgClient): Promise<OrganizationProfile>`, which bumps `version` and throws `OrganizationNotConfiguredError` when there is no row
  - `brandAssetUrls(row: Pick<OrganizationProfile, 'logoLightKey' | 'logoDarkKey' | 'faviconKey' | 'version'>): { logoLightUrl: string | null; logoDarkUrl: string | null; faviconUrl: string | null }`
  - `ASSET_COLUMN: Record<BrandAssetKind, 'logoLightKey' | 'logoDarkKey' | 'faviconKey'>`

- [ ] **Step 1: Add the columns and the migration**

Inside `model OrganizationProfile`, after `appUrl`, add:

```prisma
  /// MinIO object keys in bucket MINIO_BUCKET_BRANDING (default "branding"); null = built-in mark.
  logoLightKey    String?  @map("logo_light_key")
  logoDarkKey     String?  @map("logo_dark_key")
  faviconKey      String?  @map("favicon_key")
  /// #rrggbb as entered (lower-case); null = product default palette.
  primaryColor    String?  @map("primary_color")
  secondaryColor  String?  @map("secondary_color")
  /// Derived OKLCH tokens {light:{…},dark:{…}} computed at save time (spec §5.2).
  brandTokensJson Json?    @map("brand_tokens_json")
```

`packages/db/prisma/migrations/20261016120000_organization_brand/migration.sql`:

```sql
-- White label phase 2: brand fields on the organisation singleton.
ALTER TABLE "organization_profile"
  ADD COLUMN "logo_light_key" TEXT,
  ADD COLUMN "logo_dark_key" TEXT,
  ADD COLUMN "favicon_key" TEXT,
  ADD COLUMN "primary_color" TEXT,
  ADD COLUMN "secondary_color" TEXT,
  ADD COLUMN "brand_tokens_json" JSONB;
```

Run: `pnpm db:migrate && pnpm --filter @kku/db exec prisma generate`
Expected: `Applying migration 20261016120000_organization_brand`.

- [ ] **Step 2: Write the failing tests**

Append to `packages/shared/test/organization-schema.test.ts`:

```ts
import { OrganizationBrandInputSchema } from '../src';

describe('OrganizationBrandInputSchema', () => {
  it('lower-cases hex and turns a cleared colour into null', () => {
    expect(
      OrganizationBrandInputSchema.parse({ primaryColor: '#F26522', secondaryColor: '', expectedVersion: 2 }),
    ).toEqual({ primaryColor: '#f26522', secondaryColor: null, expectedVersion: 2 });
  });

  it('rejects a non-hex colour and a missing version', () => {
    expect(OrganizationBrandInputSchema.safeParse({ primaryColor: 'orange', secondaryColor: null, expectedVersion: 1 }).success).toBe(false);
    expect(OrganizationBrandInputSchema.safeParse({ primaryColor: null, secondaryColor: null }).success).toBe(false);
  });
});
```

Extend `packages/db/test/organization.test.ts`. Reuse its `fakeClient`/`ROW` helpers, add the six new fields (all `null`) to `ROW` and the `Row` type, and add:

```ts
import { brandAssetUrls, saveOrganizationBrand, setOrganizationAsset } from '../src/organization';

describe('saveOrganizationBrand', () => {
  it('stores colours and tokens under the version lock', async () => {
    const { client } = fakeClient(ROW);
    const tokens = { light: { 'accent-default': '70.0% 0.150 45' }, dark: {} };
    const saved = await saveOrganizationBrand({ primaryColor: '#f26522', secondaryColor: null, expectedVersion: 1 }, tokens, 'u1', client);
    expect(saved.version).toBe(2);
    expect(saved.primaryColor).toBe('#f26522');
    expect(saved.brandTokensJson).toEqual(tokens);
    await expect(
      saveOrganizationBrand({ primaryColor: null, secondaryColor: null, expectedVersion: 1 }, null, 'u2', client),
    ).rejects.toBeInstanceOf(OrganizationVersionConflictError);
  });

  it('refuses when no profile exists', async () => {
    const { client } = fakeClient(null);
    await expect(
      saveOrganizationBrand({ primaryColor: null, secondaryColor: null, expectedVersion: 1 }, null, 'u1', client),
    ).rejects.toBeInstanceOf(OrganizationNotConfiguredError);
  });
});

describe('setOrganizationAsset', () => {
  it('sets and clears a key, bumping the version each time', async () => {
    const { client } = fakeClient(ROW);
    const a = await setOrganizationAsset('logo-light', 'logo-light/abc.png', 'u1', client);
    expect(a.logoLightKey).toBe('logo-light/abc.png');
    expect(a.version).toBe(2);
    const b = await setOrganizationAsset('logo-light', null, 'u1', client);
    expect(b.logoLightKey).toBeNull();
    expect(b.version).toBe(3);
  });

  it('refuses when no profile exists', async () => {
    const { client } = fakeClient(null);
    await expect(setOrganizationAsset('favicon', 'favicon/x.png', 'u1', client)).rejects.toBeInstanceOf(
      OrganizationNotConfiguredError,
    );
  });
});

describe('brandAssetUrls', () => {
  it('returns version-stamped same-origin URLs only for assets that exist', () => {
    expect(brandAssetUrls({ logoLightKey: 'k', logoDarkKey: null, faviconKey: 'f', version: 7 })).toEqual({
      logoLightUrl: '/brand/logo-light?v=7',
      logoDarkUrl: null,
      faviconUrl: '/brand/favicon?v=7',
    });
  });
});
```

The fake client's `updateMany` must also handle an update whose `where` carries no `version` (used by `setOrganizationAsset`). Change its predicate to `if (!row || (where.version !== undefined && row.version !== where.version)) return { count: 0 };` and its `where` type to `{ version?: number }`.

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm --filter @kku/db exec vitest run test/organization.test.ts && pnpm --filter @kku/shared exec vitest run test/organization-schema.test.ts`
Expected: FAIL on the missing exports.

- [ ] **Step 4: Implement**

In `packages/shared/src/organization/schema.ts`, add:

```ts
export const BRAND_ASSET_KINDS = ['logo-light', 'logo-dark', 'favicon'] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

const hexOrNull = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v.toLowerCase() : null))
  .pipe(z.string().regex(/^#[0-9a-f]{6}$/, 'expected #rrggbb').nullable());

export const OrganizationBrandInputSchema = z.object({
  primaryColor: hexOrNull,
  secondaryColor: hexOrNull,
  expectedVersion: z.number().int().positive(),
});
export type OrganizationBrandInput = z.infer<typeof OrganizationBrandInputSchema>;
```

Extend the configured branch of `OrganizationPublicView` with `logoLightUrl: string | null; logoDarkUrl: string | null; faviconUrl: string | null; primaryColor: string | null; secondaryColor: string | null;`.

In `packages/db/src/organization.ts`, add the functions below. Reuse the module's existing `applyRow` (or its equivalent from Phase 1, which sets the cache and bumps the shared generation) after every successful write, as `saveOrganizationIdentity` already does.

```ts
import type { Prisma } from '@prisma/client';
import { OrganizationNotConfiguredError, type BrandAssetKind, type BrandTokens, type OrganizationBrandInput } from '@kku/shared';

export const ASSET_COLUMN: Record<BrandAssetKind, 'logoLightKey' | 'logoDarkKey' | 'faviconKey'> = {
  'logo-light': 'logoLightKey',
  'logo-dark': 'logoDarkKey',
  favicon: 'faviconKey',
};

export function brandAssetUrls(
  row: Pick<OrganizationProfile, 'logoLightKey' | 'logoDarkKey' | 'faviconKey' | 'version'>,
): { logoLightUrl: string | null; logoDarkUrl: string | null; faviconUrl: string | null } {
  const url = (kind: BrandAssetKind, key: string | null) => (key ? `/brand/${kind}?v=${row.version}` : null);
  return {
    logoLightUrl: url('logo-light', row.logoLightKey),
    logoDarkUrl: url('logo-dark', row.logoDarkKey),
    faviconUrl: url('favicon', row.faviconKey),
  };
}

async function reloadAfterWrite(client: OrgClient): Promise<OrganizationProfile> {
  const row = await getOrganizationProfile(client);
  if (!row) throw new OrganizationNotConfiguredError();
  applyRow(row);
  return row;
}

export async function saveOrganizationBrand(
  input: OrganizationBrandInput,
  brandTokensJson: BrandTokens | null,
  userId: string,
  client: OrgClient = prisma,
): Promise<OrganizationProfile> {
  if (!(await getOrganizationProfile(client))) throw new OrganizationNotConfiguredError();
  const { count } = await client.organizationProfile.updateMany({
    where: { id: SINGLETON_ID, version: input.expectedVersion },
    data: {
      primaryColor: input.primaryColor,
      secondaryColor: input.secondaryColor,
      brandTokensJson: (brandTokensJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      updatedBy: userId,
      version: { increment: 1 },
    },
  });
  if (count === 0) throw new OrganizationVersionConflictError();
  return reloadAfterWrite(client);
}

export async function setOrganizationAsset(
  kind: BrandAssetKind,
  key: string | null,
  userId: string,
  client: OrgClient = prisma,
): Promise<OrganizationProfile> {
  const { count } = await client.organizationProfile.updateMany({
    where: { id: SINGLETON_ID },
    data: { [ASSET_COLUMN[kind]]: key, updatedBy: userId, version: { increment: 1 } },
  });
  if (count === 0) throw new OrganizationNotConfiguredError();
  return reloadAfterWrite(client);
}
```

`Prisma.JsonNull` needs a value import of `Prisma`. Check how other files in `packages/db/src` import it (`grep -rn "Prisma.JsonNull" packages/db/src | head -2`) and copy that import, replacing the `import type` above. If the module's Phase 1 helper is named differently from `applyRow`, use the real name. Keep `SINGLETON_ID` as it is.

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @kku/db exec vitest run test/organization.test.ts && pnpm --filter @kku/shared exec vitest run test/organization-schema.test.ts && pnpm --filter @kku/db typecheck && pnpm --filter api typecheck`
Expected: PASS. The api typecheck may fail where `OrganizationPublicView`'s configured branch now needs five more fields; Task 3 fills those in. If it fails only there, note it and continue.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma packages/db/src/organization.ts packages/db/test/organization.test.ts packages/shared/src/organization packages/shared/test/organization-schema.test.ts
printf 'feat(db): organisation brand columns and brand/asset writers\n\nCo-Authored-By: <your model name> <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 3: API: brand save, asset upload/remove, public view

**Files:**
- Create: `apps/api/src/organization/asset-validation.ts`, `apps/api/src/organization/branding-storage.service.ts`
- Modify: `apps/api/src/organization/organization.controller.ts`, `organization.service.ts`, `organization.module.ts`
- Test: `apps/api/test/organization-assets.test.ts` (create), `apps/api/test/organization.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 `deriveBrandTokens`; Task 2 `saveOrganizationBrand`, `setOrganizationAsset`, `brandAssetUrls`, `OrganizationBrandInputSchema`, `BRAND_ASSET_KINDS`.
- Produces HTTP:
  - `PUT /api/v1/admin/organization/brand`, body `OrganizationBrandInput` → `{ profile }`. If the gate fails: 400 `VALIDATION_FAILED` with `details: { errors: string[], checks: BrandCheck[] }`.
  - `POST /api/v1/admin/organization/assets/:kind`, multipart field `file` → `{ profile }`.
  - `DELETE /api/v1/admin/organization/assets/:kind` → `{ profile }`.
  - `GET /api/v1/organization` now also returns the asset URLs and colours.
- Produces code:
  - `validateBrandAsset(kind: BrandAssetKind, bytes: Buffer): { ok: true; ext: 'png' | 'svg'; contentType: 'image/png' | 'image/svg+xml' } | { ok: false; reason: string }`
  - `pngSize(bytes: Buffer): { width: number; height: number } | null`

Ruling: the gate failure is answered with HTTP 400 `VALIDATION_FAILED`, not 422, because the repo's error taxonomy (`packages/shared/src/api/errors.ts`) has no 422 code. The response carries the contrast report in `details`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/organization-assets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pngSize, validateBrandAsset } from '../src/organization/asset-validation';

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
const svg = (body: string) => Buffer.from(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);

describe('pngSize', () => {
  it('reads width and height from the IHDR header', () => {
    expect(pngSize(png(120, 48))).toEqual({ width: 120, height: 48 });
    expect(pngSize(Buffer.from('not a png'))).toBeNull();
  });
});

describe('validateBrandAsset', () => {
  it('accepts a PNG logo and a clean SVG logo', () => {
    expect(validateBrandAsset('logo-light', png(300, 120))).toEqual({ ok: true, ext: 'png', contentType: 'image/png' });
    expect(validateBrandAsset('logo-dark', svg('<rect width="10" height="10"/>'))).toEqual({
      ok: true,
      ext: 'svg',
      contentType: 'image/svg+xml',
    });
  });

  it('rejects oversized, unknown and oversize-dimension files', () => {
    expect(validateBrandAsset('logo-light', Buffer.alloc(1024 * 1024 + 1)).ok).toBe(false);
    expect(validateBrandAsset('logo-light', Buffer.from('GIF89a')).ok).toBe(false);
    expect(validateBrandAsset('logo-light', png(4000, 100)).ok).toBe(false);
  });

  it.each([
    ['<script>alert(1)</script>'],
    ['<foreignObject></foreignObject>'],
    ['<rect onload="x()"/>'],
    ['<a href="javascript:alert(1)"><rect/></a>'],
    ['<image href="https://evil.example/x.png"/>'],
  ])('rejects an SVG containing %s', (body) => {
    expect(validateBrandAsset('logo-light', svg(body)).ok).toBe(false);
  });

  it('allows fragment and data-image hrefs in an SVG', () => {
    expect(validateBrandAsset('logo-light', svg('<use href="#a"/><image href="data:image/png;base64,AAAA"/>')).ok).toBe(true);
  });

  it('only accepts a square PNG of at least 32 px as a favicon', () => {
    expect(validateBrandAsset('favicon', png(64, 64)).ok).toBe(true);
    expect(validateBrandAsset('favicon', png(64, 32)).ok).toBe(false);
    expect(validateBrandAsset('favicon', png(16, 16)).ok).toBe(false);
    expect(validateBrandAsset('favicon', svg('<rect/>')).ok).toBe(false);
  });
});
```

Extend `apps/api/test/organization.test.ts`:
- Add `saveOrganizationBrand`, `setOrganizationAsset` and `brandAssetUrls` to the `vi.mock('@kku/db', …)` factory. Implement the mocked `brandAssetUrls` as the real function's one-liner, or import the real one with `vi.importActual`.
- Add `logoLightKey: 'logo-light/a.png', logoDarkKey: null, faviconKey: null, primaryColor: '#f26522', secondaryColor: null, brandTokensJson: null` to `ROW`.
- Change the existing publicView expectation to include `logoLightUrl: '/brand/logo-light?v=4', logoDarkUrl: null, faviconUrl: null, primaryColor: '#f26522', secondaryColor: null`.
- Add:

```ts
describe('OrganizationService.saveBrand', () => {
  it('refuses colours that fail the contrast gate before touching the database', async () => {
    mocks.saveOrganizationBrand.mockReset();
    await expect(
      new OrganizationService({} as never).saveBrand({ primaryColor: '#808585', secondaryColor: null, expectedVersion: 4 }, 'u1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mocks.saveOrganizationBrand).not.toHaveBeenCalled();
  });

  it('derives tokens and saves them with the input', async () => {
    mocks.saveOrganizationBrand.mockResolvedValue(ROW);
    await new OrganizationService({} as never).saveBrand({ primaryColor: '#f26522', secondaryColor: null, expectedVersion: 4 }, 'u1');
    const [input, tokens, user] = mocks.saveOrganizationBrand.mock.calls[0];
    expect(input).toEqual({ primaryColor: '#f26522', secondaryColor: null, expectedVersion: 4 });
    expect(tokens.light['accent-default']).toMatch(/^70\.0% /);
    expect(user).toBe('u1');
  });
});
```

The service constructor now takes the `BrandingStorageService` (Step 3). Existing tests construct it with no arguments, so pass `{} as never` there too. Mark those casts with a comment: `// storage unused on this path`.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter api exec vitest run test/organization-assets.test.ts test/organization.test.ts`
Expected: FAIL. The module is missing and the service methods are missing.

- [ ] **Step 3: Implement**

`apps/api/src/organization/asset-validation.ts`:

```ts
import type { BrandAssetKind } from '@kku/shared';

// Brand asset checks (spec §6, with the reject-don't-strip SVG ruling recorded
// in the phase-2 plan). Pure: bytes in, verdict out.

export const MAX_ASSET_BYTES = 1024 * 1024;
const MAX_SIDE = 2048;
const MIN_FAVICON = 32;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIG) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    return null;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const SVG_FORBIDDEN: Array<[RegExp, string]> = [
  [/<script/i, 'scripts'],
  [/<foreignObject/i, 'foreignObject'],
  [/\son[a-z]+\s*=/i, 'event-handler attributes'],
  [/javascript:/i, 'javascript: URLs'],
  [/(?:xlink:)?href\s*=\s*["'](?!#|data:image\/)[^"']*["']/i, 'external links'],
];

function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes.toString('utf8', 0, Math.min(bytes.length, 1024)).trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head);
}

export type AssetVerdict =
  | { ok: true; ext: 'png' | 'svg'; contentType: 'image/png' | 'image/svg+xml' }
  | { ok: false; reason: string };

export function validateBrandAsset(kind: BrandAssetKind, bytes: Buffer): AssetVerdict {
  if (bytes.length > MAX_ASSET_BYTES) return { ok: false, reason: 'File is larger than 1 MB.' };

  const size = pngSize(bytes);
  if (size) {
    if (size.width > MAX_SIDE || size.height > MAX_SIDE) {
      return { ok: false, reason: `Image is ${size.width}×${size.height}; the limit is ${MAX_SIDE} px per side.` };
    }
    if (kind === 'favicon' && (size.width !== size.height || size.width < MIN_FAVICON)) {
      return { ok: false, reason: `A favicon must be a square PNG of at least ${MIN_FAVICON} px.` };
    }
    return { ok: true, ext: 'png', contentType: 'image/png' };
  }

  if (looksLikeSvg(bytes)) {
    if (kind === 'favicon') return { ok: false, reason: 'A favicon must be a PNG.' };
    const text = bytes.toString('utf8');
    for (const [re, what] of SVG_FORBIDDEN) {
      if (re.test(text)) return { ok: false, reason: `SVG contains ${what}, which is not allowed in a logo.` };
    }
    return { ok: true, ext: 'svg', contentType: 'image/svg+xml' };
  }

  return { ok: false, reason: 'Upload a PNG or SVG file.' };
}
```

`apps/api/src/organization/branding-storage.service.ts`. Model it on the S3Storage set-up in `apps/api/src/jobthai/jobthai.service.ts:82-92`. Use the same env keys, the bucket `MINIO_BUCKET_BRANDING ?? 'branding'`, and `ensureBucket` before the first put:

```ts
import { createHash } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError, S3Storage, type BrandAssetKind } from '@kku/shared';

@Injectable()
export class BrandingStorageService implements OnModuleInit {
  private storage?: S3Storage;
  private bucket = 'branding';
  private bucketReady = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const endpoint = this.config.get<string>('MINIO_ENDPOINT');
    if (!endpoint) return;
    this.storage = new S3Storage({
      endpoint,
      region: this.config.get<string>('MINIO_REGION') ?? 'us-east-1',
      accessKeyId: this.config.get<string>('MINIO_ACCESS_KEY') ?? '',
      secretAccessKey: this.config.get<string>('MINIO_SECRET_KEY') ?? '',
      publicEndpoint: this.config.get<string>('MINIO_PUBLIC_ENDPOINT') || undefined,
    });
    this.bucket = this.config.get<string>('MINIO_BUCKET_BRANDING') ?? 'branding';
  }

  /** Content-addressed key, so re-uploading the same file is a no-op upstream. */
  async put(kind: BrandAssetKind, bytes: Buffer, ext: 'png' | 'svg', contentType: string): Promise<string> {
    if (!this.storage) throw new ApiError('UPSTREAM_UNAVAILABLE', 'Object storage is not configured (MINIO_ENDPOINT).');
    if (!this.bucketReady) {
      await this.storage.ensureBucket(this.bucket);
      this.bucketReady = true;
    }
    const key = `${kind}/${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
    await this.storage.putObject({ bucket: this.bucket, key, body: bytes, contentType });
    return key;
  }
}
```

Check the exact `PutObjectRequest` field names in `packages/shared/src/storage/s3-storage.ts` (around line 99) and adjust `body` and `contentType` to match. Check how `ConfigService` is provided to other api services (`grep -n "ConfigModule" apps/api/src/app.module.ts`) and follow that.

Service additions (`organization.service.ts`):
- inject `BrandingStorageService`;
- extend `publicView` with `...brandAssetUrls(row)`, `primaryColor: row.primaryColor`, `secondaryColor: row.secondaryColor`;
- add:

```ts
  async saveBrand(input: OrganizationBrandInput, userId: string): Promise<{ profile: OrganizationProfileRow }> {
    const derived = deriveBrandTokens(input.primaryColor, input.secondaryColor);
    if (!derived.ok) {
      throw new ApiError('VALIDATION_FAILED', derived.errors.join(' '), { errors: derived.errors, checks: derived.checks });
    }
    const hasTokens = Object.keys(derived.tokens.light).length > 0;
    return { profile: await saveOrganizationBrand(input, hasTokens ? derived.tokens : null, userId) };
  }

  async uploadAsset(kind: BrandAssetKind, bytes: Buffer, userId: string): Promise<{ profile: OrganizationProfileRow }> {
    const verdict = validateBrandAsset(kind, bytes);
    if (!verdict.ok) throw new ApiError('VALIDATION_FAILED', verdict.reason);
    const key = await this.storage.put(kind, bytes, verdict.ext, verdict.contentType);
    return { profile: await setOrganizationAsset(kind, key, userId) };
  }

  async removeAsset(kind: BrandAssetKind, userId: string): Promise<{ profile: OrganizationProfileRow }> {
    return { profile: await setOrganizationAsset(kind, null, userId) };
  }
```

`OrganizationProfileRow` is the row type Phase 1's service already uses (`Awaited<ReturnType<typeof getOrganizationProfile>>` without null); reuse that alias. Removing an asset leaves the object in MinIO. Content-addressed objects are tiny, and an unreferenced one is harmless (YAGNI on garbage collection).

Controller additions (in `OrganizationAdminController`, same decorator style as Phase 1):

```ts
const AssetKindParam = z.object({ kind: z.enum(BRAND_ASSET_KINDS) });

  @Put('brand')
  @Authorized('settings:configure')
  @AuditLog({ action: 'organization.brand_update', entityType: 'OrganizationProfile' })
  async putBrand(
    @Body(new ZodValidationPipe(OrganizationBrandInputSchema)) body: OrganizationBrandInput,
    @AuthSession() user: SessionUser,
  ) {
    return this.service.saveBrand(body, user.userId);
  }

  @Post('assets/:kind')
  @Authorized('settings:configure')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ASSET_BYTES + 1 } }))
  @AuditLog({ action: 'organization.asset_upload', entityType: 'OrganizationProfile' })
  async uploadAsset(
    @Param(new ZodValidationPipe(AssetKindParam)) p: z.infer<typeof AssetKindParam>,
    @UploadedFile() file: Express.Multer.File | undefined,
    @AuthSession() user: SessionUser,
  ) {
    if (!file) throw new ApiError('VALIDATION_FAILED', 'No file uploaded (field "file").');
    return this.service.uploadAsset(p.kind, file.buffer, user.userId);
  }

  @Delete('assets/:kind')
  @Authorized('settings:configure')
  @AuditLog({ action: 'organization.asset_remove', entityType: 'OrganizationProfile' })
  async removeAsset(
    @Param(new ZodValidationPipe(AssetKindParam)) p: z.infer<typeof AssetKindParam>,
    @AuthSession() user: SessionUser,
  ) {
    return this.service.removeAsset(p.kind, user.userId);
  }
```

The `limits.fileSize` is `MAX_ASSET_BYTES + 1`, so multer lets a just-over-the-limit file through and the validator answers with the readable "larger than 1 MB" message. Add `BrandingStorageService` to the module's `providers`.

Register the three new audit actions in `packages/shared/test/usage-action-coverage.test.ts`'s `DELIBERATELY_OTHER`, alphabetically next to `organization.update` (Phase 1 did the same for `organization.update`).

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `pnpm --filter api exec vitest run test/organization-assets.test.ts test/organization.test.ts && pnpm --filter api test 2>&1 | tail -4 && pnpm --filter api typecheck && pnpm --filter @kku/shared exec vitest run test/usage-action-coverage.test.ts 2>&1 | tail -3`
Expected: PASS. The api total is the baseline 417 plus the new tests. usage-action-coverage shows only its 4 known pre-existing failures.

Lint the touched files: `pnpm exec eslint apps/api/src/organization`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/organization apps/api/test/organization*.test.ts packages/shared/test/usage-action-coverage.test.ts
printf 'feat(api): organisation brand colours and logo/favicon assets\n\nServer-side contrast gate, PNG/SVG validation (unsafe SVG rejected),\ncontent-addressed MinIO storage, version-stamped public asset URLs.\n\nCo-Authored-By: <your model name> <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 4: Web: `/brand/<asset>` route with built-in fallback

**Files:**
- Create: `apps/web/src/components/brand/product-mark.ts` (exports the neutral mark as SVG markup and a React component)
- Create: `apps/web/src/lib/branding-storage.ts` (MinIO read; same client set-up as `apps/web/src/lib/avatar-storage.ts`)
- Create: `apps/web/src/lib/brand-asset-response.ts` (pure response builder)
- Create: `apps/web/app/brand/[asset]/route.ts`
- Modify: `apps/web/middleware.ts` (`PUBLIC_PATHS`)
- Modify: `apps/web/app/signin/page.tsx` (use the shared `ProductMark` component instead of the local `BrandMark`)
- Test: `apps/web/test/brand-asset-response.test.ts`

**Interfaces:**
- Consumes: Task 2 `ASSET_COLUMN`, `getOrganizationProfile`; `BRAND_ASSET_KINDS`.
- Produces:
  - `PRODUCT_MARK_SVG: string`, a standalone SVG with `fill="#…"` literals is NOT allowed. Use `fill="currentColor"` with a neutral `color` style on the root `svg` element. This is a served asset, not UI code, but keep it token-free anyway.
  - `ProductMark({ className?: string }): JSX.Element`, the 2×2-bubbles mark moved out of the sign-in page.
  - `readBrandAsset(key: string): Promise<{ bytes: Buffer; contentType: string } | null>`, which returns null on any MinIO error or a missing object.
  - `brandAssetResponse(input: { asset: { bytes: Buffer; contentType: string } | null; requestedVersion: string | null; currentVersion: number | null }): Response`

- [ ] **Step 1: Write the failing test**

`apps/web/test/brand-asset-response.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { brandAssetResponse } from '../src/lib/brand-asset-response';

const png = { bytes: Buffer.from([0x89, 0x50]), contentType: 'image/png' };
const svg = { bytes: Buffer.from('<svg/>'), contentType: 'image/svg+xml' };

describe('brandAssetResponse', () => {
  it('serves a stored asset immutably when the URL carries the current version', async () => {
    const res = brandAssetResponse({ asset: png, requestedVersion: '7', currentVersion: 7 });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('caches briefly when the version is missing or stale', () => {
    expect(brandAssetResponse({ asset: png, requestedVersion: null, currentVersion: 7 }).headers.get('cache-control')).toBe(
      'public, max-age=300',
    );
    expect(brandAssetResponse({ asset: png, requestedVersion: '6', currentVersion: 7 }).headers.get('cache-control')).toBe(
      'public, max-age=300',
    );
  });

  it('sandboxes every SVG it serves', () => {
    const res = brandAssetResponse({ asset: svg, requestedVersion: '7', currentVersion: 7 });
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('falls back to the built-in product mark (200, short cache) when there is no asset', async () => {
    const res = brandAssetResponse({ asset: null, requestedVersion: '7', currentVersion: null });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await res.text()).toContain('<svg');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter web exec vitest run test/brand-asset-response.test.ts`
Expected: FAIL with the module missing.

- [ ] **Step 3: Implement**

`apps/web/src/components/brand/product-mark.ts`. Keep it a `.ts` file exporting the markup string. Also create `apps/web/src/components/brand/product-mark-component.tsx`, which renders the same four circles with `className="fill-accent-default"`, exactly as the sign-in page's current `BrandMark` does (copy that JSX, then delete `BrandMark` from `signin/page.tsx` and import the component):

```ts
// The neutral Program Landscape mark (2×2 bubbles — a BCG-matrix nod), served
// at /brand/* whenever an organisation has not uploaded its own logo. Uses
// currentColor so it reads on both themes without a colour literal.
export const PRODUCT_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 22 22" style="color:rgb(120 113 108)">' +
  '<circle cx="6" cy="6" r="2.6" fill="currentColor" opacity="0.6"/>' +
  '<circle cx="16" cy="6" r="3.6" fill="currentColor"/>' +
  '<circle cx="6" cy="16" r="2.0" fill="currentColor" opacity="0.4"/>' +
  '<circle cx="16" cy="16" r="2.6" fill="currentColor" opacity="0.7"/>' +
  '</svg>';
```

The repo's ESLint rule bans literal-numeric `rgb()` in source. If it flags the `style="color:rgb(…)"`, drop the style attribute: `currentColor` then resolves to black when the SVG is used as an `<img>`, which is acceptable for a neutral fallback. Do not suppress the rule.

`apps/web/src/lib/brand-asset-response.ts`:

```ts
import { PRODUCT_MARK_SVG } from '@/components/brand/product-mark';

const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export function brandAssetResponse(input: {
  asset: { bytes: Buffer; contentType: string } | null;
  requestedVersion: string | null;
  currentVersion: number | null;
}): Response {
  const asset = input.asset ?? { bytes: Buffer.from(PRODUCT_MARK_SVG), contentType: 'image/svg+xml' };
  const pinned =
    input.asset !== null && input.currentVersion !== null && input.requestedVersion === String(input.currentVersion);
  const headers: Record<string, string> = {
    'Content-Type': asset.contentType,
    'Content-Length': String(asset.bytes.length),
    'Cache-Control': pinned ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  };
  if (asset.contentType === 'image/svg+xml') headers['Content-Security-Policy'] = SVG_CSP;
  return new Response(new Uint8Array(asset.bytes), { status: 200, headers });
}
```

`apps/web/src/lib/branding-storage.ts`: copy the S3 client set-up and `ensureBucket`-free read pattern from `apps/web/src/lib/avatar-storage.ts` (its `client()` function and the `GetObjectCommand` read in `getAvatarBytes`). Use bucket `process.env.MINIO_BUCKET_BRANDING ?? 'branding'`, and export `readBrandAsset(key)`. Wrap the whole read in try/catch and return `null` on any error. Derive `contentType` from the key's extension (`.svg` → `image/svg+xml`, else `image/png`).

`apps/web/app/brand/[asset]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { ASSET_COLUMN, getOrganizationProfile } from '@kku/db';
import { BRAND_ASSET_KINDS, type BrandAssetKind } from '@kku/shared';
import { readBrandAsset } from '@/lib/branding-storage';
import { brandAssetResponse } from '@/lib/brand-asset-response';

// Public (see middleware PUBLIC_PATHS): the sign-in page and the favicon need it
// before any session exists. Serves the organisation's logo/favicon, or the
// built-in product mark when none is uploaded or storage is unreachable.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, context: { params: Promise<{ asset: string }> }): Promise<Response> {
  const { asset } = await context.params;
  if (!(BRAND_ASSET_KINDS as readonly string[]).includes(asset)) return new NextResponse(null, { status: 404 });
  const kind = asset as BrandAssetKind;
  const row = await getOrganizationProfile().catch(() => null);
  const key = row?.[ASSET_COLUMN[kind]] ?? null;
  const stored = key ? await readBrandAsset(key) : null;
  return brandAssetResponse({
    asset: stored,
    requestedVersion: new URL(req.url).searchParams.get('v'),
    currentVersion: row?.version ?? null,
  });
}
```

Check how other route handlers in this app read `params` (Next 14.2: `{ params: { asset: string } }` is a plain object). Follow `apps/web/app/api/profile/avatar/[userId]/route.ts`, which uses the Promise form; whatever compiles there compiles here.

`apps/web/middleware.ts`: add to `PUBLIC_PATHS`, with a one-line comment ("Brand assets — the sign-in page and favicon load them before a session exists."):

```ts
  /^\/brand\/(logo-light|logo-dark|favicon)$/,
```

- [ ] **Step 4: Run tests, typecheck, lint and a live check**

Run: `pnpm --filter web exec vitest run test/brand-asset-response.test.ts && pnpm --filter web typecheck && pnpm exec eslint apps/web/src/lib/brand-asset-response.ts apps/web/src/lib/branding-storage.ts apps/web/app/brand apps/web/src/components/brand apps/web/middleware.ts apps/web/app/signin/page.tsx`
Expected: PASS, clean.

Live check (the web dev server hot-reloads route files): `curl -sI localhost:3000/brand/logo-light | head -5` and `curl -sI localhost:3000/brand/nope | head -1`.
Expected: `200` with `content-type: image/svg+xml` (no logo uploaded yet → product mark), and `404`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/brand apps/web/src/lib/brand-asset-response.ts apps/web/src/lib/branding-storage.ts apps/web/app/brand apps/web/middleware.ts apps/web/app/signin/page.tsx apps/web/test/brand-asset-response.test.ts
printf 'feat(web): /brand asset route with built-in product-mark fallback\n\nCo-Authored-By: <your model name> <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 5: Web: brand colours, title and favicon from the profile

**Files:**
- Create: `apps/web/src/lib/branding.ts`
- Modify: `apps/web/app/layout.tsx` (async root layout, `<head>` style, `generateMetadata`)
- Delete: `apps/web/app/icon.png`
- Test: `apps/web/test/branding.test.ts`

**Interfaces:**
- Consumes: Task 1 `brandCss`; Task 2 `brandAssetUrls`, `getOrganizationProfile`, `organizationTagline`.
- Produces:
  - `interface Branding { nameTh: string; nameEn: string; shortNameTh: string; shortNameEn: string; tagline: string; version: number; logoLightUrl: string; logoDarkUrl: string; faviconUrl: string; hasOwnLogo: boolean; css: string }`. URLs always point at `/brand/…?v=` so the fallback mark serves when none was uploaded. `css` is `''` when nothing is set.
  - `brandingForRequest(): Promise<Branding | null>`, React `cache()`-wrapped per request. It returns null when there is no profile **or when the read throws**, so builds and outages render fallback chrome.
  - `toBranding(row: OrganizationProfile): Branding` (pure)
  - `brandMetadata(b: Branding | null): { title: { default: string; template: string }; description: string; icons: { icon: string } }` (pure)

- [ ] **Step 1: Write the failing test**

`apps/web/test/branding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { brandMetadata, toBranding } from '../src/lib/branding';

const ROW = {
  id: 'default', nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.', shortNameEn: 'EXU',
  regionTh: null, regionEn: null, contactEmail: null, appUrl: 'https://x.example', version: 5,
  logoLightKey: 'logo-light/a.png', logoDarkKey: null, faviconKey: null,
  primaryColor: '#f26522', secondaryColor: null,
  brandTokensJson: { light: { 'accent-default': '70.0% 0.150 45' }, dark: {} },
  updatedAt: new Date(), updatedBy: null,
};

describe('toBranding', () => {
  it('always points at the /brand route, stamped with the version, and builds safe CSS', () => {
    const b = toBranding(ROW);
    expect(b.logoLightUrl).toBe('/brand/logo-light?v=5');
    expect(b.logoDarkUrl).toBe('/brand/logo-dark?v=5');
    expect(b.faviconUrl).toBe('/brand/favicon?v=5');
    expect(b.hasOwnLogo).toBe(true);
    expect(b.tagline).toBe('EXU Curriculum Intelligence Platform');
    expect(b.css).toBe("html[data-theme='light']{--color-accent-default:70.0% 0.150 45;}");
  });
});

import { vi } from 'vitest';
vi.mock('@kku/db', async (orig) => ({
  ...(await orig<typeof import('@kku/db')>()),
  getOrganizationProfile: vi.fn(async () => {
    throw new Error('connect ECONNREFUSED');
  }),
}));

describe('brandingForRequest', () => {
  it('returns null instead of throwing when the database is unreachable (next build, outages)', async () => {
    const { brandingForRequest } = await import('../src/lib/branding');
    await expect(brandingForRequest()).resolves.toBeNull();
  });
});

describe('brandMetadata', () => {
  it('names the organisation in the title template', () => {
    expect(brandMetadata(toBranding(ROW)).title).toEqual({
      default: 'Program Landscape — EXU Curriculum Intelligence Platform',
      template: '%s — EXU Curriculum Intelligence Platform',
    });
    expect(brandMetadata(toBranding(ROW)).icons).toEqual({ icon: '/brand/favicon?v=5' });
  });

  it('falls back to the bare product name when the install is not configured', () => {
    expect(brandMetadata(null)).toEqual({
      title: { default: 'Program Landscape', template: '%s — Program Landscape' },
      description: 'Program Landscape — curriculum intelligence for strategic decisions.',
      icons: { icon: '/brand/favicon' },
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter web exec vitest run test/branding.test.ts`
Expected: FAIL with the module missing.

- [ ] **Step 3: Implement**

`apps/web/src/lib/branding.ts`:

```ts
import { cache } from 'react';
import type { OrganizationProfile } from '@prisma/client';
import { brandAssetUrls, getOrganizationProfile, organizationTagline } from '@kku/db';
import { brandCss } from '@kku/shared/brand';

export interface Branding {
  nameTh: string;
  nameEn: string;
  shortNameTh: string;
  shortNameEn: string;
  tagline: string;
  version: number;
  logoLightUrl: string;
  logoDarkUrl: string;
  faviconUrl: string;
  hasOwnLogo: boolean;
  css: string;
}

export function toBranding(row: OrganizationProfile): Branding {
  const urls = brandAssetUrls(row);
  const v = `?v=${row.version}`;
  return {
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    shortNameTh: row.shortNameTh,
    shortNameEn: row.shortNameEn,
    tagline: organizationTagline(row.shortNameEn),
    version: row.version,
    logoLightUrl: `/brand/logo-light${v}`,
    logoDarkUrl: `/brand/logo-dark${v}`,
    faviconUrl: `/brand/favicon${v}`,
    hasOwnLogo: urls.logoLightUrl !== null || urls.logoDarkUrl !== null,
    css: brandCss(row.brandTokensJson),
  };
}

/**
 * One profile read per request. Null when the install is not configured —
 * AND when the read fails (no database at `next build`, an outage): chrome
 * then renders the product defaults instead of crashing every page.
 */
export const brandingForRequest = cache(async (): Promise<Branding | null> => {
  try {
    const row = await getOrganizationProfile();
    return row ? toBranding(row) : null;
  } catch {
    return null;
  }
});

export function brandMetadata(b: Branding | null): {
  title: { default: string; template: string };
  description: string;
  icons: { icon: string };
} {
  if (!b) {
    return {
      title: { default: 'Program Landscape', template: '%s — Program Landscape' },
      description: 'Program Landscape — curriculum intelligence for strategic decisions.',
      icons: { icon: '/brand/favicon' },
    };
  }
  return {
    title: { default: `Program Landscape — ${b.tagline}`, template: `%s — ${b.tagline}` },
    description: `Program Landscape · ${b.tagline} — strategic decision-support for ${b.nameEn}.`,
    icons: { icon: b.faviconUrl },
  };
}
```

If apps/web cannot import `@prisma/client` types (Phase 1's api had the same issue), type the parameter as `NonNullable<Awaited<ReturnType<typeof getOrganizationProfile>>>`. Update the test's `ROW` cast accordingly (`as never` is acceptable in a test).

`apps/web/app/layout.tsx`:
- remove `export const metadata`;
- add `export async function generateMetadata(): Promise<Metadata> { return brandMetadata(await brandingForRequest()); }`;
- make `RootLayout` `async`, call `const branding = await brandingForRequest();`;
- render inside `<html>`, before `<body>`:

```tsx
      <head>
        {branding?.css ? (
          // Values are whitelisted token names + strict OKLCH triplets (brandCss) — never raw DB text.
          <style id="org-brand" dangerouslySetInnerHTML={{ __html: branding.css }} />
        ) : null}
      </head>
```

Delete `apps/web/app/icon.png` with `git rm`. The favicon now comes from `generateMetadata` → `/brand/favicon`.

- [ ] **Step 4: Run tests, typecheck, lint and a live check**

Run: `pnpm --filter web exec vitest run test/branding.test.ts && pnpm --filter web typecheck && pnpm exec eslint apps/web/src/lib/branding.ts apps/web/app/layout.tsx`
Expected: PASS, clean.

Live check: `curl -s localhost:3000/signin | grep -o '<title>[^<]*</title>'`
Expected: `<title>Sign in — KMUTT Curriculum Intelligence Platform</title>` (or the sign-in page's own title, followed by the KMUTT tagline). The dev profile has no colours yet, so there is no `org-brand` style.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/branding.ts apps/web/app/layout.tsx apps/web/test/branding.test.ts
git rm -q apps/web/app/icon.png
printf 'feat(web): brand colours, title and favicon from the organisation profile\n\nCo-Authored-By: <your model name> <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 6: Web chrome: logo, wordmark, footer, sign-in, setup banner

**Files:**
- Create: `apps/web/src/components/brand/org-logo.tsx` (server component)
- Create: `apps/web/src/components/brand/setup-banner.tsx` (server component)
- Modify: `apps/web/src/components/shell/app-shell-server.tsx` (brand mark, wordmark, banner)
- Modify: `apps/web/src/components/shell/nav-user-footer.tsx` (© line)
- Modify: `apps/web/app/profile/profile-view.tsx` and its server parent (logo URLs passed as props)
- Modify: `apps/web/app/signin/page.tsx` (logo, "Use your … institutional account")
- Modify: `apps/web/app/page.tsx:43` (retired name in the title)
- Test: `apps/web/test/brand-chrome.test.tsx`

**Interfaces:**
- Consumes: Task 5 `Branding`, `brandingForRequest`; Task 4 `ProductMark` component.
- Produces:
  - `OrgLogo({ branding, width, height, className }: { branding: Branding | null; width: number; height: number; className?: string }): JSX.Element`. When `branding?.hasOwnLogo`, it renders the light/dark `<img>` pair with `dark:hidden` / `hidden dark:block`, exactly as the shell does today. Otherwise it renders `<ProductMark>` at that size.
  - `SetupBanner({ canConfigure }: { canConfigure: boolean }): JSX.Element`

- [ ] **Step 1: Write the failing test**

`apps/web/test/brand-chrome.test.tsx`. apps/web has no jsdom; Phase 1 used `renderToStaticMarkup`, so do the same:

```tsx
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrgLogo } from '../src/components/brand/org-logo';
import { SetupBanner } from '../src/components/brand/setup-banner';
import type { Branding } from '../src/lib/branding';

const B: Branding = {
  nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.', shortNameEn: 'EXU',
  tagline: 'EXU Curriculum Intelligence Platform', version: 3,
  logoLightUrl: '/brand/logo-light?v=3', logoDarkUrl: '/brand/logo-dark?v=3', faviconUrl: '/brand/favicon?v=3',
  hasOwnLogo: true, css: '',
};

describe('OrgLogo', () => {
  it('renders the light and dark logo pair from the brand route', () => {
    const html = renderToStaticMarkup(<OrgLogo branding={B} width={30} height={50} />);
    expect(html).toContain('src="/brand/logo-light?v=3"');
    expect(html).toContain('src="/brand/logo-dark?v=3"');
    expect(html).toContain('alt="EXU"');
  });

  it('renders the product mark when there is no uploaded logo or no profile', () => {
    expect(renderToStaticMarkup(<OrgLogo branding={{ ...B, hasOwnLogo: false }} width={30} height={50} />)).toContain('<svg');
    expect(renderToStaticMarkup(<OrgLogo branding={null} width={30} height={50} />)).toContain('<svg');
  });
});

describe('SetupBanner', () => {
  it('links admins to the setup page', () => {
    const html = renderToStaticMarkup(<SetupBanner canConfigure />);
    expect(html).toMatch(/not configured/i);
    expect(html).toContain('href="/admin/organization"');
  });

  it('tells everyone else to contact an administrator, without a link', () => {
    const html = renderToStaticMarkup(<SetupBanner canConfigure={false} />);
    expect(html).toMatch(/administrator/i);
    expect(html).not.toContain('href=');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter web exec vitest run test/brand-chrome.test.tsx`
Expected: FAIL with the modules missing.

- [ ] **Step 3: Implement**

`apps/web/src/components/brand/org-logo.tsx`:

```tsx
import type { Branding } from '@/lib/branding';
import { ProductMark } from './product-mark-component';

/** The organisation's logo (theme-aware pair) or, until one is uploaded, the product mark. */
export function OrgLogo({
  branding,
  width,
  height,
  className = '',
}: {
  branding: Branding | null;
  width: number;
  height: number;
  className?: string;
}) {
  if (!branding?.hasOwnLogo) {
    return <ProductMark className={className} size={Math.min(width, height)} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={branding.logoLightUrl} alt={branding.shortNameEn} width={width} height={height}
        className={`block object-contain dark:hidden ${className}`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={branding.logoDarkUrl} alt={branding.shortNameEn} width={width} height={height}
        className={`hidden object-contain dark:block ${className}`} />
    </>
  );
}
```

If only one of the two logos was uploaded, the route serves the product mark for the other one, so the pair still renders. Give `ProductMark` a `size` prop, defaulting to 22, that drives its `width`/`height`.

`apps/web/src/components/brand/setup-banner.tsx`. Use the same alert styling as the Phase 1 admin page (`border-[oklch(var(--color-warning-default)/0.4)] bg-warning/10`):

```tsx
import Link from 'next/link';

export function SetupBanner({ canConfigure }: { canConfigure: boolean }) {
  return (
    <div role="status" className="mb-4 rounded-md border border-[oklch(var(--color-warning-default)/0.4)] bg-warning/10 p-3 text-sm">
      Organisation not configured — AI features and data connectors stay unavailable until it is.{' '}
      {canConfigure ? (
        <Link href="/admin/organization" className="font-medium underline">Set it up</Link>
      ) : (
        <span>Ask an administrator to set it up.</span>
      )}
    </div>
  );
}
```

If `bg-warning/10` emits no CSS (same preset family as the border trap), copy whichever background class the Phase 1 admin page's warning box uses (`apps/web/app/admin/organization/client.tsx`).

`app-shell-server.tsx`:
- add `brandingForRequest()` to the existing `Promise.all`;
- replace the two hard-coded KKU `<img>` with `<OrgLogo branding={branding} width={30} height={50} className="h-[50px] w-[30px]" />`;
- set the wrapper `title` to `branding?.tagline ?? 'Program Landscape'`;
- the wordmark's second line becomes `{branding ? `${branding.shortNameEn} Curriculum Intelligence` : 'Curriculum Intelligence'}`;
- render `{!branding && <SetupBanner canConfigure={can(user, 'settings:configure')} />}` just above `{children}`. Use the repo's `can()` from `@kku/shared`; check how the file already obtains `user`.

`nav-user-footer.tsx`: make `NavCredits` async (it is a server component). Read `brandingForRequest()`, and render `© {year} {branding?.nameEn ?? 'Program Landscape'}`. Leave the upstream authorship lines unchanged: they credit the software's author, not the deploying organisation.

`profile-view.tsx` is a client component, so do not import server code into it. Add props `logoLightUrl: string | null; logoDarkUrl: string | null` (null hides the hero mark). Replace the two `/brand/kku-logo-*.png` `src` values with them. In the server component that renders `ProfileView` (`grep -rn "<ProfileView" apps/web/app`), pass `branding?.hasOwnLogo ? branding.logoLightUrl : null` and the same for dark.

`signin/page.tsx`:
- read `brandingForRequest()`;
- the header shows `<OrgLogo branding={branding} width={22} height={22} />` before "Program Landscape";
- the sentence becomes `Use your {branding ? `${branding.shortNameEn} ` : ''}institutional account. Access is scoped to your role.`.

`app/page.tsx:43`: the retired title `'Home · Curriculum Landscape · KKU'` becomes `'Home'`. The layout's title template adds the tagline. CLAUDE.md lists "Curriculum Landscape" as a retired name that must never appear.

- [ ] **Step 4: Run tests, typecheck, lint and a browser check**

Run: `pnpm --filter web exec vitest run test/brand-chrome.test.tsx && pnpm --filter web test 2>&1 | tail -3 && pnpm --filter web typecheck && pnpm exec eslint apps/web/src/components/brand apps/web/src/components/shell apps/web/app/signin apps/web/app/profile apps/web/app/page.tsx`
Expected: PASS. The web total is the baseline plus the new tests.

Browser check with playwright-cli (`--browser chromium`, run from a temp dir; dev account `admin@kku.ac.th` / `kku-dev`):
- the sign-in page shows the product mark and "Use your KMUTT institutional account";
- after signing in, the sidebar shows the product mark and "KMUTT Curriculum Intelligence";
- the footer reads "© 2026 King Mongkut's University of Technology Thonburi";
- no setup banner shows, because the dev profile exists.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components apps/web/app/signin apps/web/app/profile apps/web/app/page.tsx apps/web/test/brand-chrome.test.tsx
printf 'feat(web): app chrome follows the organisation brand\n\nLogo or product mark, tagline wordmark, footer, sign-in copy, setup\nbanner; drops the retired title on the home page.\n\nCo-Authored-By: <your model name> <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 7: Web admin: the Brand tab

**Files:**
- Modify: `apps/web/app/admin/organization/page.tsx`, `client.tsx` (tabs)
- Create: `apps/web/app/admin/organization/brand-tab.tsx` (client)
- Create: `apps/web/app/api/admin-organization/brand/route.ts` (PUT proxy), `apps/web/app/api/admin-organization/assets/[kind]/route.ts` (POST/DELETE proxy)
- Test: `apps/web/app/admin/organization/brand-tab.test.tsx`

**Interfaces:**
- Consumes: Task 1 `deriveBrandTokens`, `brandCss` from `@kku/shared/brand` (client-safe); Task 3 endpoints.
- Produces: `BrandTab({ profile, onSaved }: { profile: OrganizationProfileDto; onSaved: (p: OrganizationProfileDto) => void })`. `OrganizationProfileDto` (Phase 1, in `client.tsx`) gains `logoLightKey`, `logoDarkKey`, `faviconKey`, `primaryColor`, `secondaryColor` (all `string | null`).

- [ ] **Step 1: Write the failing render test**

`apps/web/app/admin/organization/brand-tab.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BrandTab } from './brand-tab';

const base = {
  id: 'default', nameTh: 'ท', nameEn: 'Example University', shortNameTh: 'มต.', shortNameEn: 'EXU',
  regionTh: null, regionEn: null, contactEmail: null, appUrl: 'https://x.example', version: 3,
  updatedAt: '2026-10-16T00:00:00Z', updatedBy: null,
  logoLightKey: null, logoDarkKey: null, faviconKey: null, primaryColor: null, secondaryColor: null,
};

describe('BrandTab', () => {
  it('shows the contrast report for the stored colours', () => {
    const html = renderToStaticMarkup(<BrandTab profile={{ ...base, primaryColor: '#f26522' }} onSaved={() => {}} />);
    expect(html).toMatch(/primary text on primary/i);
    expect(html).toMatch(/\d+\.\d\d:1/);
  });

  it('blocks saving while a colour fails the gate', () => {
    const html = renderToStaticMarkup(<BrandTab profile={{ ...base, primaryColor: '#808585' }} onSaved={() => {}} />);
    expect(html).toMatch(/too close to grey/i);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Save colours/);
  });

  it('offers an upload for each asset and a remove button only for uploaded ones', () => {
    const html = renderToStaticMarkup(<BrandTab profile={{ ...base, logoLightKey: 'logo-light/a.png' }} onSaved={() => {}} />);
    expect(html).toMatch(/Logo \(light mode\)/);
    expect(html).toMatch(/Logo \(dark mode\)/);
    expect(html).toMatch(/Favicon/);
    expect((html.match(/>Remove</g) ?? []).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter web exec vitest run app/admin/organization/brand-tab.test.tsx`
Expected: FAIL with the module missing.

- [ ] **Step 3: Implement**

Proxies:
- `apps/web/app/api/admin-organization/brand/route.ts`: copy `apps/web/app/api/admin-organization/route.ts` (Phase 1 PUT proxy) and change the upstream path to `/api/v1/admin/organization/brand`.
- `apps/web/app/api/admin-organization/assets/[kind]/route.ts`:
  - **POST** forwards the multipart body unchanged: `body: req.body`, `duplex: 'half'`, and the original `content-type` header (which carries the boundary) plus the bearer header built the Phase 1 way.
  - **DELETE** forwards with no body.
  - Both validate `kind` against `BRAND_ASSET_KINDS` (404 otherwise) and gate with `requireSession({ minRole: 'admin' })` as the Phase 1 proxies do.

`brand-tab.tsx` (`'use client'`). Structure:
- **State.** `primary` and `secondary` are strings, initialised from the profile or `''`. Also hold `version` and `uploading: BrandAssetKind | null`.
- **Derivation.** `const derived = deriveBrandTokens(primary || null, secondary || null)`, computed on every render. It is pure and microseconds fast.
- **Colours section.**
  - For each of primary and secondary: `<input type="color">` beside a text `<input>` holding the hex; editing either updates the other. Secondary also has a "Clear" button.
  - Below them, a list of `derived.checks`, each line `{name} ({mode}): {ratio.toFixed(2)}:1 — needs {required}:1`, with `<Badge tone="success">pass</Badge>` / `<Badge tone="warning">fail</Badge>`.
  - Then `derived.errors`, each as a line of text.
  - Then a `<Button disabled={!derived.ok || saving}>Save colours</Button>`.
  - Save PUTs `/api/admin-organization/brand` with `{ primaryColor: primary || null, secondaryColor: secondary || null, expectedVersion: version }`. Handle a 409 `ORG_VERSION_CONFLICT` with the same toast as Phase 1. On success, `onSaved(profile)` and a `toast.success('Brand saved.')`.
  - Parse responses with Phase 1's `save-response.ts` helper (`apps/web/app/admin/organization/save-response.ts`).
- **Live preview.**
  - A `<div style={…}>` scope whose inline CSS custom properties are set from `derived.tokens.light`. Example: `{'--color-accent-default': tokens.light['accent-default']}`, typed as `React.CSSProperties & Record<string, string>`.
  - Inside the scope: a `Button`, a `Badge` and the `ProductMark`, so they take the new colour.
  - Repeat the scope for dark mode inside a wrapper with `data-theme="dark"` and `className="rounded-md bg-surface-0 p-3"`. Its inline vars come from `tokens.dark`.
  - Inline custom properties on an element override the theme's, so no extra CSS is needed.
- **Assets section.** For each kind: `Logo (light mode)` / `Logo (dark mode)` / `Favicon`.
  - A thumbnail `<img src={`/brand/${kind}?v=${version}`}>`.
  - A file input (`accept="image/png,image/svg+xml"`, or `image/png` for the favicon). On change it POSTs `FormData` with field `file` to `/api/admin-organization/assets/${kind}`.
  - A **Remove** button only when that key is non-null; it DELETEs.
  - Show `toast.error` with the API's message on a 400 (for example "SVG contains scripts…"). On success, update `version` and `onSaved`.
  - Below the inputs, the limits text: "PNG or SVG, up to 1 MB and 2048 px per side. Favicon: square PNG, at least 32 px."

`client.tsx`:
- add tabs `Identity` / `Brand`, driven by `?tab=identity|brand` via `useSearchParams` / `useRouter().replace`;
- the Brand tab is disabled, with the hint "Save the identity first.", while `profile` is null;
- the existing identity form becomes the Identity tab's content, unchanged;
- extend `OrganizationProfileDto` with the five fields.

`page.tsx` already passes the full profile, which now includes the new columns; no change beyond types.

- [ ] **Step 4: Run tests, typecheck, lint and a browser check**

Run: `pnpm --filter web exec vitest run app/admin/organization && pnpm --filter web typecheck && pnpm exec eslint apps/web/app/admin/organization apps/web/app/api/admin-organization`
Expected: PASS, clean.

Browser check (playwright-cli as before), at `/admin/organization?tab=brand`:
1. Enter `#f26522` as primary. Expect all checks to pass and the preview button to turn orange. Save, and expect the toast. The page `<style id="org-brand">` (view source) now carries accent tokens, and the sidebar accent colour changes after a reload.
2. Enter `#808585`. Expect the "too close to grey" error and Save disabled.
3. Upload a small PNG. Generate one from a temp dir with `node -e` writing a valid 64×64 PNG, or use any PNG on disk under `/usr/share` (`find /usr/share -name "*.png" -size -200k | head -1`). Expect the thumbnail and the sidebar logo to switch to it.
4. Click **Remove**, and expect the product mark to come back.
5. Upload an SVG containing `<script>` (write it to a temp file). Expect the rejection toast.

Finally, **leave the dev profile with primary `#f26522` and no logos** (this install's KMUTT orange), and report that state.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/organization apps/web/app/api/admin-organization
printf 'feat(web): Brand tab — colours with live contrast check, logo and favicon uploads\n\nCo-Authored-By: <your model name> <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 8: KKU brand seed, asset move, docs and verification

**Files:**
- Move: `apps/web/public/brand/kku-logo-light.png`, `apps/web/public/brand/kku-logo-dark.png` → `apps/ingestion/assets/kku/` (`git mv`). Recover the favicon Task 5 deleted: `git show "$(git log --diff-filter=D --format=%h -1 -- apps/web/app/icon.png)^:apps/web/app/icon.png" > apps/ingestion/assets/kku/favicon.png`.
- Create: `apps/ingestion/src/lib/kku-brand.ts` (pure planner)
- Modify: `apps/ingestion/src/scripts/org-seed-kku.ts`, `apps/ingestion/Dockerfile.prod` (copy `assets`)
- Modify: `docs/adopters/README.md`, `docs/adopters/README.th.md`, `DEPLOYMENT.md` (short notes)
- Test: `apps/ingestion/test/kku-brand.test.ts`

**Interfaces:**
- Consumes: Task 1 `oklchToHex`, `deriveBrandTokens`; Task 2 `saveOrganizationBrand`, `setOrganizationAsset`; Task 3's validation module is api-only, so the KKU files are trusted repo assets and are not re-validated.
- Produces: `planKkuBrandFill(row: { logoLightKey: string | null; logoDarkKey: string | null; faviconKey: string | null; primaryColor: string | null; secondaryColor: string | null }): { assets: BrandAssetKind[]; colours: boolean }`. It lists only the fields that are null; `colours` is true only when **both** colours are null (never half-overwrite an admin's palette).
- `KKU_BRAND_COLOURS = { primary: oklchToHex({ l: 0.7, c: 0.15, h: 45 }), secondary: oklchToHex({ l: 0.44, c: 0.165, h: 20 }) }`

- [ ] **Step 1: Write the failing test**

`apps/ingestion/test/kku-brand.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveBrandTokens } from '@kku/shared';
import { KKU_BRAND_COLOURS, planKkuBrandFill } from '../src/lib/kku-brand';

const EMPTY = { logoLightKey: null, logoDarkKey: null, faviconKey: null, primaryColor: null, secondaryColor: null };

describe('planKkuBrandFill', () => {
  it('fills everything on a profile with no brand yet', () => {
    expect(planKkuBrandFill(EMPTY)).toEqual({ assets: ['logo-light', 'logo-dark', 'favicon'], colours: true });
  });

  it('never overwrites what an admin already set', () => {
    expect(planKkuBrandFill({ ...EMPTY, logoDarkKey: 'logo-dark/x.svg', secondaryColor: '#123456' })).toEqual({
      assets: ['logo-light', 'favicon'],
      colours: false,
    });
  });
});

describe('KKU_BRAND_COLOURS', () => {
  it('derive to today\'s coral and cardinal and pass the gate', () => {
    const r = deriveBrandTokens(KKU_BRAND_COLOURS.primary, KKU_BRAND_COLOURS.secondary);
    expect(r.ok).toBe(true);
    expect(r.tokens.light['accent-default']).toMatch(/^70\.0% 0\.15\d /);
    expect(r.tokens.light['brand-cardinal']).toMatch(/^44\.0% 0\.16\d /);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter ingestion exec vitest run test/kku-brand.test.ts`
Expected: FAIL with the module missing.

- [ ] **Step 3: Implement**

`apps/ingestion/src/lib/kku-brand.ts`:

```ts
import { oklchToHex, type BrandAssetKind } from '@kku/shared';

// KKU's brand, exactly as the app looked before white-labelling: the coral
// accent and the cardinal from tokens.css, and the official logo set copied to
// apps/ingestion/assets/kku/. Used only by org-seed-kku on KKU's deployment.

export const KKU_BRAND_COLOURS = {
  primary: oklchToHex({ l: 0.7, c: 0.15, h: 45 }),
  secondary: oklchToHex({ l: 0.44, c: 0.165, h: 20 }),
};

export const KKU_ASSET_FILES: Record<BrandAssetKind, string> = {
  'logo-light': 'kku-logo-light.png',
  'logo-dark': 'kku-logo-dark.png',
  favicon: 'favicon.png',
};

export function planKkuBrandFill(row: {
  logoLightKey: string | null;
  logoDarkKey: string | null;
  faviconKey: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}): { assets: BrandAssetKind[]; colours: boolean } {
  const assets: BrandAssetKind[] = [];
  if (!row.logoLightKey) assets.push('logo-light');
  if (!row.logoDarkKey) assets.push('logo-dark');
  if (!row.faviconKey) assets.push('favicon');
  return { assets, colours: row.primaryColor === null && row.secondaryColor === null };
}
```

`org-seed-kku.ts`. After the identity step, whether the identity was created or already existed, and only when not in `--check` mode:

1. Read the profile row.
2. Run `planKkuBrandFill(row)`.
3. For each planned asset:
   - read the file from the assets folder with `path.join(ASSETS_DIR, KKU_ASSET_FILES[kind])`, where `ASSETS_DIR` is resolved with `path.resolve(__dirname, '..', '..', 'assets', 'kku')`;
   - if it isn't there, fall back to `path.resolve(process.cwd(), 'assets', 'kku')` for the bundled `/app/dist/scripts` layout in the container; `/app/assets` is created by the Dockerfile change below;
   - upload it with an `S3Storage` put. Use bucket `MINIO_BUCKET_BRANDING ?? 'branding'` (`ensureBucket` first), the key `${kind}/<sha256>.png` (same scheme as the api) and the MinIO env keys;
   - call `setOrganizationAsset(kind, key, 'org-seed-kku')`.
4. If `colours`, derive tokens with `deriveBrandTokens(KKU_BRAND_COLOURS.primary, KKU_BRAND_COLOURS.secondary)` and call `saveOrganizationBrand({ primaryColor, secondaryColor, expectedVersion: currentRow.version }, tokens, 'org-seed-kku')`.
5. Log one line per filled field (`brand: logo-light uploaded`, `brand: colours set`) or `brand: nothing to fill`.
6. If MinIO is not configured, log `brand: object storage not configured — logos skipped` and still set the colours.

Extract steps 3–4 into a function in `kku-brand.ts` that takes injected dependencies (`readFile`, `putObject`, the two db writers), so the orchestration is unit-testable. Add one test with fakes: the planned assets are uploaded and written; colours are written only when planned.

`apps/ingestion/Dockerfile.prod`: in the runner stage, next to where `dist` is copied, add `COPY --from=<build stage name> /<build workdir>/apps/ingestion/assets ./assets`. Read the Dockerfile to get the stage name and path right. The runner runs as uid 1010, and read access is enough.

Docs:
- `docs/adopters/README.md` and `README.th.md`: one paragraph under the identity row added in Phase 1. Brand colours and logos are set on the same page's **Brand** tab, and the app derives light/dark shades and checks readability.
- `DEPLOYMENT.md`: `ORG_SEED_KKU=1` now also fills KKU's logos and colours where they are still empty; it never overwrites.

- [ ] **Step 4: Full verification**

Run: `pnpm --filter ingestion exec vitest run test/kku-brand.test.ts test/scripts-load-organization.test.ts && pnpm --filter ingestion build 2>&1 | tail -3`
Expected: PASS; the bundle includes `org-seed-kku.js`.

Run: `pnpm check 2>&1 | tail -30` and record per-package totals against the Phase 1 end state: shared 1327 / 4 known failures, db 957 / 5 known failures, api 417, ingestion 473, web 536, each plus this phase's new tests. Lint errors only in untouched files are pre-existing.

**Production web build (release blocker carried from Phase 1).** `next build` writes `apps/web/.next`, which the running dev server uses, so:
1. resolve the web dev PIDs with `ss -ltnp | grep 3000` and the parent `next dev`, and stop them explicitly (never `pkill -f "pnpm dev"`);
2. run `pnpm --filter web build 2>&1 | tail -20`;
3. restart `pnpm --filter web dev` in the background (log to a temp file) and confirm `curl -sI localhost:3000/signin` returns 200.

Expected: the build succeeds. A build-time failure that names the database or MinIO is a Review Focus #1 bug; fix it in `brandingForRequest` / the route, not by skipping pages.

**Do not run `org-seed-kku` against this dev database** (it is KMUTT's install). Its brand fill is covered by the unit test with fakes.

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion/assets apps/ingestion/src/lib/kku-brand.ts apps/ingestion/src/scripts/org-seed-kku.ts apps/ingestion/test/kku-brand.test.ts apps/ingestion/Dockerfile.prod apps/web/public/brand docs/adopters DEPLOYMENT.md
printf 'feat: KKU brand seed fills empty logo/colour fields; logos leave web/public\n\nCo-Authored-By: <your model name> <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

## Deployment note for KKU (carry into the release notes)

- The migration `20261016120000_organization_brand` is additive.
- Deploy as before with `ORG_SEED_KKU=1 ./scripts/deploy.sh …`. The seed now also uploads KKU's logos and favicon to MinIO bucket `branding` and sets the coral and cardinal colours, **only where those fields are empty**. The result looks identical to today.
- Other installs fill in the Brand tab at `/admin/organization?tab=brand` after deploy. Until they do, the app shows the neutral product mark and the default palette.
