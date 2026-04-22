# PDF ingestion

Full pipeline built in **prompt 03b** (`pdf-reading` skill).

PDF is a first-class input for this project because most Thai policy,
labor-market, and peer-institution data arrives as PDFs. The pipeline must
handle:

- Native text PDFs (text extraction)
- Scanned PDFs (Thai OCR via Tesseract `tha` model, vision-LLM fallback)
- Mixed PDFs (page-by-page classification)
- Table-heavy PDFs (NSO tables, financial reports)
- Form PDFs (surveys)
- Long PDFs (200+ pages — chunked processing)
- Thai-language PDFs (majority)

Output: structured records routed to the correct domain extractor (policy
doc, peer program, industry report, syllabus).
