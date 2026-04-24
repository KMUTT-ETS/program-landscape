// Multer/busboy decodes Content-Disposition `filename="..."` as latin1 by
// default, which mangles UTF-8 filenames (Thai, emoji, any non-ASCII).
// Browsers send raw UTF-8 bytes; we round-trip latin1 → utf8 to recover.
//
// Used at two sites:
//   1. /pdfs/upload — wraps file.originalname on ingress so every NEW
//      upload lands in the DB with a proper UTF-8 filename.
//   2. /admin/pdfs/fix-filenames — one-shot backfill for rows uploaded
//      before the fix shipped.
//
// The trick: only attempt the round-trip when the string's characters
// sit in the latin-1 supplement band (U+0080..U+00FF) — that's what
// busboy's latin1 decode of UTF-8 bytes produces. A proper UTF-8 Thai
// filename has characters in U+0E00..U+0E7F and must be left alone,
// because Buffer.from(s, 'latin1') would silently truncate those code
// points to their low byte and corrupt the string.
export function decodeMultipartFilename(name: string): string {
  if (!name) return name;
  if (!looksLikeMojibake(name)) return name;
  try {
    const roundTripped = Buffer.from(name, 'latin1').toString('utf8');
    if (roundTripped.includes('�')) return name;
    return roundTripped;
  } catch {
    return name;
  }
}

// True when `name` is likely latin1-mis-decoded UTF-8. Rules:
//   - skip pure ASCII (nothing to fix)
//   - skip anything that already contains a non-latin-1 code point
//     (Thai / CJK / emoji → already proper UTF-8)
//   - otherwise, check that EVERY non-ASCII char is in the latin-1
//     supplement range and that at least one byte-pair starts with
//     0xC2..0xF4 (UTF-8 multi-byte lead signature viewed as latin-1).
export function looksLikeMojibake(name: string): boolean {
  if (!name) return false;
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(name)) return false;
  // Any codepoint outside latin-1 supplement → already real UTF-8.
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xff) return false;
  }
  // Require a UTF-8-lead signature: 0xC2..0xDF (2-byte), 0xE0..0xEF
  // (3-byte incl. Thai), or 0xF0..0xF4 (4-byte, e.g. emoji).
  // eslint-disable-next-line no-control-regex
  return /[\xC2-\xF4][\x80-\xBF]/.test(name);
}
