// The Deep-Dive data map in the docs site is a hand-written copy of two code
// lists: the drivers per health dimension and the checklist sources per driver
// and section. This test fails when either list changes and the doc does not.
import { describe, expect, it } from 'vitest';
import { DIMENSION_DRIVERS, HEALTH_DIMENSIONS } from '../src/health-score';
import { CHECKLIST_SOURCES } from '../src/program-setup-checklist';
import {
  MAP_DIMENSIONS,
  MAP_DRIVERS,
  MAP_INPUTS,
  MAP_SECTIONS,
} from '../../../apps/docs-site/.vitepress/theme/deep-dive-data-map/data';

const FILE = 'apps/docs-site/.vitepress/theme/deep-dive-data-map/data.ts';

const inputBySource = new Map<string, string>();
for (const input of MAP_INPUTS) for (const s of input.sources) inputBySource.set(s, input.id);

/** The doc input ids CHECKLIST_SOURCES names for a key, as a sorted list. */
function checklistInputs(key: string): string[] {
  const ids = new Set<string>();
  for (const w of CHECKLIST_SOURCES[key] ?? []) {
    const id = inputBySource.get(`${w.kind}:${w.slug}`);
    expect(id, `${key}: no input in ${FILE} lists source ${w.kind}:${w.slug}`).toBeDefined();
    ids.add(id!);
  }
  return [...ids].sort();
}

describe('Deep-Dive data map doc', () => {
  it('lists the same dimensions as the health score', () => {
    expect(MAP_DIMENSIONS.map((d) => d.id)).toEqual([...HEALTH_DIMENSIONS]);
  });

  it('lists every driver under its dimension, and no others', () => {
    const doc = MAP_DRIVERS.filter((d) => !d.award).map((d) => `${d.dimension}.${d.key}`).sort();
    const code = HEALTH_DIMENSIONS.flatMap((dim) => DIMENSION_DRIVERS[dim].map((k) => `${dim}.${k}`)).sort();
    expect(doc).toEqual(code);
  });

  it("gives each driver exactly the inputs the setup checklist names", () => {
    for (const d of MAP_DRIVERS.filter((x) => !x.award)) {
      expect([...d.in].sort(), `driver ${d.key}`).toEqual(checklistInputs(`driver.${d.key}`));
    }
  });

  it('lists every checklist section with exactly its inputs', () => {
    const codeKeys = Object.keys(CHECKLIST_SOURCES).filter((k) => k.startsWith('section.')).sort();
    expect(MAP_SECTIONS.map((s) => `section.${s.key}`).sort()).toEqual(codeKeys);
    for (const s of MAP_SECTIONS) {
      expect([...s.in].sort(), `section ${s.key}`).toEqual(checklistInputs(`section.${s.key}`));
    }
  });

  it('refers only to inputs it defines, each listed once', () => {
    const ids = MAP_INPUTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(ids);
    for (const d of MAP_DRIVERS) for (const id of [...d.in, ...(d.alsoReads ?? [])]) expect(known.has(id), `${d.key}: ${id}`).toBe(true);
    for (const s of MAP_SECTIONS) for (const id of s.in) expect(known.has(id), `${s.key}: ${id}`).toBe(true);
  });
});
