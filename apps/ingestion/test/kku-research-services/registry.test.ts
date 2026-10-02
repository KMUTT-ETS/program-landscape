import { describe, expect, it } from 'vitest';
import { getCatalogEntry } from '@kku/shared';
import { KkuResearchServicesRealConnector } from '../../src/connectors/sources/kku-research-services';

describe('kku-research-services wiring', () => {
  it('is a real, daily catalog source', () => {
    const e = getCatalogEntry('kku-research-services');
    expect(e).toBeDefined();
    expect(e!.mocked).toBe(false);
    expect(e!.cadenceCron).toBe('0 4 * * *');
  });

  it('the real connector carries the catalog slug', () => {
    const c = new KkuResearchServicesRealConnector();
    expect(c.slug).toBe('kku-research-services');
    expect(c.mocked).toBe(false);
  });
});
