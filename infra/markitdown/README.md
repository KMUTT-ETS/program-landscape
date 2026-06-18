# markitdown sidecar

A small HTTP service wrapping [Microsoft markitdown](https://github.com/microsoft/markitdown)
(MIT). It converts **PDF / DOCX / XLSX / PPTX / HTML / CSV** documents into
**structure-preserving Markdown** for LLM ingestion.

It mirrors the [Gotenberg sidecar](../gotenberg/README.md) pattern: a separate
container the **ingestion worker** calls over HTTP, so the Python toolchain
stays out of the Node images. Gotenberg generates PDFs *out* of app data;
markitdown reads documents *in* — opposite directions, complementary tools.

## Routes

| Method | Path       | Body                | Returns |
|--------|------------|---------------------|---------|
| GET    | `/health`  | —                   | `{"status":"ok"}` |
| POST   | `/convert` | multipart `file`    | `{"markdown": "...", "title": "..."}` |

The caller (Node) supplies the document **bytes** (a MinIO upload, or a URL it
fetched itself); this service does no network I/O of its own and needs no
outbound access. A conversion failure returns **422** so the caller falls back
to its legacy pdfjs / HTML-strip path.

## Build / run

```bash
docker compose build markitdown
docker compose up -d markitdown
curl -fsS localhost:8800/health
curl -F file=@report.docx localhost:8800/convert
```

## Scope notes

- **Doc extras only.** The image installs `markitdown[pdf,docx,pptx,xlsx]`, not
  `markitdown[all]`, to avoid pulling the audio-transcription stack
  (torch / whisper). Bump the pin (`~=0.1.0`) deliberately.
- **No OCR.** Like pdfjs, markitdown relies on a text layer; scanned PDFs and
  images yield little/no text without an LLM (deliberately not wired). Images
  convert to EXIF/metadata only. The real new value is DOCX/XLSX/PPTX/HTML +
  preserved table structure.
- **Phase 1 consumer:** the trend-document ingest only. The Council-facing
  extractors (program digest, PDF-intake pipeline, program-*) stay on pdfjs
  until a phase-2 adapter + methodology re-validation lands.
