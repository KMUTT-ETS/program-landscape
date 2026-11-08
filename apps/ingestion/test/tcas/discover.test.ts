import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  BUILT_IN_TCAS_FILES,
  discoverTcasFiles,
  resolveTcasFiles,
} from '../../src/connectors/sources/tcas/files';

const HTML = `
<html><body>
<a href="https://assets.mytcas.com/69/TCAS69-R3-MinMax-10June26.xlsx">69</a>
<a href="https://assets.mytcas.com/68/T68-stat-r3_1-maxmin-20May25.xlsx">68a</a>
<a href="https://assets.mytcas.com/68/T68-stat-r3_2-maxmin-24May25.xlsx">68b</a>
<a href="https://assets.mytcas.com/67/TCAS67_maxmin.xlsx">67</a>
<a href="https://assets.mytcas.com/maxmin/TCAS62_maxmin.xlsx">62</a>
<a href="https://assets.mytcas.com/maxmin/TCAS63_maxmin.xlsx">63</a>
<a href="https://assets.mytcas.com/maxmin/TCAS64_maxmin.xlsx">64</a>
<a href="https://assets.mytcas.com/maxmin/TCAS65_maxmin.xlsx">65</a>
<a href="https://assets.mytcas.com/maxmin/TCAS66_maxmin.xlsx">66</a>
<a href="https://assets.mytcas.com/69/TCAS69-R3-MinMax-10June26.pdf">pdf</a>
<a href="https://assets.mytcas.com/69/TCAS69-R1-portfolio.xlsx">round 1</a>
<a href="https://assets.mytcas.com/69/T69-stat-r2-maxmin.xlsx">round 2</a>
<a href="https://example.org/69/TCAS69-R3-MinMax.xlsx">other host</a>
<a href="https://assets.mytcas.com/69/calendar.xlsx">no marker</a>
</body></html>`;

describe('discoverTcasFiles', () => {
  it('discovers round-3 files and years from the stat page', () => {
    const files = discoverTcasFiles(HTML);
    const by = (y: number) => files.filter((f) => f.entryYearBE === y);
    expect(files).toHaveLength(9);
    expect(by(2569)).toEqual([
      { url: 'https://assets.mytcas.com/69/TCAS69-R3-MinMax-10June26.xlsx', entryYearBE: 2569, round: '3' },
    ]);
    expect(by(2568).map((f) => f.round).sort()).toEqual(['3.1', '3.2']);
    expect(by(2562)).toHaveLength(1);
    expect(by(2567)[0]!.round).toBe('3');
  });

  it('ignores non-round-3 and non-xlsx links', () => {
    const urls = discoverTcasFiles(HTML).map((f) => f.url);
    expect(urls.some((u) => u.endsWith('.pdf'))).toBe(false);
    expect(urls.some((u) => u.includes('R1-portfolio') || u.includes('r2-maxmin'))).toBe(false);
    expect(urls.some((u) => u.startsWith('https://example.org'))).toBe(false);
    expect(urls.some((u) => u.includes('calendar'))).toBe(false);
  });
});

describe('resolveTcasFiles', () => {
  afterEach(() => vi.restoreAllMocks());

  it('built-in list includes TCAS69', () => {
    expect(BUILT_IN_TCAS_FILES.some((f) => f.entryYearBE === 2569)).toBe(true);
  });

  it('merges discovered files with the built-in list without duplicates', async () => {
    const extra = HTML.replace('</body>', '<a href="https://assets.mytcas.com/70/TCAS70-R3-MinMax.xlsx">70</a></body>');
    const f = vi.fn().mockResolvedValue(new Response(extra, { status: 200 }));
    const r = await resolveTcasFiles(f as unknown as typeof fetch);
    expect(r.source).toBe('discovered');
    expect(r.files.some((x) => x.entryYearBE === 2570)).toBe(true);
    expect(new Set(r.files.map((x) => x.url)).size).toBe(r.files.length);
    const ua = (f.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(ua['user-agent']).toMatch(/Mozilla/);
  });

  it('falls back to the built-in list on failure and reports it', async () => {
    const f = vi.fn().mockRejectedValue(new Error('offline'));
    const r = await resolveTcasFiles(f as unknown as typeof fetch);
    expect(r).toEqual({ files: BUILT_IN_TCAS_FILES, source: 'built-in' });
    const bad = vi.fn().mockResolvedValue(new Response('x', { status: 503 }));
    expect((await resolveTcasFiles(bad as unknown as typeof fetch)).source).toBe('built-in');
  });
});
