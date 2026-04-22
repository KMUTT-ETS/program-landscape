# Prompt 02c — PDF Generation Service (Gotenberg + TH Sarabun New)

> **When to use:** After design system (02b), before any module that exports PDFs. All Council Pack, brief, and report PDFs in modules 05, 06, 07, 08, 09, 12 will use this service.
>
> **Skills to invoke:**
> - `pdf` — for PDF design conventions
> - `frontend-design` — for the HTML template aesthetic

---

Before starting, please read and apply:
- `/mnt/skills/public/pdf/SKILL.md`
- `/mnt/skills/public/frontend-design/SKILL.md`

Read `CLAUDE.md`, `GLOBAL-UPDATES.md`, `docs/design-system.md`.

---

Build the centralized PDF generation service. **All PDF output in this app routes through here** — Council Packs, briefs, scenario packs, decision reports, sectoral analyses. No module generates PDFs directly.

**Why this exists:** Thai-language PDFs are notoriously fragile. Wrong font handling produces tofu boxes (□□□), broken line breaks, missing tone marks, or word-wrapping at character boundaries instead of word boundaries. Gotenberg + properly embedded TH Sarabun New eliminates these failure modes.

## Stack decision

- **Gotenberg** (latest stable, currently 8.x) as the conversion engine
- Runs as its own service in docker-compose
- Custom Docker image extending the official Gotenberg image with **TH Sarabun New** installed system-wide
- HTML → PDF via Chromium module (preferred for full design control)
- Office → PDF via LibreOffice module (for occasional .docx/.xlsx → PDF needs)

## 1. Custom Gotenberg Docker image

> **Windows/WSL2 developer note:** The Dockerfile below and all files in `infra/gotenberg/` **must** be saved with LF line endings. Without LF, the `fc-cache -f -v` step fails silently (line continuations break with CRLF). The repo's `.gitattributes` handles this automatically; just don't manually override it in an editor.

Create `infra/gotenberg/Dockerfile`:

```dockerfile
FROM gotenberg/gotenberg:8

USER root

# Install TH Sarabun New (Thai government standard font, per
# Cabinet Resolution 7 Sep 2010) and supporting Thai fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-thai-tlwg \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Copy TH Sarabun New font files (place in infra/gotenberg/fonts/)
COPY fonts/THSarabunNew.ttf       /usr/share/fonts/truetype/thsarabun/
COPY fonts/THSarabunNew-Bold.ttf  /usr/share/fonts/truetype/thsarabun/
COPY fonts/THSarabunNew-Italic.ttf /usr/share/fonts/truetype/thsarabun/
COPY fonts/THSarabunNew-BoldItalic.ttf /usr/share/fonts/truetype/thsarabun/

# Refresh font cache so Chromium picks them up
RUN fc-cache -f -v

USER gotenberg
```

**Font sourcing instructions** (document in `infra/gotenberg/README.md`):
- TH Sarabun New is free for any use under SIPA's open license
- Download from: SIPA / f0nt.com / Google Fonts (Sarabun is a Google Fonts variant; TH Sarabun New is the official Thai government version — use the official one for documents going to Council)
- 4 weight files needed: Regular, Bold, Italic, BoldItalic
- Commit the .ttf files to the repo under `infra/gotenberg/fonts/` (they're free to redistribute)
- Verify font cache after build: `docker run --rm <image> fc-list | grep -i sarabun` should show all four weights

## 2. docker-compose addition

```yaml
gotenberg:
  build:
    context: ./infra/gotenberg
  container_name: kku-gotenberg
  restart: unless-stopped
  ports:
    - "3001:3000"  # Gotenberg defaults to 3000; remap to avoid clash with Next.js
  environment:
    CHROMIUM_DISABLE_WEB_SECURITY: "false"
    API_TIMEOUT: "60s"
    LOG_LEVEL: "info"
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

Add `GOTENBERG_URL=http://gotenberg:3000` to env (use `http://localhost:3001` in non-Docker dev).

## 3. PdfGenerationService

`packages/shared/src/pdf/` — the abstraction every module uses.

```ts
interface PdfGenerationService {
  // Render an HTML template to PDF
  renderHtml(req: RenderHtmlRequest): Promise<PdfResult>;

  // Convert an existing Office document to PDF
  convertOffice(req: ConvertOfficeRequest): Promise<PdfResult>;

  // Merge multiple PDFs (used to combine Council Pack sections)
  merge(req: MergeRequest): Promise<PdfResult>;
}

interface RenderHtmlRequest {
  templateName: string;       // e.g. 'council-pack', 'program-deep-dive', 'scenario-pack'
  data: Record<string, unknown>;
  options?: {
    paperFormat?: 'A4' | 'A3' | 'Letter';
    orientation?: 'portrait' | 'landscape';
    marginsMm?: { top: number; bottom: number; left: number; right: number };
    headerTemplate?: string;
    footerTemplate?: string;
    printBackground?: boolean;
    waitForExpression?: string;  // e.g. wait for charts to finish rendering
  };
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
  };
}

interface PdfResult {
  buffer: Buffer;
  byteSize: number;
  pageCount: number;
  generationDurationMs: number;
  templateName: string;
  templateVersion: string;
}
```

Implementation calls Gotenberg's HTTP API (`/forms/chromium/convert/html` for HTML, `/forms/libreoffice/convert` for Office, `/forms/pdfengines/merge` for merge).

**Rules:**
- Every call audit-logged (template name, data hash, requester, output size, duration)
- Generated PDFs stored in MinIO with retention policy
- Returned to user via signed URL (not streamed through API to keep API stateless)
- Failed generations retry once with exponential backoff; second failure surfaces clearly to user
- Template version tracked — when a template changes, regenerated PDFs note the new version

## 4. HTML template system

Build `packages/pdf-templates/` with:

**Templating engine:** Use a server-rendered React approach (e.g., `@react-pdf/renderer` is tempting but **don't** — it doesn't handle Thai well. Render React to HTML server-side, then send HTML to Gotenberg for actual PDF rendering by Chromium, which handles Thai correctly with embedded fonts).

Alternative: simple Handlebars or EJS templates. Pick whichever the team prefers; document the choice.

**Template inventory** (build these now as base, modules will extend):
- `council-pack` — the master Council Pack format (cover + exec summary + sections + appendix)
- `program-brief` — single-program one-pager
- `scenario-pack` — scenario analysis with assumptions and projections
- `weekly-trend-digest` — Trends Radar weekly export
- `decision-record` — formal decision document for Council Resolution
- `data-quality-report` — admin export for data freshness/completeness audits

Each template has:
- A directory with `template.{html,hbs,tsx}`, `style.css`, `header.html`, `footer.html`, `version.txt`
- A typed schema for its `data` input (Zod)
- A snapshot test (PDF byte hash + visual regression)

## 5. Master CSS for Thai PDFs

Critical CSS rules in `packages/pdf-templates/styles/base.css`:

```css
@page {
  size: A4;
  margin: 20mm 15mm 20mm 15mm;
}

html, body {
  /* TH Sarabun New is Thailand's Cabinet-mandated font for official documents.
     16pt is the standard size per the same Cabinet Resolution. */
  font-family: 'TH Sarabun New', 'Sarabun', sans-serif;
  font-size: 16pt;
  line-height: 1.5;     /* Thai needs more line-height than Latin */
  color: #111;
  background: white;     /* PDFs always light theme regardless of UI theme */
  /* Critical for Thai word-wrap at word boundaries, not character boundaries */
  word-break: keep-all;
  overflow-wrap: break-word;
  /* Improve Thai diacritic rendering */
  text-rendering: optimizeLegibility;
  -webkit-font-feature-settings: "liga", "clig", "calt";
  font-feature-settings: "liga", "clig", "calt";
}

/* English-language sections (e.g., axis labels) inside a Thai-primary doc */
[lang="en"] {
  font-size: 11pt;       /* English doesn't need Sarabun's 16pt */
  font-family: 'Sarabun', system-ui, sans-serif;
}

/* Tables — tabular-nums for numerical alignment */
table {
  font-variant-numeric: tabular-nums;
}

/* Headings: Sarabun Bold for emphasis, slightly larger */
h1 { font-size: 24pt; font-weight: 700; }
h2 { font-size: 20pt; font-weight: 700; }
h3 { font-size: 18pt; font-weight: 700; }

/* Print-only utilities */
.page-break-before { page-break-before: always; }
.avoid-break { page-break-inside: avoid; }
```

**Why these rules matter:**
- `font-size: 16pt` — official Thai government document standard
- `word-break: keep-all` — without this, Thai breaks at character boundaries (incorrect for a script with no spaces between words)
- `line-height: 1.5+` — Thai diacritics (vowels above/below) need vertical room
- Light theme always — PDFs print and screenshot poorly in dark mode

## 6. Chart rendering in PDFs

Charts in PDFs must be **inline SVG**, not images. Reasons:
- Crisp at any zoom
- Smaller file size for typical charts
- Searchable text within charts
- Theme-controllable (always light for PDFs)

Reuse the chart components from prompt 02b but with a `forPrint` mode that:
- Forces light theme
- Removes interactive elements (hover, tooltips)
- Inlines all styles
- Uses tabular-nums on numerical labels
- Sets explicit dimensions (no responsive)

A `<ChartForPrint>` component wrapping the regular `<Chart>` handles this.

## 7. Wait-for-render strategy

Charts may render asynchronously (Recharts measures DOM before drawing). Gotenberg must wait until charts are ready before snapshotting.

Approach:
- Each template sets `window.__pdfReady = false` at start
- Each chart calls `window.__pdfChartReady(id)` when done
- Template-level coordinator sets `window.__pdfReady = true` when all charts reported ready
- Gotenberg called with `waitForExpression: 'window.__pdfReady === true'`
- Hard timeout (e.g., 30s) prevents indefinite hangs

## 8. Master `council-pack` template

Reference implementation showing the pattern. Sections:

1. **Cover** — KKU logo, document title (Thai primary, EN below), scope (university/faculty/department/program), date, author, version
2. **Executive summary** — 1 page, Thai prose, key takeaways, AI-generated with confidence indicators
3. **Body sections** — variable, supplied by calling module
4. **Methodology appendix** — every metric used, with version + source
5. **Provenance appendix** — every data source cited with timestamps
6. **Footer on every page** — document title, page X of Y, generation timestamp, "Confidential — for Council use"

Visual style matches `docs/design-system.md` aesthetic direction. Graphic-heavy, minimal text density on each page (matches user's preferred communication style).

## 9. API endpoints

- `POST /api/v1/pdf/generate` — internal endpoint called by modules
  - Body: `{ templateName, data, options, metadata }`
  - Returns: `{ pdfUrl, expiresAt, byteSize, pageCount, generationDurationMs }`
- `GET /api/v1/pdf/:id` — fetch via signed URL (the URL returned above)
- `GET /api/v1/pdf/templates` (admin) — list available templates with versions
- Rate-limited per user (default: 60 generations/hour)

## 10. Operations

Add to admin dashboard `/admin/pdf-generation`:
- Recent generations (template, requester, size, duration, success/fail)
- Failure rate by template (alerts if any template > 5% failures)
- p95 generation latency by template
- Total Gotenberg requests/hour
- Disk usage of generated PDFs in MinIO

## 11. Tests

- **Font verification test** (CI): build the Gotenberg image, run `fc-list` inside, assert TH Sarabun New is present in 4 weights
- **Round-trip test**: generate a known Thai-text PDF via the service, extract text via pdfjs, assert text matches input character-for-character (catches font substitution issues)
- **Word-wrap test**: pass a Thai paragraph with no spaces (correct Thai), assert visual regression against golden PDF
- **Chart rendering test**: generate a Recharts-based PDF, verify SVG inlined, verify chart values match data
- **Template snapshot tests** for each template
- **Concurrency test**: 20 simultaneous generations don't crash Gotenberg

## 12. Documentation

Create `docs/pdf-generation.md`:
- Architecture diagram (App → PdfGenerationService → Gotenberg → MinIO)
- Why Gotenberg (Thai font handling, Chromium rendering, OSS, Docker-native)
- Why TH Sarabun New (Cabinet Resolution 2010, official standard, free license)
- Adding a new template (step-by-step)
- Common Thai PDF gotchas with examples
- Operations runbook (restarting Gotenberg, clearing failed jobs, font cache refresh)

Update `docs/architecture.md` to include Gotenberg in the system diagram.

Update `CLAUDE.md`:
- Add Gotenberg to the stack section
- Add rule to "What NOT to do": "Do NOT generate PDFs directly in app code. All PDFs route through PdfGenerationService → Gotenberg."

## Deliverables

- Custom Gotenberg image building successfully with all 4 Sarabun weights verified
- `PdfGenerationService` working end-to-end
- `council-pack` template rendering correctly with sample Thai content
- Sample PDF showing crisp Thai with no tofu boxes, correct word-wrap, embedded fonts (verify by opening PDF in a system without Sarabun installed — should still render correctly)
- Admin dashboard showing recent generations
- Documentation in `docs/pdf-generation.md`
- 3 suggestions for next session (likely: continue with prompt 03 or 03b)

---

## Note for module prompts (05, 06, 07, 08, 09, 12)

When module prompts say "Export as Council Pack PDF" or similar, they call:

```ts
await pdfGenerationService.renderHtml({
  templateName: 'council-pack',
  data: { ...moduleSpecificData },
  metadata: { title, author: user.nameTh, subject, keywords }
});
```

They do NOT generate PDFs in-process, do NOT use `puppeteer` directly, do NOT use `@react-pdf/renderer`. The `pdf` Claude skill remains useful for design and structure thinking, but actual PDF bytes always come from Gotenberg.
