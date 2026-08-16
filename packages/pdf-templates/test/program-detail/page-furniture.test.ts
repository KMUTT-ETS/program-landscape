import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildDeepDiveFooterHtml,
  buildDeepDiveHeaderHtml,
  type DeepDivePageFurnitureOptions,
} from '../../src/components/deep-dive-page-furniture';

const OPTS: DeepDivePageFurnitureOptions = {
  programCode: 'KKU-SEQ-0065',
  programNameEn: 'Bachelor of Engineering in Computer Engineering',
  confidentialityLabel: 'ลับ — สำหรับการประชุมสภาเท่านั้น',
};

describe('buildDeepDiveHeaderHtml', () => {
  it('returns a complete standalone HTML document', () => {
    const html = buildDeepDiveHeaderHtml(OPTS);
    expect(html.trim().startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html>');
    expect(html).toContain('</html>');
  });

  it('carries the program code, so a photocopied page stays attributable', () => {
    expect(buildDeepDiveHeaderHtml(OPTS)).toContain('KKU-SEQ-0065');
  });

  it('carries the English program name', () => {
    expect(buildDeepDiveHeaderHtml(OPTS)).toContain('Bachelor of Engineering in Computer Engineering');
  });

  it('renders without a confidentiality label just as well (optional field)', () => {
    const { confidentialityLabel: _unused, ...rest } = OPTS;
    expect(() => buildDeepDiveHeaderHtml(rest)).not.toThrow();
  });
});

describe('buildDeepDiveFooterHtml', () => {
  it('returns a complete standalone HTML document', () => {
    const html = buildDeepDiveFooterHtml(OPTS);
    expect(html.trim().startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html>');
    expect(html).toContain('</html>');
  });

  it('carries the pageNumber and totalPages Chromium replacement tokens', () => {
    const html = buildDeepDiveFooterHtml(OPTS);
    expect(html).toContain('<span class="pageNumber">');
    expect(html).toContain('<span class="totalPages">');
  });

  it('carries the confidentiality label when supplied', () => {
    expect(buildDeepDiveFooterHtml(OPTS)).toContain('ลับ — สำหรับการประชุมสภาเท่านั้น');
  });

  it('escapes the label rather than injecting it raw', () => {
    const html = buildDeepDiveFooterHtml({ ...OPTS, confidentialityLabel: 'A & B <C>' });
    expect(html).toContain('A &amp; B &lt;C&gt;');
    expect(html).not.toContain('A & B <C>');
  });
});

describe('font pinning — the Gotenberg image does not have Sarabun installed', () => {
  it('the header pins TH Sarabun New and never falls back to bare Sarabun', () => {
    const html = buildDeepDiveHeaderHtml(OPTS);
    expect(html).toContain("'TH Sarabun New'");
    expect(html).not.toMatch(/'Sarabun'/);
  });

  it('the footer pins TH Sarabun New and never falls back to bare Sarabun', () => {
    const html = buildDeepDiveFooterHtml(OPTS);
    expect(html).toContain("'TH Sarabun New'");
    expect(html).not.toMatch(/'Sarabun'/);
  });
});

describe('module construction — Chromium renders this, not our server', () => {
  it('does not import React anywhere in the source', () => {
    const modulePath = fileURLToPath(
      new URL('../../src/components/deep-dive-page-furniture.ts', import.meta.url),
    );
    const source = readFileSync(modulePath, 'utf-8');
    expect(source).not.toMatch(/from ['"]react/i);
    expect(source).not.toMatch(/require\(['"]react/i);
    expect(source).not.toMatch(/react-dom/i);
  });
});
