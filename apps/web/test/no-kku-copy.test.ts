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

const app = path.join(__dirname, '..', 'app');
const src = path.join(__dirname, '..', 'src');
const SIGNIN_AND_ADMIN_FILES = [
  path.join(app, 'signin', 'sign-in-form.tsx'),
  path.join(app, 'signin', 'page.tsx'),
  path.join(app, 'admin', 'data-setup', 'page.tsx'),
  path.join(app, 'admin', 'programs', 'page.tsx'),
  path.join(app, 'programs', 'page.tsx'),
  path.join(app, 'page.tsx'),
  path.join(src, 'components', 'shell', 'role-switcher.tsx'),
  path.join(src, 'components', 'data-source-mark.tsx'),
  path.join(app, 'admin', 'dashboard-data-fetch', 'satisfaction-refresh-bar.tsx'),
  path.join(app, 'admin', 'dashboard-data-fetch', 'research-refresh-bar.tsx'),
  path.join(app, 'admin', 'dashboard-data-fetch', 'student-dq-refresh-bar.tsx'),
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

  it('names no specific university on sign-in, admin and list pages', () => {
    expect(assertNoKkuCopy(SIGNIN_AND_ADMIN_FILES)).toEqual([]);
  });
});
