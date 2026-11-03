import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { assertNoKkuCopy, lineHasKkuCopy } from './helpers/kku-copy';

const root = path.join(__dirname, '..', 'app', 'programs', '[id]');
const DEEP_DIVE_FILES = [
  path.join(root, 'page.tsx'),
  path.join(root, 'client.tsx'),
  path.join(root, 'overlap-section.tsx'),
  path.join(root, 'print', 'page.tsx'),
];

describe('lineHasKkuCopy', () => {
  it('ignores package imports, sso paths and comments', () => {
    expect(lineHasKkuCopy('import { x } from "@kku/db"')).toBe(false);
    expect(lineHasKkuCopy("href='/api/auth/kku-sso/start'")).toBe(false);
    expect(lineHasKkuCopy('// KKU note')).toBe(false);
    expect(lineHasKkuCopy('   * KKU note')).toBe(false);
    expect(lineHasKkuCopy('{/* KKU note */}')).toBe(false);
  });
  it('flags rendered KKU text', () => {
    expect(lineHasKkuCopy('<span>KKU</span>')).toBe(true);
    expect(lineHasKkuCopy('<span>มข.</span>')).toBe(true);
    expect(lineHasKkuCopy('<span>Khon Kaen</span>')).toBe(true);
  });
});

describe('deep-dive copy', () => {
  it('names no specific university', () => {
    expect(assertNoKkuCopy(DEEP_DIVE_FILES)).toEqual([]);
  });
});
