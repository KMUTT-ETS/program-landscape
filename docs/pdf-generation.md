# PDF generation

All PDF output for the Program Landscape app — Council Packs,
program briefs, scenario packs, weekly trend digests, decision records,
data-quality reports — routes through a single centralised service
backed by **Gotenberg** with **TH Sarabun New** embedded.

Modules **do not** generate PDFs with `puppeteer`, `@react-pdf/renderer`,
`html-pdf`, or any other in-process library. Rendering through Chromium
inside a dedicated container is the only way to guarantee correct Thai
glyph shaping + tone mark placement + word-boundary line-breaking for
every document this app produces.

## Architecture

```
┌─────────────────┐    POST /pdf/generate    ┌───────────────────┐
│  Next.js web    │─────────────────────────▶│  NestJS api       │
│  (server        │    { template, data }    │                   │
│   component)    │                          │  @Authorized      │
└─────────────────┘                          │  @AuditLog        │
                                             └─────┬─────────────┘
                                                   │
                                                   │ PdfService
                                                   ▼
                                             ┌───────────────────┐
                                             │  @kku/shared      │
                                             │  PdfGeneration    │
                                             │  Service          │
                                             └─────┬─────────────┘
                       1. render template HTML     │
                       2. POST multipart to ──────▶┼───────────────┐
                          Gotenberg                │               │
                                                   ▼               ▼
                                             ┌─────────┐     ┌──────────┐
                                             │Gotenberg│     │  MinIO   │
                                             │Chromium │     │ (PDF     │
                                             │+ Sarabun│     │  output  │
                                             └─────────┘     │  bucket) │
                                                   │          └──────────┘
                                                   │  PDF bytes
                                                   ▼
                                             signed URL → user
```

- **App (Next.js + NestJS)** reads config, enforces RBAC, audits, and
  persists the result reference in `pdf_generations`.
- **`@kku/shared`'s `PdfGenerationService`** renders React templates
  from `@kku/pdf-templates` to an HTML string, then calls Gotenberg's
  HTTP API.
- **Gotenberg** (custom image at `infra/gotenberg/`) has
  TH Sarabun New installed system-wide so Chromium can embed it.
- **MinIO** stores the finished PDF; we return a presigned URL with a
  short TTL (15 min by default).

## Why Gotenberg

- **Thai-safe Chromium rendering.** Chromium's Thai line-breaker uses
  the dictionary-based algorithm when `word-break: keep-all` is set.
  `puppeteer` would work equivalently, but it ties PDF generation to
  the app's Node.js runtime, which makes horizontal scaling and memory
  isolation fragile.
- **Docker-native.** One service, one image, one config. No chromium
  install dance on the app container.
- **HTTP API, not a library.** Our Node code does zero Chromium lifting.
  This keeps the shared `PdfGenerationService` small and stateless.
- **Office → PDF conversion** is free, via the same container's
  LibreOffice module. We don't use it yet; it's there if a module ever
  needs to surface an `.xlsx` as a PDF.

## Why TH Sarabun New

TH Sarabun New is the Cabinet-mandated standard font for Thai
government documents (Cabinet Resolution, 7 September 2010). 16pt is
the standard body size per the same resolution. Council members read
and sign official documents in this font; using any other font for
our PDFs would be both surprising and — for documents that end up in
the Council's archive — non-compliant.

Sourcing + install: see `infra/gotenberg/README.md`.

## Ops

### Rebuilding the image

The Dockerfile is intentionally strict: if any of the four `.ttf` files
is missing from `infra/gotenberg/fonts/`, `docker compose build` fails.
After replacing a font file or bumping the upstream image:

```bash
docker compose build gotenberg
docker compose up -d gotenberg
```

A post-build `fc-list` check inside the image confirms at least 4
Sarabun faces are registered — otherwise the build aborts.

### Restarting

```bash
docker compose restart gotenberg
```

Gotenberg is stateless. Restart is safe at any time. In-flight
requests from the app receive `PDF_UPSTREAM_UNAVAILABLE`; the app
retries once automatically.

### Inspecting logs

```bash
docker compose logs -f gotenberg
```

Gotenberg logs each conversion with a trace id. The app passes
`Gotenberg-Trace: <templateName>-<timestamp>` so app logs and
Gotenberg logs correlate.

### Verifying fonts

```bash
docker compose exec gotenberg fc-list | grep -i sarabun
```

Expect 4 lines (Regular, Bold, Italic, Bold Italic). If empty, the
image is wrong — rebuild.

### Admin dashboard

`/admin/pdf-generation` (ADMIN role only) shows registered templates +
the last 50 generations with timing, size, and any errors. The API
endpoint `GET /pdf/admin/recent` is the data source.

## Writing a new template

1. **Pick a directory:** `packages/pdf-templates/src/templates/<name>/`.
2. **Schema** in `schema.ts` — a Zod object defining the typed `data`
   contract. The service parses the caller's data against this schema
   before rendering; failures surface as `PDF_TEMPLATE_DATA_INVALID`.
3. **Template** in `template.tsx` — a React component that consumes the
   parsed data. Wrap body sections in `<Section>` (from
   `components/section`). For charts, use `PrintLineChart` /
   `PrintBarChart` from `components/chart-for-print` (never Recharts'
   `ResponsiveContainer`, which does not work in server-side rendering).
4. **Export** a `TemplateDefinition` with `name`, `version`, `schema`,
   optional `defaultOptions`, and a `render(data, ctx)` that returns
   `{ html, css, footerHtml? }`. Use `baseCss` for the universal Thai
   typography rules.
5. **Register** in `packages/pdf-templates/src/index.ts`'s
   `allTemplates` tuple. Bumping `version.txt` on every behaviour
   change lets the admin dashboard show the version that rendered each
   row.
6. **Call from a module** via `PdfService.generateAndPersist({ templateName, data, ... }, user.userId)`.

## Thai PDF gotchas

These are the failure modes the base CSS + Gotenberg choice prevent.
Don't undo them accidentally.

| Symptom | Cause | Fix |
|---|---|---|
| Tofu boxes `□□□` in the PDF | Thai font not installed or not embedded | Use the custom Gotenberg image; never use upstream `gotenberg/gotenberg:8` directly |
| Line breaks mid-word | `word-break: normal` is the default — Chromium breaks Thai at character boundaries | Keep `word-break: keep-all` in `baseCss` |
| Diacritics overlapping letters above/below | Line-height too tight | Keep `line-height: 1.5` minimum on body |
| Body text looks wrong size | Using 11pt or similar — too small for Thai body | Use 16pt (Cabinet-mandated), drop to 11pt only for `[lang="en"]` fragments |
| Numbers in tables jitter between rows | Proportional figures | `font-variant-numeric: tabular-nums` (already in `baseCss`) |
| Dark-mode PDF looks unreadable printed | Template inheriting UI theme | Templates must be light-only (already enforced in `baseCss`) |
| `@react-pdf/renderer` renders but Thai looks broken | Its shaper doesn't handle Thai correctly | Don't use `@react-pdf/renderer`. Render React to HTML, let Chromium do the PDF |

## Wait-for-render

Charts rendered server-side (via `renderToStaticMarkup` + explicit
width/height) are already complete when Gotenberg receives the HTML —
no wait-for-render needed for the default template set. If a future
template loads dynamic content client-side, pattern:

1. Template renders an initial `<script>window.__pdfReady = false;</script>`
2. Dynamic code (chart, data fetch) calls
   `window.__pdfChartReady('id')` when done; coordinator sets
   `window.__pdfReady = true` when all IDs have reported in.
3. Template's `defaultOptions.waitForExpression =
   'window.__pdfReady === true'`.
4. `GOTENBERG_REQUEST_TIMEOUT_MS` caps how long Gotenberg waits.

## Failure modes + how the service handles them

| Error code | When | Retry? |
|---|---|---|
| `PDF_TEMPLATE_NOT_FOUND` | Template name not registered | No |
| `PDF_TEMPLATE_DATA_INVALID` | Caller's `data` fails the schema | No |
| `PDF_RENDER_TIMEOUT` | Gotenberg request exceeded timeout | No (timeout = deterministic) |
| `PDF_UPSTREAM_UNAVAILABLE` | Gotenberg unreachable / 5xx | **Yes, once** after 500ms |
| `PDF_UPSTREAM_REJECTED` | Gotenberg 4xx (bad HTML, bad form field) | No (deterministic) |
| `PDF_STORAGE_FAILED` | MinIO putObject failed | No — surface to user |
| `PDF_INTERNAL` | Anything else | No |

Every attempt — success or failure — is logged in `pdf_generations`
with the template name, version, data hash (SHA-256 of the input),
timing, and error details.

## What this service does NOT do (yet)

Deferred for later prompts:

- **Page-level rate limiting** per user — the NestJS `ThrottlerGuard`
  applies a global 120/min; per-user 60/hour limits on `/pdf/generate`
  need a module-level override. Tracking in the admin dashboard's
  "failure rate / p95 latency" metrics is also deferred.
- **Visual regression tests** — the Dockerfile's post-build `fc-list`
  check catches the "fonts didn't install" case; proper golden-PDF
  snapshot tests for each template need human-reviewed goldens first.
- **Merge helper wired through the API** — `PdfGenerationService.merge()`
  works but no HTTP endpoint exposes it yet. Council Pack section
  composition (prompt 12) will need it.
