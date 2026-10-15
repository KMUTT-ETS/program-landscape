# White label: admin-configurable organisation info and corporate identity

- **Date:** 2026-10-15
- **Status:** design approved in conversation; awaiting written-spec review
- **Branch:** `feat/white-label` (off `develop`)
- **Builds on:** `feat/institution-identity` (`getInstitution()`, prompts parameterised with `${inst.*}`)

## 1. Goal

Program Landscape is being adopted by universities other than KKU. Each adopter runs **its own installation** and must be able to set its organisation details and corporate identity (CI) **from an admin page at runtime** — no rebuild, no redeploy, no `.env` edit.

### Agreed requirements

| # | Requirement |
|---|---|
| R1 | One organisation per installation. Multi-tenancy is out of scope. |
| R2 | Admin edits: Thai/English name, Thai/English short name, optional region, optional contact email, public app URL. |
| R3 | Admin sets CI: logo (light), logo (dark), favicon, primary brand colour, optional secondary colour. |
| R4 | Fonts are fixed: Sarabun / Inter / JetBrains Mono in the UI, TH Sarabun New in PDFs. |
| R5 | The product name stays **Program Landscape**; the tagline becomes "*<shortNameEn>* Curriculum Intelligence Platform". |
| R6 | Organisation identity lives **only in the database**. The `INSTITUTION_*` keys are removed from `.env`; a fresh install prompts the admin to fill them in. |
| R7 | Surfaces that follow the settings: app chrome, brand colours, PDF exports, prose and AI text. |
| R8 | Editing is gated by the existing `settings:configure` permission (SUPER_ADMIN + SYSTEM_ADMIN) and every change is audit-logged. |
| R9 | The KKU deployment must look and behave exactly as it does today after migrating. |

### Out of scope

- Multi-tenant hosting.
- KKU-specific **integrations**: KKU SSO (`kku-sso-client`), `kku/employee-api`, and the `kku-*` connectors. These are data plumbing, not branding; another adopter disables or replaces them.
- Font selection or upload.
- Rebranding developer-facing docs (`CLAUDE.md`, `docs/**`, `prompts/**`). Setup instructions that name the removed env keys are still updated (§4.3).
- Renaming the product.

## 2. Architecture overview

```
           admin (settings:configure)
                    │  PUT /admin/organization  (+ asset uploads → MinIO "branding")
                    ▼
        ┌────────────────────────┐   version++
        │ organization_profile   │◄─────────────── 60 s version poll ───┐
        │ (singleton, 'default') │                                       │
        └───────────┬────────────┘                                       │
     loadOrganization(prisma) at boot                                    │
        ┌───────────┼──────────────────────┬─────────────────────────┐   │
        ▼           ▼                      ▼                         ▼   │
   apps/api    apps/ingestion worker   CLI scripts             apps/web (Next)
   (cache)     (cache)                 runWithOrganization()   getOrganization()
        │           │                      │                    React cache()
   getInstitution() — sync, throws if not loaded / not configured
        │
   AI prompts, connectors, health score, deep-dive, PdfService brand block
```

The chosen approach (A, "boot-loaded cache") keeps the ~30 existing synchronous `getInstitution()` call sites unchanged. The alternatives, passing `inst` explicitly through ~60 signatures (B) or making it async everywhere (C), were rejected for churn with no correctness gain.

## 3. Data model

New Prisma model, one additive migration, no backfill.

```prisma
/// Singleton: the organisation this installation serves. id is always 'default'.
model OrganizationProfile {
  id               String   @id @default("default")
  nameTh           String   @map("name_th")        // must match TCAS สถาบัน spelling
  nameEn           String   @map("name_en")
  shortNameTh      String   @map("short_name_th")
  shortNameEn      String   @map("short_name_en")
  regionTh         String?  @map("region_th")      // e.g. อีสาน
  regionEn         String?  @map("region_en")      // e.g. Northeast
  contactEmail     String?  @map("contact_email")  // outbound User-Agent only
  appUrl           String   @map("app_url")
  logoLightKey     String?  @map("logo_light_key") // MinIO object keys, bucket "branding"
  logoDarkKey      String?  @map("logo_dark_key")
  faviconKey       String?  @map("favicon_key")
  primaryColor     String?  @map("primary_color")  // #rrggbb as entered
  secondaryColor   String?  @map("secondary_color")
  brandTokensJson  Json?    @map("brand_tokens_json") // derived tokens, light + dark
  termsMd          String?  @map("terms_md")
  privacyMd        String?  @map("privacy_md")
  copyrightMd      String?  @map("copyright_md")
  disclaimerMd     String?  @map("disclaimer_md")
  version          Int      @default(1)
  updatedAt        DateTime @updatedAt @map("updated_at")
  updatedBy        String?  @map("updated_by")

  @@map("organization_profile")
}
```

- **Fresh install:** no row exists.
- **KKU:** a one-off, idempotent seed script `pnpm org:seed-kku` writes KKU's current values. It also uploads `kku-logo-{light,dark}.png` and the current favicon to MinIO, and copies the current legal-page text into the `*Md` columns. After it has run, the KKU PNGs are removed from `apps/web/public/brand/` so they cannot ship in other installs.
- **Why a dedicated table and not `SystemSetting` keys:** typed columns, a single Zod schema, and one `version` for cache-busting and optimistic locking.

## 4. Runtime access (approach A)

### 4.1 Cache

`packages/shared/src/institution.ts` keeps the `Institution` type and `getInstitution()` / `outboundUserAgent()` / `isOwnInstitution()`. It changes in four ways:

- `getInstitution()` **takes no `env` argument** and reads a module-level cache.
- **Not loaded** → throws `OrganizationNotLoadedError` (a programming error).
- **Loaded but no row** → throws `OrganizationNotConfiguredError`.
- **All KKU default values are deleted.** Nothing can silently fall back to KKU.

New file `packages/db/src/organization.ts`:

- `loadOrganization(prisma)`: reads the row, fills the shared cache, and records `version`.
- `startOrganizationRefresh(prisma, intervalMs = 60_000)`: in long-running processes, polls `SELECT version` and reloads when it changes.
- `getOrganizationProfile(prisma)`: the full row, for admin and web use.
- `setOrganizationForTest(inst | null)`: the test seam, exported from shared.

### 4.2 Where it is loaded

| Process | Where | Behaviour when no row exists |
|---|---|---|
| `apps/api` | `main.ts`, before `listen` | Boots. Identity-dependent endpoints return 409 `ORG_NOT_CONFIGURED`. |
| `apps/ingestion` worker | `main.ts`, before workers start | Boots. Identity-dependent jobs fail with `NonRetryableError`. |
| CLI scripts | `runWithOrganization(main)` wrapper in `apps/ingestion/src/lib/` | The script exits with a clear message. Required for the six esbuild-bundled pipeline scripts and any script that builds prompts or sends a User-Agent. Any script that is missed throws on first use. |
| `apps/web` | `getOrganization()`: async, React `cache()` per request, revalidated by `version` | Renders the setup banner. |

The api refreshes its own cache synchronously after a successful `PUT`. Other processes see the change within 60 s. This is the accepted latency; Redis pub/sub is not introduced.

### 4.3 Env removal

- Remove `INSTITUTION_NAME_TH/EN`, `INSTITUTION_SHORT_NAME_TH/EN` and `INSTITUTION_CONTACT_EMAIL` from `.env.example` and `.env.prod.example`, and from the docs that mention them (adopter guide ch. 7, fresh-checkout guide).
- `APP_PUBLIC_URL` moves into the profile (`appUrl`).
- `OPENALEX_MAILTO` stays: it is an OpenAlex polite-pool setting, no longer a fallback for identity.

## 5. Brand colours

### 5.1 Tokens that move

- **Primary** drives `--color-accent-{default,hover,active,subtle,fg}`, light and dark.
- **Secondary** drives `--color-brand-cardinal{,-hover,-subtle}`, light and dark. When no secondary is set, the built-in values stay.
- **Fixed:** charts, status, risk red, surfaces, text, borders. Token *names* do not change, so no utility class changes.

### 5.2 Derivation: `packages/design/src/brand.ts`

`deriveBrandTokens(hex): { light: Record<token, 'L C H'>, dark: …, checks: ContrastReport }`

1. Convert hex → OKLab → OKLCH. The ~40 lines of maths are hand-written; no new dependency.
2. Keep the admin's hue and chroma. Chroma is clamped into the sRGB gamut at each target lightness.
3. **Light mode:** default L 70 %, hover +6, active −8, subtle L 95.5 % with chroma ×0.27. **Dark mode:** mirror the current dark steps (default L 53 %, hover −5, active −10). These are the current coral token steps, so a coral input reproduces today's tokens within rounding.
4. `fg` is whichever of near-black (L 22 %) or near-white (L 98 %) has the higher contrast against `default`.
5. **Contrast gate** (WCAG 2.x relative luminance), in both modes:
   - `fg` on `default` ≥ 4.5:1;
   - `default` against `surface-0` ≥ 3:1.
6. **Low chroma** (C < 0.04) is rejected with the message "too close to grey: pick a stronger shade".

The derived tokens are stored in `brandTokensJson` at save time, so pages never recompute them.

### 5.3 Injection

The root layout (a server component) renders `<style id="org-brand">` in `<head>`:

```css
[data-theme='light'] { --color-accent-default: 70% 0.15 45; … }
[data-theme='dark']  { --color-accent-default: 53% 0.18 38; … }
```

- It is in the first HTML response, so there is no flash of the wrong theme.
- With no profile or no colours, nothing is injected and `tokens.css` defaults apply.
- The ESLint hex ban is unaffected: these values are generated, not literals.

## 6. Logos and favicon

- **Upload:** `POST /admin/organization/assets/:kind`, where `kind ∈ {logo-light, logo-dark, favicon}`.
  - PNG or SVG; favicon PNG square ≥ 32 px.
  - At most 1 MB, at most 2048 px per side.
  - Stored in MinIO bucket `branding` (`MINIO_BUCKET_BRANDING`, default `branding`), created on first use following the avatars bucket.
- **SVG sanitisation** (server side): strip `<script>`, `<foreignObject>`, `on*` attributes, and `href`/`xlink:href` other than `#fragment` or `data:image/*`. Served with `Content-Type: image/svg+xml` and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`.
- **Serving:** `apps/web/app/brand/[asset]/route.ts` serves `/brand/logo-light?v=<version>` with `Cache-Control: public, max-age=31536000, immutable`. Bumping `version` busts the cache.
- **Fallback:** a neutral built-in product mark. If MinIO is unavailable, the route serves the fallback rather than a broken image.
- **Favicon:** `app/icon.png` is removed. `generateMetadata()` sets `icons` to `/brand/favicon?v=…`.

## 7. App chrome

| Surface | Source |
|---|---|
| Tab title | `generateMetadata()`: `Program Landscape — {shortNameEn}` |
| Tagline | `{shortNameEn} Curriculum Intelligence Platform` |
| Sidebar brand mark, top bar, profile hero | `/brand/logo-{light,dark}` with the `dark:` variant |
| Sign-in page | Public `GET /organization` (no auth) |
| Footer credits | Organisation name |
| Setup banner | Shown on every page while no profile exists; links to `/admin/organization` for users with `settings:configure` |

## 8. PDFs

- **One central change:** `PdfService.generateAndPersist` adds a `brand` block to every template's data: `{ nameTh, nameEn, shortNameEn, logoDataUri?, primaryHex?, secondaryHex? }`. The logo is fetched from MinIO and embedded as a data URI, because Gotenberg's Chromium cannot reach MinIO or app auth. Callers do not change.
- `cover.tsx` shows the logo and name.
- `footer-template.ts` callers use `${brand.shortNameEn} · <Report> · …` instead of the literal `KKU · …`.
- `magazine-css.ts`: the Cardinal `#9c1d2e` becomes `brand.secondaryHex`, falling back to the current value.
- **Unchanged:** TH Sarabun New for Thai body text, and the fixed light `PRINT_PALETTE`.
- **No profile** → `ORG_NOT_CONFIGURED`. **MinIO unavailable** → PDF without a logo; this is not an error.

## 9. Prose

About 750 literal mentions across 109 web files and 29 pdf-template files fall into three kinds:

1. **Self-references to the user's university** (most of them): labels, headers, admin copy, viz labels. Replaced with `<OrgShort/>` / `<OrgName/>` server helpers, or with an `org` prop passed down from the layout into client components (client components do not fetch it).
2. **Legal pages** (`(legal)/terms|privacy|copyright|disclaimer`). These are legal text naming the KKU Act and an address, so interpolating a name would make a false legal statement. Instead:
   - They render the profile's `*Md` columns with the repo's existing Markdown renderer. The renderer must sanitise HTML.
   - **Empty column:** the page says "This organisation has not published its terms yet."
   - The editor offers a neutral starting template with `[ORGANISATION]`-style blanks.
   - KKU's text is copied in by `org:seed-kku`.
3. **Reference-deployment content.** The methodology paper's calibration figures and the changelog are facts measured on KKU, so they are kept as they are. They are labelled "measured on the reference deployment (Khon Kaen University)", and only sentences addressing the reader's own university are interpolated.

**CI grep guard:** `scripts/check-org-literals.mjs`, wired into `pnpm lint`, fails on `KKU|Khon Kaen|ขอนแก่น|มข\.` under `apps/web/app`, `apps/web/src/components` and `packages/pdf-templates/src`. Exceptions come from an allowlist file (reference-deployment sections, KKU integration modules, tests).

## 10. AI prompts

- They already read `getInstitution()`, so §4 moves them to the database with no further change.
- **Leftovers fixed here:**
  - **"297 programs"** in the analyst system prompt and a brief becomes a live active-canonical programme count passed into the builder. The analyst prompt version is bumped because the text changes for KKU when the count differs.
  - **Northeast:**
    - `regionEn/regionTh` feed the trend-signal examples.
    - The `northeast-strategic-alignment` brief becomes `regional-strategic-alignment` and is hidden when no region is set.
    - Versions are bumped.
  - **"Curriculum Compass"** is removed from `program-pedagogy` (a retired name, CLAUDE.md), bumping to `program-pedagogy.v1.2`.
  - **"สจล."** is removed from `program-digest`, with a version bump.
- **Versioning:** a change of organisation is data, not methodology, so it does not bump prompt or methodology versions. `AiInference` stores the full prompt, so the identity used for any output stays auditable.

## 11. Admin page `/admin/organization`

Gated by `settings:configure`. Tabs are kept in the URL (`?tab=identity|brand|legal|history`).

- **Identity:**
  - The R2 fields.
  - A TCAS helper beside `nameTh`. It calls `GET /admin/organization/tcas-match?name=`, which returns the exact-match row count plus the top 5 `pg_trgm` similar `institution` values from `tcas_admission_stats`.
- **Brand:**
  - Colour pickers, plus the three uploads.
  - **Live preview:** button, badge, sidebar mark and a PDF cover thumbnail, in both themes.
  - The contrast report is shown next to each colour. Save is disabled while it fails.
- **Legal:** a Markdown editor for each of the four pages, with a preview.
- **History:** read-only list of `organization.update` / `organization.asset_upload` audit rows (who, when, which fields changed).

Saves show a toast (no modal) and optimistic UI.

## 12. API

| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/v1/organization` | public | Names, tagline, asset URLs, `version`, colours. Never the legal Markdown or the contact email. |
| `GET /api/v1/admin/organization` | `settings:configure` | Full profile. |
| `PUT /api/v1/admin/organization` | `settings:configure` | Zod-validated. Body carries `expectedVersion` (409 `ORG_VERSION_CONFLICT` on mismatch). Re-runs `deriveBrandTokens` and its gate on the server (422 with the contrast report on failure). `version++`, refreshes the api cache. `@AuditLog('organization.update')` records before and after. |
| `POST /api/v1/admin/organization/assets/:kind` | `settings:configure` | Multipart; validation and sanitisation as in §6. `version++`. `@AuditLog('organization.asset_upload')`. |
| `GET /api/v1/admin/organization/tcas-match` | `settings:configure` | Read-only. |

The legal pages read their Markdown through `getOrganization()` in web server components; no separate legal endpoint is needed.

## 13. Errors

| Condition | Behaviour |
|---|---|
| No profile row | `OrganizationNotConfiguredError` → HTTP 409 `ORG_NOT_CONFIGURED`. The web shows the setup banner. Connectors and jobs fail with `NonRetryableError`. |
| Cache never loaded | `OrganizationNotLoadedError` → HTTP 500, logged at error level. A code defect. |
| Concurrent save | 409 `ORG_VERSION_CONFLICT`. The UI says "changed by someone else — reload". |
| Colour fails the gate | 422 with the contrast report. |
| MinIO down | Assets fall back to the built-in mark, PDFs omit the logo, and the admin upload shows an error. |

## 14. Testing

- **Unit:**
  - `deriveBrandTokens`: hex→OKLCH reference vectors; coral input reproduces the current tokens within ±0.5 L / ±0.005 C; contrast just above and just below 4.5:1; low-chroma rejection.
  - Organisation cache: throws before load; throws with no row; reloads on a `version` bump; test seam.
  - SVG sanitiser, Zod schemas, the grep-guard script.
- **API:** permission gating; 409 on version conflict; 422 on a failing colour; audit row written; 409 `ORG_NOT_CONFIGURED`.
- **Regression:**
  - With `org:seed-kku` applied, `prompt-identity-check` shows every prompt byte-identical to today, except the deliberately version-bumped ones.
  - The TCAS matched count is unchanged.
  - Existing shared, api, ingestion and db suites stay green, apart from failures that already exist.
- **E2E (Playwright):**
  1. An empty profile shows the banner.
  2. The admin fills in Identity and Brand.
  3. Without a restart, the title, logo and accent change.
  4. A Council Pack PDF carries the new logo and name.

## 15. Delivery phases

Each phase is shippable on its own and gets its own plan.

1. **Foundation:** migration, `organization.ts` cache, load points, `runWithOrganization`, API (identity fields), Identity tab, TCAS helper, env-key removal, `org:seed-kku`.
2. **Brand:** `deriveBrandTokens`, colour injection, asset upload and route, chrome surfaces, Brand tab, setup banner.
3. **PDFs and legal:** `PdfService` brand block, cover, footers, CSS, Legal tab and pages.
4. **Prose and AI:** self-reference sweep, reference-deployment labelling, AI leftovers with version bumps, CI grep guard, History tab, E2E.

## 16. Deployment notes (KKU)

- Run `pnpm org:seed-kku` (prod: `docker compose exec ingestion node /app/dist/scripts/org-seed-kku.js`) **immediately after** the Phase 1 migration and before traffic resumes. Without it, KKU's AI features return `ORG_NOT_CONFIGURED`.
- Add `org-seed-kku` to the esbuild-bundled script list.
- Add a preflight gate: fail the deploy if the `organization_profile` row is missing after migration.
