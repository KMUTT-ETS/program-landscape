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
  path.join(app, 'admin', 'programs', '[id]', 'setup-checklist.tsx'),
  path.join(app, 'programs', 'page.tsx'),
  path.join(app, 'page.tsx'),
  path.join(src, 'components', 'shell', 'role-switcher.tsx'),
  path.join(src, 'components', 'data-source-mark.tsx'),
  path.join(app, 'admin', 'dashboard-data-fetch', 'satisfaction-refresh-bar.tsx'),
  path.join(app, 'admin', 'dashboard-data-fetch', 'research-refresh-bar.tsx'),
  path.join(app, 'admin', 'dashboard-data-fetch', 'student-dq-refresh-bar.tsx'),
];

// Module pages, admin console and shared chrome swept 2026-11-08.
const MODULE_AND_ADMIN_FILES = [
  path.join(app, 'admin', 'application-topology', 'topology-graph.tsx'),
  path.join(app, 'admin', 'dashboard-data-fetch', 'page.tsx'),
  path.join(app, 'admin', 'data-sources', 'page.tsx'),
  path.join(app, 'admin', 'external', 'ai-search', 'client.tsx'),
  path.join(app, 'admin', 'external', 'api-clients', 'client.tsx'),
  path.join(app, 'admin', 'external', 'api-clients', 'page.tsx'),
  path.join(app, 'admin', 'page.tsx'),
  path.join(app, 'admin', 'pdf-review', 'page.tsx'),
  path.join(app, 'admin', 'trend-documents', 'client.tsx'),
  path.join(app, 'admin', 'trend-documents', 'page.tsx'),
  path.join(app, 'admin', 'users', 'client.tsx'),
  path.join(app, 'admin', 'users', 'page.tsx'),
  path.join(app, 'analyst', 'client.tsx'),
  path.join(app, 'analyst', 'dashboards', 'page.tsx'),
  path.join(app, 'analyst', 'page.tsx'),
  path.join(app, 'benchmarking', 'page.tsx'),
  path.join(app, 'benchmarking', 'programs', '[id]', 'page.tsx'),
  path.join(app, 'benchmarking', 'white-spaces', 'page.tsx'),
  path.join(app, 'cockpit', 'page.tsx'),
  path.join(app, 'dashboards', 'executive-landscape', 'chapters', 'market-section.tsx'),
  path.join(app, 'dashboards', 'executive-landscape', 'chapters', 'position-section.tsx'),
  path.join(app, 'dashboards', 'executive-landscape', 'page.tsx'),
  path.join(app, 'education', 'class-offerings', 'client.tsx'),
  path.join(app, 'education', 'digital-competency', 'page.tsx'),
  path.join(app, 'education', 'performance', 'faculty-gpa-trend.tsx'),
  path.join(app, 'education', 'recruitment-campaigns', 'page.tsx'),
  path.join(app, 'education', 'student-dq', 'page.tsx'),
  path.join(app, 'gap-analysis', 'page.tsx'),
  path.join(app, 'gap-analysis', 'row-panels.tsx'),
  path.join(app, 'gap-analysis', 'sections.tsx'),
  path.join(app, 'p', '[slug]', 'layout.tsx'),
  path.join(app, 'p', '[slug]', 'not-found.tsx'),
  path.join(app, 'profile', 'grants-panel.tsx'),
  path.join(app, 'profile', 'scholar-panel.tsx'),
  path.join(app, 'profile', 'teaching-evaluation-panel.tsx'),
  path.join(app, 'risks', '[id]', 'page.tsx'),
  path.join(app, 'risks', 'drivers', 'page.tsx'),
  path.join(app, 'risks', 'portfolio-client.tsx'),
  path.join(app, 'staff', 'grants', 'client.tsx'),
  path.join(app, 'staff', 'grants', 'page.tsx'),
  path.join(app, 'staff', 'page.tsx'),
  path.join(app, 'staff', 'research', 'client.tsx'),
  path.join(app, 'staff', 'research', 'page.tsx'),
  path.join(app, 'staff', 'teaching-workload', 'client.tsx'),
  path.join(app, 'staff', 'workforce', 'client.tsx'),
  path.join(app, 'teaching-learning', '[programId]', 'client.tsx'),
  path.join(app, 'trends', '[id]', 'page.tsx'),
  path.join(app, 'trends', 'page.tsx'),
  path.join(app, 'upload', 'client.tsx'),
  path.join(src, 'components', 'dashboard-chat', 'dashboard-chat-panel.tsx'),
  path.join(src, 'components', 'legal', 'legal-page.tsx'),
  path.join(src, 'lib', 'auth', 'provisioning.ts'),
];

describe('lineHasKkuCopy', () => {
  it('ignores package imports, sso paths and comments', () => {
    expect(lineHasKkuCopy('import { x } from "@kku/db"')).toBe(false);
    expect(lineHasKkuCopy("href='/api/auth/kku-sso/start'")).toBe(false);
    expect(lineHasKkuCopy('// KKU note')).toBe(false);
    expect(lineHasKkuCopy('   * KKU note')).toBe(false);
    expect(lineHasKkuCopy('{/* KKU note */}')).toBe(false);
    expect(lineHasKkuCopy('the registrar KKUMAIL column')).toBe(false);
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

  it('names no specific university on module pages, the admin console and shared chrome', () => {
    expect(assertNoKkuCopy(MODULE_AND_ADMIN_FILES)).toEqual([]);
  });
});
