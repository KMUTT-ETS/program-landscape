import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_SOURCE_MARKS } from '../src/components/data-source-mark';
import { ACKNOWLEDGEMENTS } from '../app/docs/acknowledgements/registry';

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('staff grants dashboard', () => {
  it('has a hub tile', () => {
    expect(read('app/staff/page.tsx')).toContain("href: '/staff/grants'");
  });

  it('marks the source and acknowledges it', () => {
    expect(Object.keys(DATA_SOURCE_MARKS)).toContain('kku-research-services');
    expect(ACKNOWLEDGEMENTS.some((a) => a.slug === 'kku-research-services')).toBe(true);
  });

  it('every chart block carries provenance and freshness, and the page says faculty counts overlap', () => {
    const src = read('app/staff/grants/client.tsx');
    expect((src.match(/<ProvenanceButton/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(src).toContain('<FreshnessBadge');
    expect(src).toContain('<DataSourceMark source="kku-research-services"');
    expect(src).toContain('add up to more than the KKU total');
  });
});
