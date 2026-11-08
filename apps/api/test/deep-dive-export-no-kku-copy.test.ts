// Guards the deep-dive export path (api builder + PDF template) against KKU
// copy a user of another university would see. Same logic as
// apps/web/test/helpers/kku-copy.ts, copied because this package cannot
// import from apps/web.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const KKU_PATTERN = /KKU|มข\.|Khon Kaen|ขอนแก่น/;
const ALLOWLIST = ['@kku/', 'kku-sso', 'KKU_', 'kkuExample', 'KKU-SEQ-'];
// Provenance SOURCE names: accurate names of the KKU systems that fed a
// figure; they appear only when that source did.
const SOURCE_NAME_ALLOWLIST = [
  'kku-research (KKU Publications mirror)',
  'KKU Registrar (Oracle)',
  'KKU Publications mirror',
];
const COMMENT_START = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

function lineHasKkuCopy(line: string): boolean {
  if (COMMENT_START.test(line)) return false;
  if (!KKU_PATTERN.test(line)) return false;
  let rest = line;
  for (const token of [...ALLOWLIST, ...SOURCE_NAME_ALLOWLIST]) rest = rest.split(token).join('');
  return KKU_PATTERN.test(rest);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

const root = path.resolve(__dirname, '..', '..', '..');
const files = [
  path.join(root, 'apps', 'api', 'src', 'programs', 'program-detail-data.ts'),
  ...walk(path.join(root, 'packages', 'pdf-templates', 'src', 'templates', 'program-detail')),
];

describe('deep-dive export path carries no KKU copy', () => {
  it('scans the builder and every program-detail template file', () => {
    expect(files.length).toBeGreaterThan(5);
  });
  it('has no KKU-naming line outside comments and the explicit allowlist', () => {
    const hits = files.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((text, i) => ({ f: path.relative(root, f), line: i + 1, text: text.trim() }))
        .filter((h) => lineHasKkuCopy(h.text)),
    );
    expect(hits).toEqual([]);
  });
});
