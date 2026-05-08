import type { PdfPageText } from '@kku/shared';

// Native-text extraction via pdfjs-dist. Works on any PDF that has real
// text layers (i.e., not a pure scan). Produces per-page text and a
// scanned heuristic.
//
// Why pdfjs-dist and not pdf-parse:
//   - pdfjs-dist exposes per-page operators, which lets us detect
//     images vs text (the hasImages flag we care about for the "is this
//     a scanned doc" decision).
//   - It's already in the browser bundle (the review UI's react-pdf
//     viewer uses it), so tree-shaking overhead is low.
//
// Limitations:
//   - No table detection — tables come through as text with some loss
//     of column structure. Prompt 04 will add real table extraction
//     (LLM vision or Camelot, pending that architectural call).
//   - Scanned pages return undefined textContent + hasImages=true. The
//     pipeline marks them so the OCR step (prompt 04 wires Claude
//     vision) can pick them up.

export interface NativeExtractionResult {
  pages: PdfPageText[];
  fullText: string;
  isLikelyScanned: boolean;
  // Heuristic score 0..1: fraction of pages that look like pure images
  // (very little extractable text, image operators present). > 0.5
  // flips isLikelyScanned.
  scannedScore: number;
}

export async function extractNativeText(buffer: Buffer): Promise<NativeExtractionResult> {
  // Lazy-load pdfjs to keep its WASM/canvas footprint out of cold paths
  // that don't parse (e.g. a worker boot that never sees a PENDING doc).
  // pdfjs-dist's ESM legacy build is what works cleanly from Node — the
  // "standard" build pulls in DOM globals.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // In Node we run the worker on the main thread. pdfjs 4.x still
  // requires workerSrc to be set to _something_ or it throws at
  // document load — set it to the worker module path (it won't actually
  // spawn a worker in Node, just uses the code from the main thread).
  pdfjs.GlobalWorkerOptions.workerSrc =
    require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

  // pdfjs wants a Uint8Array, not a Node Buffer.
  const data = new Uint8Array(buffer);
  // verbosity: ERRORS (0) silences the cosmetic font-related warnings
  // that pdfjs emits on most real-world Thai curricula:
  //   - "Ensure that the standardFontDataUrl API parameter is provided"
  //   - "TT: undefined function: 32"  (TrueType opcode in embedded fonts)
  //   - "Unable to load font data at: ..."
  // These do NOT affect text extraction — pdfjs falls back to its glyph
  // tables and getTextContent() still returns clean strings. We tried
  // pointing standardFontDataUrl/cMapUrl at the on-disk pdfjs package
  // dir, but pdfjs's internal fetcher doesn't support file:// URLs in
  // Node (would need a custom fetcher or HTTP server for the assets).
  // Suppressing the warnings is the pragmatic call — operators were
  // mis-reading them as errors and pausing the bulk digest runs.
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;

  const pages: PdfPageText[] = [];
  let fullText = '';
  let scannedPages = 0;

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => {
        // TextItem has `str`; MarkedContent doesn't — filter.
        if ('str' in item && typeof item.str === 'string') return item.str;
        return '';
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Detect images via the page's operator list. A page whose operator
    // list is dominated by paintImageXObject and has almost no text is
    // almost certainly a scan.
    const ops = await page.getOperatorList();
    const opNames = new Set(Object.entries(pdfjs.OPS).map(([name]) => name));
    let imageOpCount = 0;
    for (const op of ops.fnArray) {
      // pdfjs.OPS.paintImageXObject is a numeric op code; we compare
      // numerically. 85 is the historical value but not stable across
      // minor versions — use the name lookup.
      const opName = findOpName(pdfjs.OPS, op);
      if (opName && opName.startsWith('paintImage')) imageOpCount++;
    }
    const hasImages = imageOpCount > 0;
    // Heuristic: very short text + at least one image operator → scanned.
    const likelyScanned = text.length < 40 && hasImages;
    if (likelyScanned) scannedPages++;

    pages.push({
      pageNumber,
      textContent: text.length > 0 ? text : undefined,
      hasImages,
      // hasTables is left false — native detection isn't reliable; the
      // LLM-driven extractor in prompt 04 sets it after seeing the page.
      hasTables: false,
    });
    if (text.length > 0) {
      fullText += text + '\n\n';
    }
    // Silence a lint warning about `opNames` being unused in the stripped
    // version of this extractor. The lookup is future-proofing for when
    // pdfjs's OPS reshuffle.
    void opNames;
  }

  await doc.cleanup();
  const scannedScore = doc.numPages === 0 ? 0 : scannedPages / doc.numPages;

  return {
    pages,
    fullText: fullText.trim(),
    isLikelyScanned: scannedScore > 0.5,
    scannedScore,
  };
}

function findOpName(ops: Record<string, number>, code: number): string | undefined {
  for (const [name, value] of Object.entries(ops)) {
    if (value === code) return name;
  }
  return undefined;
}
