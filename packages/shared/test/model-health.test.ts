// packages/shared/test/model-health.test.ts
import { describe, it, expect } from 'vitest';
import { assessModelHealth } from '../src/ai/model-health';

// knownModelIds mirrors the ai_model_catalog TABLE (OpenRouter-refreshed) —
// the same source findCatalogModel() gates pins against. NOT the static
// AVAILABLE_AI_MODELS array, which would mark every production pin off-catalog.
const knownModelIds = new Set(['gemini-3.5-flash', 'gemini-2.5-pro']);
// Deprecation is our own opinion, from the static catalog. OpenRouter has no
// view on what we should stop using.
const deprecatedModels = new Map<string, string | undefined>([
  ['gemini-2.5-pro', 'Retires 2026-12-01.'],
]);

const methods = [
  { methodPrefix: 'program-courses-extract', defaultModel: 'gemini-3.5-flash' },
  { methodPrefix: 'program-digest', defaultModel: 'gemini-3.5-flash' },
];

const base = { knownModelIds, deprecatedModels, methods, recentFailures: [] };

describe('assessModelHealth', () => {
  it('reports ok for an unpinned method on its catalog default', () => {
    const [v] = assessModelHealth({ ...base, overrides: [], methods: [methods[0]] });
    expect(v).toMatchObject({ status: 'ok', effectiveModel: 'gemini-3.5-flash', isPinned: false });
  });

  it('reports off-catalog for a pin that is not in the catalog', () => {
    const [v] = assessModelHealth({
      ...base,
      methods: [methods[0]],
      overrides: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.6-flash' }],
    });
    expect(v.status).toBe('off-catalog');
    expect(v.effectiveModel).toBe('gemini-3.6-flash');
    expect(v.isPinned).toBe(true);
    expect(v.detail).toContain('gemini-3.6-flash');
  });

  it('reports deprecated for a pin flagged in the catalog, and quotes the note', () => {
    const [v] = assessModelHealth({
      ...base,
      methods: [methods[0]],
      overrides: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-2.5-pro' }],
    });
    expect(v.status).toBe('deprecated');
    expect(v.detail).toContain('Retires 2026-12-01.');
  });

  it('reports failing on a single model-invalid failure in the window', () => {
    const [v] = assessModelHealth({
      ...base,
      methods: [methods[0]],
      overrides: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.6-flash' }],
      recentFailures: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.6-flash',
                         count: 1, lastAt: new Date('2026-09-07T08:11:00Z') }],
    });
    expect(v.status).toBe('failing');
  });

  it('ranks failing above off-catalog but still names both — the August incident', () => {
    const [v] = assessModelHealth({
      ...base,
      methods: [methods[0]],
      overrides: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.6-flash' }],
      recentFailures: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.6-flash',
                         count: 4, lastAt: new Date('2026-09-07T08:11:00Z') }],
    });
    expect(v.status).toBe('failing');
    expect(v.detail).toContain('not in the catalog');
  });

  it('ignores failures recorded against a model that is no longer pinned', () => {
    // Operator already fixed the pin; yesterday's failures must not keep it red.
    const [v] = assessModelHealth({
      ...base,
      methods: [methods[0]],
      overrides: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.5-flash' }],
      recentFailures: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.6-flash',
                         count: 9, lastAt: new Date('2026-09-07T08:11:00Z') }],
    });
    expect(v.status).toBe('ok');
  });

  it('returns one verdict per method, in the order given', () => {
    const out = assessModelHealth({ ...base, overrides: [] });
    expect(out.map((v) => v.methodPrefix)).toEqual(['program-courses-extract', 'program-digest']);
  });
});
