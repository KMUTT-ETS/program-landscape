import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_METHOD_CATALOG } from '../src/ai/method-catalog';

/**
 * Every prompt shipped in `src/ai/prompts/` should appear in
 * AI_METHOD_CATALOG. A method absent from the catalog is invisible three
 * times over: it cannot be pinned on /admin/app/ai-settings, assessModelHealth
 * never assesses it (that function iterates the catalog), and the
 * `ai_model_invalid` rows a refused call writes for it are read back and then
 * discarded, because the adapter resolves methodPrefix through the catalog.
 *
 * Four methods were found missing on 2026-09-07 — nothing had ever checked.
 * This test is that check.
 */
const PROMPTS_DIR = join(__dirname, '..', 'src', 'ai', 'prompts');

/**
 * Known gaps, deliberately listed rather than silently tolerated. Removing an
 * entry from here is the whole job of adding the method to the catalog.
 *
 * Empty as of 2026-09-07: every shipped prompt is catalogued. Keep it that way
 * — an entry added here is a method nobody can pin and the health check cannot
 * see, so it needs a reason next to it, not just a name.
 */
const KNOWN_UNCATALOGUED = new Set<string>([]);

function promptVersionPrefixes(): string[] {
  const out = new Set<string>();
  for (const file of readdirSync(PROMPTS_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const src = readFileSync(join(PROMPTS_DIR, file), 'utf8');
    for (const m of src.matchAll(/^export const [A-Z0-9_]*VERSION\s*=\s*'([a-z0-9.-]+)'/gm)) {
      // Strip the trailing .vN / .vN.N exactly as pickModelForMethod does.
      out.add(m[1]!.replace(/\.v\d+(?:\.\d+)*$/, ''));
    }
  }
  return [...out].sort();
}

describe('AI_METHOD_CATALOG coverage', () => {
  const catalogued = new Set(AI_METHOD_CATALOG.map((m) => m.methodPrefix));

  it('has an entry for every shipped prompt, except the documented gaps', () => {
    const missing = promptVersionPrefixes().filter(
      (p) => !catalogued.has(p) && !KNOWN_UNCATALOGUED.has(p),
    );
    expect(missing).toEqual([]);
  });

  it('includes program-research-expertise — phase RE, rendered on the deep-dive', () => {
    expect(catalogued.has('program-research-expertise')).toBe(true);
  });

  it('does not list a known gap that has since been catalogued', () => {
    // Keeps the allowlist honest: adding the method must also shrink this set.
    const stale = [...KNOWN_UNCATALOGUED].filter((p) => catalogued.has(p));
    expect(stale).toEqual([]);
  });

  it('has no duplicate methodPrefix', () => {
    expect(catalogued.size).toBe(AI_METHOD_CATALOG.length);
  });
});
