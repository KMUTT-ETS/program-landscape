# PDF intake pipeline

The primary external-data input mechanism. Most KKU-relevant external
data arrives as PDFs — MHESI/NESDC/NXPO/BOI policies, NSO labor
surveys, peer-university brochures, committee minutes, มคอ.2 curriculum
docs. This pipeline is how those documents become structured rows in
our domain tables.

## Architecture

```
PDF arrives (upload OR connector-fetched)
  │
  ▼
┌────────────────────────────────────────────────────────────┐
│ apps/api  POST /pdfs/upload  (or PDF connector load())     │
│   - content-hash dedup (unique PdfDocument.contentHash)    │
│   - PUT bytes to MinIO pdf-raw bucket                      │
│   - create PdfDocument(PENDING)                            │
│   - enqueue BullMQ job on `pdf-intake`                     │
└────────────────────────────────────────────────────────────┘
  │
  ▼
┌────────────────────────────────────────────────────────────┐
│ apps/ingestion  pdf-intake worker                          │
│                                                            │
│   findUnique → update(PROCESSING)                          │
│   pdfjs-dist  native text extraction                       │
│     │                                                      │
│     ├─ per-page PdfPage rows (text, hasImages, hasTables)  │
│     │                                                      │
│     └─ scanned? → park in PROCESSING with "awaiting OCR"   │
│                   (prompt 04 wires vision-LLM path)        │
│                                                            │
│   classifier.classify(ctx) → ClassificationResult          │
│     (stub today; prompt 04 wires real LLM)                 │
│                                                            │
│   extractorsFor(category).extract(ctx) → ExtractionRecord[]│
│     (7 stub extractors; prompt 04 fills bodies)            │
│                                                            │
│   per-record: confidence-threshold → PdfExtraction with    │
│     reviewStatus = PENDING_REVIEW or AUTO_APPROVED         │
│                                                            │
│   update PdfDocument(COMPLETED) + classificationConfidence │
└────────────────────────────────────────────────────────────┘
  │
  ▼
┌────────────────────────────────────────────────────────────┐
│ admin/pdf-review                                           │
│   - left pane: react-pdf viewer w/ page nav                │
│   - right pane: extractions, confidence, editable payload  │
│   - Approve / Reject / Re-extract per row                  │
│   - audit log + revision history                           │
└────────────────────────────────────────────────────────────┘
```

## What's built vs. stubbed today

Prompt 03b built the plumbing. LLM-powered steps land with **prompt 04**
(Skills & AI) which introduces the AI service abstraction.

| Stage | Status | Notes |
|---|---|---|
| Upload to MinIO | **Real** | Dedup by content hash |
| Native text extraction (pdfjs-dist) | **Real** | Per-page text + image detection; scan heuristic |
| OCR for scanned PDFs | **Stubbed** | Scanned docs park in PROCESSING with "awaiting OCR"; prompt 04 wires Claude vision |
| Classification | **Stubbed** | Returns OTHER (confidence 0) or honours uploader's hint (confidence 0.5). Every PDF currently lands in review queue. |
| Domain extractors (all 7) | **Stubbed** | Each returns an empty-payload extraction record at confidence 0 |
| Review queue routing | **Real** | Based on actual confidence values — will route automatically as soon as prompt 04 wires real extractors |
| Re-extraction | **Real** | Preserves audit trail (deletes only same methodVersion, keeps historical rows) |
| Bulk reprocessing | **Real (API only)** | UI action deferred; endpoint exists (`POST /pdfs/bulk-reprocess`) |
| Entity linking (skills/programs) | **Deferred to 04** | Vector similarity over embeddings |
| Trend signal generation | **Deferred to 04** | Policy doc impact scoring |
| Table extraction (Camelot/tabula) | **Deferred to 04** | Architectural call: Python subprocess vs vision LLM |

## Storage

- **Bucket:** `MINIO_BUCKET_PDF_RAW` (default `pdf-raw`)
- **Key pattern:** `<category>/<contentHash>.pdf` — stable, dedup-friendly
- **Dedup:** `PdfDocument.contentHash` is UNIQUE. Uploading the same bytes
  returns the existing row. Same-content, different-filename PDFs collapse.
- **Retention:** indefinite by default — PDFs are evidence. Admin bulk
  delete lands with a later prompt.

## State machine

`PdfDocument.processingStatus`:

```
    upload / connector PUT
          │
          ▼
       PENDING ────── worker dequeues ──▶ PROCESSING
                                              │
           ┌──────────────────────────────────┤
           │                                  │
           ▼                                  ▼
        PROCESSING                        COMPLETED
        (scanned —                    (text + extractions
         awaiting OCR)                 written)
                                          │
                                    re-extract admin action
                                          │
                                          ▼
                                       PENDING
```

`PdfExtraction.reviewStatus`:

```
    extractor produces row
          │
  ┌───────┴───────┐
  │               │
  ▼               ▼
AUTO_APPROVED   PENDING_REVIEW
                      │
              admin approves / rejects / edits
                      │
              ┌───────┴───────┐
              ▼               ▼
           APPROVED        REJECTED
```

## Confidence thresholds

Tuned via env; defaults in `packages/shared/src/pdf-intake/types.ts`:

| Variable | Default | Meaning |
|---|---|---|
| `PDF_INTAKE_CLASSIFIER_THRESHOLD` | 0.7 | Classification confidence needed to auto-approve downstream extractions |
| `PDF_INTAKE_EXTRACTOR_THRESHOLD` | 0.8 | Per-extraction confidence needed for AUTO_APPROVED (else PENDING_REVIEW) |

Auto-approve requires BOTH — extraction confidence >= extractor threshold
AND classifier confidence >= classifier threshold. Both-high is the safe
bar; if either is shaky, a human reviews.

## Adding a new extractor

1. **Decide the extraction type** — pick or add a `PdfExtractionType`
   enum value in `packages/db/prisma/schema.prisma`.
2. **Define the payload schema** in
   `packages/shared/src/pdf-intake/payload-schemas.ts`.
3. **Write the extractor class** in
   `apps/ingestion/src/pdf-intake/extractors/` extending the stub pattern.
   Implement `extract(ctx)`; return zero-or-more `ExtractionRecord`.
4. **Register** in `apps/ingestion/src/pdf-intake/extractors/stub-extractors.ts`
   (or move to a real extractor module once prompt 04 lands the AI service).
5. **Bump `methodVersion`** whenever the extractor's behaviour meaningfully
   changes — historical PdfExtraction rows stay, so reviewers can audit
   the shift.

## Operator guide

### Upload flow (hand-driven)

1. Navigate to `/upload` (ANALYST / DEAN / DEPT_HEAD / ADMIN).
2. Drop PDFs — or use the file picker.
3. Optionally set category/source/language hints (batch-wide).
4. Click Upload; watch per-file progress.
5. When done, click "Go to review queue" or wait for the worker to finish.

### Re-extraction after a method change

If prompt 04's v2 policy extractor improves, operators can force existing
PDFs through the new version:

```bash
# Single PDF
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/v1/pdfs/$PDF_ID/re-extract

# Bulk (by category)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sourceCategory":"POLICY","limit":100}' \
  http://localhost:4000/api/v1/pdfs/bulk-reprocess
```

Historical PdfExtraction rows stay visible in the review UI with their
original methodVersion — never silently overwritten.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| PdfDocument stuck in PENDING | Worker not running | `pnpm --filter ingestion start:dev` |
| PdfDocument stuck in PROCESSING (w/ "awaiting OCR") | Scanned PDF — OCR not yet wired | Blocked on prompt 04; parking is intentional |
| Upload returns `deduplicated: true` | Same content already ingested | Behave-as-intended; original row reused |
| Every PDF lands in review queue | Stub classifier returns confidence 0 | Expected pre-prompt-04 — real classifier lifts auto-approval |
| Re-extract doesn't re-run old extractor | Method version bumped — old rows kept | Use `POST /pdfs/bulk-reprocess` to regenerate with new version |
| Worker OOMs on 200+ page PDF | Chunking not wired | Deferred to prompt 04 — for now, split the PDF externally |

## Tests

- `apps/ingestion/test/pdf-intake.test.ts` — pipeline state transitions,
  classifier/extractor routing, scanned-pdf parking, confidence threshold
  behaviour
- `apps/ingestion/test/native-extraction.test.ts` — round-trip on a
  hand-crafted minimal PDF through pdfjs-dist
- `apps/ingestion/test/connector-lifecycle.test.ts` — PDF connector →
  PdfDocument(PENDING) (mocked MinIO)

Sample PDFs for end-to-end validation land with prompt 04 once real
extractors can say anything meaningful about their contents.
