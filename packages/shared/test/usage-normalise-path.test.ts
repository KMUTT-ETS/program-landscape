import { describe, expect, it } from 'vitest';
import { normalisePath, USAGE_MODULES } from '../src/usage';

// The recorder sends the raw pathname; the server turns it into a bounded
// route pattern so ids and query strings never make page_views unbounded.

describe('normalisePath', () => {
  it('replaces a cuid segment with [id]', () => {
    expect(normalisePath('/programs/cmtzdam3m0001fd72f65igks4')).toEqual({ path: '/programs/[id]', module: 'deep-dive' });
  });
  it('replaces a KKU-SEQ programme code', () => {
    expect(normalisePath('/programs/KKU-SEQ-0062/print').path).toBe('/programs/[id]/print');
  });
  it('replaces a UUID', () => {
    expect(normalisePath('/decisions/3f2b1c4d-1111-4222-8333-444455556666').path).toBe('/decisions/[id]');
  });
  it('drops the query string and hash, including Thai-encoded values', () => {
    expect(normalisePath('/cockpit?scope=faculty&scopeId=abc&q=%E0%B8%A7%E0%B8%B4#top').path).toBe('/cockpit');
  });
  it('collapses trailing slashes and lower-cases', () => {
    expect(normalisePath('/Gap-Analysis/Opportunities/').path).toBe('/gap-analysis/opportunities');
    expect(normalisePath('/Gap-Analysis/Opportunities/').module).toBe('gap');
  });
  it('maps the home page', () => {
    expect(normalisePath('/')).toEqual({ path: '/', module: 'home' });
  });
  it('maps every known first segment to its module', () => {
    const cases: Array<[string, string]> = [
      ['/cockpit', 'cockpit'], ['/programs/x', 'deep-dive'], ['/gap-analysis', 'gap'],
      ['/benchmarking', 'benchmarking'], ['/scenarios', 'scenarios'], ['/decisions', 'decisions'],
      ['/analyst', 'analyst'], ['/trends', 'trends'], ['/risks', 'risk'], ['/education/recruitment', 'education'],
      ['/staff/workforce', 'staff'], ['/skills', 'skills'], ['/admin/jobthai', 'admin'], ['/docs/methodology', 'docs'],
      ['/changelog', 'docs'], ['/profile', 'profile'], ['/inbox', 'inbox'], ['/teaching-learning', 'teaching-learning'],
      ['/dashboards', 'dashboards'], ['/usage', 'usage'], ['/p/some-slug', 'public-profile'], ['/upload', 'admin'],
      ['/styleguide', 'other'],
    ];
    for (const [input, module] of cases) expect(normalisePath(input).module, input).toBe(module);
  });
  it('caps the pattern length', () => {
    const path = normalisePath('/' + 'a/'.repeat(400)).path;
    expect(path.length).toBeLessThanOrEqual(200);
    expect(path.endsWith('[...]')).toBe(true);
    for (const segment of path.split('/')) {
      expect(segment).toMatch(/^$|^\[\.\.\.\]$|^[a-z0-9[\].-]+$/);
    }
  });
  it('collapses everything that is not a route word', () => {
    expect(normalisePath('/p/aB3_x-Qz9LmK').path).toBe('/p/[id]');
    expect(normalisePath('/programs/123').path).toBe('/programs/[id]');
    expect(normalisePath('/programs/%2Fcmtzdam3m0001fd72f65igks4').path).toBe('/programs/[id]');
    expect(normalisePath('https://evil.example.com/pwn').path.startsWith('/[id]/')).toBe(true);
    // Bounded catalog slugs are kept on purpose.
    expect(normalisePath('/admin/data-sources/kku-registry').path).toBe('/admin/data-sources/kku-registry');
  });
  it('exports the module list the dashboard labels come from', () => {
    expect(USAGE_MODULES).toContain('deep-dive');
    expect(USAGE_MODULES).toContain('other');
  });
});
