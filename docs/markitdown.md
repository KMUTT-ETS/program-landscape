# markitdown — document → Markdown ingestion sidecar

[Microsoft markitdown](https://github.com/microsoft/markitdown) (MIT) converts
**PDF / DOCX / XLSX / PPTX / HTML / CSV** documents into structure-preserving
Markdown for LLM ingestion. It runs as a **Docker sidecar** (Python), called
over HTTP — the same pattern as Gotenberg. The two are complementary: Gotenberg
generates PDFs *out* of app data; markitdown reads documents *in*.

## Why

Before this, the only document extractor was `extractNativeText` (pdfjs) and the
app was effectively **PDF-only** — a manpower-demand report arriving as DOCX/XLSX
couldn't be ingested, and pdfjs flattens tables to positional text. markitdown
unlocks Office formats and preserves table/heading structure, which improves the
AI's extraction quality.

## Architecture

```
ingestion worker ──(bytes + filename, HTTP POST /convert)──▶ markitdown sidecar ──▶ Markdown
        │                                                          (no outbound network of its own)
        └─ on failure / when unwired ─▶ pdfjs (PDF) / HTML-strip fallback
```

- Sidecar: `infra/markitdown/` (`Dockerfile` + `server.py`, a ~40-line FastAPI
  wrapper). Routes: `GET /health`, `POST /convert` (multipart `file`).
- Client: `MarkitdownClient` in `packages/shared/src/markitdown/` (native fetch,
  mirrors `GotenbergClient`).
- The ingestion worker (`apps/ingestion`) produces the document **bytes**
  node-side (MinIO upload, or a guarded URL fetch) and POSTs them, so the
  sidecar needs **no outbound network**.
- Env: `MARKITDOWN_URL`, `MARKITDOWN_REQUEST_TIMEOUT_MS`. When `MARKITDOWN_URL`
  is unset the worker falls back to pdfjs/HTML-strip.
- Readiness: `/api/v1/ready` includes a `markitdown` check, but it is
  **informational only** (optional dep with a fallback) — it never gates API
  traffic.
- Release: `scripts/build-release.ts` builds + ships the image in `images.tar`
  (pip install runs at build time → works on the air-gapped prod server).

## Scope

**Phase 1 (current):** the **trend-document ingest only**
(`/admin/trend-documents` + `pnpm trends:ingest-doc`). Uploads accept PDF / DOCX
/ XLSX / PPTX / HTML / CSV / TXT / MD.

**Phase 2 (deferred):** routing the Council-facing extractors (program digest,
PDF-intake pipeline, program-skills/faculty/pedagogy/courses, IMD rankings)
through markitdown — those depend on pdfjs's per-page `PdfPage` rows + scan
detection and feed Council numbers, so they need an adapter + methodology
re-validation first.

**Not done:** OCR / image text. Like pdfjs, markitdown needs a text layer;
images convert to EXIF/metadata only unless an LLM is wired (deliberately not).

## Local dev

```bash
docker compose build markitdown
docker compose up -d markitdown
curl -fsS localhost:8800/health
curl -F file=@report.docx localhost:8800/convert     # → {"markdown": "...", "title": "..."}
pnpm trends:ingest-doc /path/to/report.docx          # end-to-end → a published signal
```
