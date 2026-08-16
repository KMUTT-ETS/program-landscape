import { describe, expect, it } from 'vitest';
import { magazineCss } from '../../src/styles/magazine-css';

describe('magazineCss', () => {
  it('defines the chart lede rule that ChartFrame expects', () => {
    expect(magazineCss).toContain('.chart-lede');
  });

  it('keeps the Cabinet 16pt body size — it must not override base-css', () => {
    expect(magazineCss).not.toMatch(/body\s*{[^}]*font-size/);
  });

  it('numbers sections and appendix entries via counters, not hardcoded strings', () => {
    expect(magazineCss).toContain('counter-reset');
    expect(magazineCss).toContain('counter-increment');
  });

  it('keeps a section opener with its first paragraph', () => {
    expect(magazineCss).toContain('break-after: avoid');
  });

  it('defines the section opener, appendix table, pull-quote and stat-block rules', () => {
    expect(magazineCss).toContain('.section-opener');
    expect(magazineCss).toContain('.appendix-table');
    expect(magazineCss).toContain('.pull-quote');
    expect(magazineCss).toContain('.stat-block');
  });

  it('sets the section-opener numeral in KKU cardinal, not a generic accent grey', () => {
    // #9c1d2e is the same value base-css.ts's `.accent` class and
    // palette.ts's PRINT_PALETTE[1] use — this file hand-mirrors it
    // rather than referencing a token, per the PDF-CSS convention.
    expect(magazineCss).toMatch(/\.section-opener[^{]*{[^}]*#9c1d2e/i);
  });

  it('does not restate rules base-css.ts already owns (.chart-frame .chart-title/.chart-caption)', () => {
    expect(magazineCss).not.toContain('.chart-title');
    expect(magazineCss).not.toContain('.chart-caption');
  });

  it('gives the appendix table tabular numerals at 14pt, matching the current template', () => {
    expect(magazineCss).toMatch(/\.appendix-table[^{]*{[^}]*font-size:\s*14pt/);
    expect(magazineCss).toContain('font-variant-numeric: tabular-nums');
  });
});
