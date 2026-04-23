import { describe, expect, it } from 'vitest';
import { extractNativeText } from '../src/pdf-intake/pipeline/native-text-extractor';

// Round-trip test: a minimal hand-crafted PDF with one text string that
// pdfjs-dist must find. Proves that:
//   - pdfjs loads our bytes without a bundler/worker setup
//   - extractText returns the content we wrote in
//   - the scanned heuristic correctly flags this as NOT scanned
//
// When prompt 04 adds real extractor tests against bundled sample PDFs,
// put those fixtures in test/fixtures/ and add a second test here that
// does the full pipeline → approval loop.

function minimalPdfBytes(text: string): Buffer {
  // Minimal valid PDF 1.4 with one page and one text showing "text".
  // Offsets in the xref table are byte-accurate — Buffer.byteLength to
  // compute them so we never drift when text length changes.
  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n');
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
  );
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const stream = `4 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`;
  objects.push(stream);
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  const header = '%PDF-1.4\n%\xC3\xA4\xC3\xBC\xC3\xB6\xC3\x9F\n'; // binary sentinel
  const offsets: number[] = [];
  let body = '';
  let pos = Buffer.byteLength(header);
  for (const obj of objects) {
    offsets.push(pos);
    body += obj;
    pos += Buffer.byteLength(obj);
  }
  const xrefStart = pos;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(header + body + xref + trailer, 'latin1');
}

describe('extractNativeText (round-trip on hand-crafted PDF)', () => {
  it('extracts a known text string from a minimal PDF', async () => {
    const pdf = minimalPdfBytes('Hello KKU from the intake pipeline');
    const result = await extractNativeText(pdf);

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.textContent).toContain('Hello KKU');
    expect(result.fullText).toContain('Hello KKU');
    expect(result.isLikelyScanned).toBe(false);
    expect(result.scannedScore).toBe(0);
  });
});
