# Prompt 03b — PDF Intake Pipeline (Primary Data Input Mechanism)

> **When to use:** After ingestion framework. PDFs are how most external data arrives in Thailand — this is a first-class feature, not an afterthought.
>
> **Skills to invoke this session (critical):**
> - `pdf-reading` — for PDF intake strategy
> - `frontend-design` — for the upload + review UI

---

Before starting, please read and apply:
- `/mnt/skills/public/pdf-reading/SKILL.md`
- `/mnt/skills/public/frontend-design/SKILL.md`

Read `CLAUDE.md`, `GLOBAL-UPDATES.md`, and `docs/data-sources.md`.

---

Build the PDF intake pipeline. This is the primary mechanism for getting external data (policy docs, reports, surveys, peer brochures, NSO statistics) into the system.

### Pipeline architecture

```
PDF arrives (upload OR connector-fetched)
  ↓
1. Storage & dedup (content hash)
  ↓
2. Classification (what kind of PDF is this?)
  ↓
3. Text extraction (native vs OCR)
  ↓
4. Structure detection (pages, tables, sections, headings)
  ↓
5. Domain extraction (route to specialized extractors)
  ↓
6. Confidence-based routing (auto-approve vs review queue)
  ↓
7. Linkage (associate with programs, skills, etc.)
  ↓
8. Trend signal generation if applicable
```

### 1. Storage layer
- Store original PDFs in S3-compatible storage (use MinIO in docker-compose for local dev)
- `PdfDocument` row with `storageUrl`, `contentHash`, `pageCount`, `fileSize`, etc.
- Dedup by content hash — uploading the same PDF twice returns the existing record
- Configurable retention (default: keep originals indefinitely, since they're evidence)

### 2. Classification
- LLM-based classification of incoming PDFs into `sourceCategory`:
  - POLICY (MHESI, NESDC, NXPO, BOI, EECO documents)
  - REPORT (statistical reports, sectoral analyses, annual reports)
  - CURRICULUM (มคอ.2, มคอ.3 documents)
  - PEER_PROGRAM (peer university brochures, program descriptions)
  - SURVEY (alumni surveys, employer feedback, employer surveys)
  - COMMITTEE_MINUTES (KKU internal)
  - JOB_POSTINGS_BATCH (rare but happens)
  - OTHER
- Also classifies: language (TH/EN/MIXED), publisher org, document date if extractable

### 3. Text extraction
- **Native text PDFs:** `pdf-parse` or `pdfjs-dist` for text extraction; preserves page structure
- **Scanned PDFs:** OCR pipeline:
  - Detect if scanned (low text-to-image ratio)
  - Use Tesseract with `tha+eng` models for OCR
  - Or fall back to Claude vision API for tough cases (Thai handwriting in margins, complex layouts)
  - Store OCR confidence per page
- **Mixed PDFs:** detect per-page and apply appropriate method
- Output: per-page text in `PdfPage` table

### 4. Structure detection
- Identify: headings, sections, footnotes, tables, figures
- Extract tables into structured form (headers + rows) → `PdfTable` rows
- Use `tabula-py` or Camelot for native table extraction; fall back to LLM vision for complex tables
- Particularly important for NSO statistical tables (which are dense, multi-header, often in Thai)

### 5. Domain extractors (specialized per category)

Each is an LLM-powered structured extractor with Zod validation:

- **`PolicyDocExtractor`** → produces `PolicyDocument` row with summary (TH + EN), publication date, issuing org, key directives, mentioned sectors, mentioned skills
- **`StatisticalReportExtractor`** → extracts tables and stores key metrics (e.g., labor force participation by region) into structured tables
- **`CurriculumExtractor`** → extracts course structure from มคอ.2; populates `Curriculum`, `Course`, `CurriculumCourse`; flags new programs/courses for admin review
- **`PeerProgramExtractor`** → produces `PeerProgram` row with normalized description, level, credits, distinctive features
- **`SurveyExtractor`** → extracts open-ended responses, themes, ratings; routes to `EmployerFeedback` or `GraduateOutcome`
- **`CommitteeMinutesExtractor`** → extracts decisions, action items, attendees; can link to `CouncilDecision` if applicable
- **`JobPostingsBatchExtractor`** → extracts individual job postings into `JobPosting` rows

All extractors:
- Use the AI service abstraction (built in prompt 04)
- Log every call to `AiInference`
- Output `PdfExtraction` rows with confidence + method version + reasoning
- Below threshold → `PENDING_REVIEW`; above → `AUTO_APPROVED`

### 6. Confidence-based routing & review queue

Build `/admin/pdf-review` (ADMIN/ANALYST):

Top-level: queue of pending PDFs grouped by category.

Per-PDF review interface (modern split-pane SaaS layout):
- **Left:** PDF viewer (use `react-pdf` or `pdf.js`) with page navigation, search, zoom
- **Right:** extracted structured data, editable, with confidence indicators
- Top bar: classification (editable), language detected, source org (editable)
- Bottom: actions — Approve, Edit & Approve, Reject (with reason), Re-extract, Mark for re-OCR
- Side rail: extraction history, related PDFs, suggested links to existing entities (programs, skills)

Use shadcn components from prompt 02b. Polished, fast, keyboard-friendly.

### 7. Linkage to internal entities
- After extraction, run linking pass:
  - Map mentioned skills → `Skill` IDs (vector similarity over embeddings)
  - Map mentioned programs → `Program` IDs (fuzzy match on name)
  - Map mentioned faculties/departments → org records
- Store linkages on the source row; expose in admin UI for correction

### 8. Trend signal generation
- Policy docs and reports above impact threshold automatically generate `TrendSignal` rows
- Trend signal generation uses the AI service to score impact (low/medium/high) with reasoning

### Upload UI

Build `/upload` (ANALYST/ADMIN):
- Drag-and-drop multi-file upload
- Per-file progress with steps shown (uploading → classifying → extracting → reviewing)
- Bulk upload of zipped folders
- Optional metadata: source org override, category override, notes
- After upload: shows where each PDF landed in the review queue

### Bulk reprocessing
- Admin action: "Re-extract all PDFs in category X with new method version" — useful when extractors improve
- Maintains version history of extractions; never silently overwrites approved data

### Performance & scale
- Worker pool sized to host capacity
- Large PDFs (>50 pages) chunk-processed
- Page-level extraction parallelized
- Progress visible to uploader in real-time (websocket or polling)

### Connector integration
- Connectors marked `inputFormat: 'PDF'` (from prompt 03) push fetched PDFs through this pipeline
- E.g., the `MhesiPolicyConnector` polls MHESI website, downloads new PDF announcements, registers them in `PdfDocument`, lets pipeline handle extraction
- Connector decides initial classification hint; pipeline can override

### Tests
- Test extraction on sample PDFs (include in repo: a sample policy doc, a sample curriculum, a sample report with tables, a sample scanned doc)
- Test dedup: same PDF uploaded twice produces one record
- Test classification accuracy on a small labeled set
- Test review queue routing: low-confidence extractions reach the queue
- Test that approved extractions populate downstream entities
- Test linking accuracy on sample policy doc → known programs

### Documentation
Update `docs/pdf-ingestion.md`:
- Architecture diagram
- Per-extractor capabilities and limitations
- Confidence thresholds and how to tune them
- Common failure modes and recovery
- How to add a new extractor for a new document type

### Deliverables
- Working upload UI
- Working review queue
- 5 sample PDFs processed end-to-end (mix of policy, curriculum, report, peer brochure, scanned)
- Extraction accuracy report on the samples
- 3 suggestions for next session — my plan is skills + AI extraction (prompt 04)
