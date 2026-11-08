import { describe, it, expect } from 'vitest';
import { kkuLinkageConfigured } from '../src/lib/kku-linkage-config';

const full: NodeJS.ProcessEnv = {
  KKU_REGISTRY_DB_HOST: 'h',
  KKU_REGISTRY_DB_PORT: '1521',
  KKU_REGISTRY_DB_SERVICE: 's',
  KKU_REGISTRY_DB_USER: 'u',
  KKU_REGISTRY_DB_PASSWORD: 'p',
  KKU_HR_DB_HOST: 'h',
  KKU_HR_DB_PORT: '1433',
  KKU_HR_DB_DATABASE: 'd',
  KKU_HR_DB_USER: 'u',
  KKU_HR_DB_PASSWORD: 'p',
};

describe('kkuLinkageConfigured', () => {
  it('reports every key missing for an empty env', () => {
    const r = kkuLinkageConfigured({});
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(Object.keys(full).length);
    expect(r.missing).toEqual(expect.arrayContaining(Object.keys(full)));
  });
  it('treats REPLACE_ME and blank values as missing', () => {
    const r = kkuLinkageConfigured({ ...full, KKU_HR_DB_PASSWORD: 'REPLACE_ME', KKU_REGISTRY_DB_USER: '  ' });
    expect(r.ok).toBe(false);
    expect(r.missing.sort()).toEqual(['KKU_HR_DB_PASSWORD', 'KKU_REGISTRY_DB_USER']);
  });
  it('is ok when everything is set', () => {
    expect(kkuLinkageConfigured(full)).toEqual({ ok: true, missing: [] });
  });
});
