export function extractSubjectSignature(programmeName: string): string {
  const inParens = programmeName.match(/\(([^)]+)\)/);
  if (inParens) return normaliseSubjectKey(inParens[1]!);
  const withSakha = programmeName.match(/สาขาวิชา\s*([^\s,()/]+(?:\s+[^\s,()/]+)?)/);
  if (withSakha) return normaliseSubjectKey(withSakha[1]!);
  return normaliseSubjectKey(programmeName);
}

// Normalise a Thai discipline key for cross-row equality. Strips
// degree-name suffixes (บัณฑิต / มหาบัณฑิต / ดุษฎีบัณฑิต), the
// "หลักสูตร"/"สาขาวิชา" prefix words, and the mai-thanthakhat (์) silent
// mark — so "แพทยศาสตรบัณฑิต" and "แพทยศาสตร์" both collapse to
// "แพทยศาสตร". Necessary because the new TCAS funnel doesn't carry the
// peer institutions' programmeName format; we resolve via Program.nameTh
// which often has the degree-only form.
function normaliseSubjectKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^(หลักสูตร|สาขาวิชา)\s*/g, '')
    .replace(/(ดุษฎีบัณฑิต|มหาบัณฑิต|บัณฑิต)$/g, '')
    .replace(/์/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
