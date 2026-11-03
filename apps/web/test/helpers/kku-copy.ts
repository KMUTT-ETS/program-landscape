import { readFileSync } from 'node:fs';

export interface KkuCopyHit {
  file: string;
  line: number;
  text: string;
}

const KKU_PATTERN = /KKU|มข\.|Khon Kaen|ขอนแก่น/;
const ALLOWLIST = ['@kku/', 'kku-sso', 'KKU_', 'kkuExample', 'KKU-SEQ-'];
const COMMENT_START = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

/** True when a single source line carries KKU copy a user could see. */
export function lineHasKkuCopy(line: string): boolean {
  if (COMMENT_START.test(line)) return false;
  if (!KKU_PATTERN.test(line)) return false;
  // Strip allowlisted tokens, then re-test what is left.
  let rest = line;
  for (const token of ALLOWLIST) rest = rest.split(token).join('');
  return KKU_PATTERN.test(rest);
}

/** Lines in the given files that name KKU outside comments and the allowlist. */
export function assertNoKkuCopy(files: readonly string[]): KkuCopyHit[] {
  const hits: KkuCopyHit[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        if (lineHasKkuCopy(text)) hits.push({ file, line: i + 1, text: text.trim() });
      });
  }
  return hits;
}
