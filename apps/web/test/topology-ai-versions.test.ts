import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// The /admin/application-topology AI nodes name the prompt version they run.
// Nothing kept those strings honest, and by 2026-09-05 TEN of the fourteen
// were wrong — some by two majors (pdf-classify.v1 vs the shipped v2,
// gap-insights.v1 vs v2), and one node named a prompt that does not exist at
// all ("strategic-narrative.v1"; the module exports
// program-strategic-narrative.v3).
//
// A version string on an operator-facing diagram is a claim about what the
// platform runs. Wrong is worse than absent: it sends someone reading the
// topology to a prompt version that was replaced months ago.
//
// This asserts every `<name>.vN` in a topology subtitle resolves to a version
// constant a prompt module actually exports. It does NOT require every prompt
// to have its own node — several are deliberately collapsed into umbrella
// nodes (Phase 1 covers digest + faculty + skills + pedagogy).
// ─────────────────────────────────────────────────────────────────────────────

const REPO = path.join(__dirname, '..', '..', '..');
const TOPOLOGY = path.join(
  REPO,
  'apps/web/app/admin/application-topology/topology-data.ts',
);
const PROMPTS = path.join(REPO, 'packages/shared/src/ai/prompts');

/** Every `*_VERSION = '...'` string the prompt modules export. */
function shippedVersions(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(PROMPTS)) {
    if (!f.endsWith('.ts') || f === 'index.ts') continue;
    const src = readFileSync(path.join(PROMPTS, f), 'utf8');
    // `m[1]` is non-optional in practice — the group is not optional in the
    // pattern — but `RegExpMatchArray` indexes as `string | undefined` under
    // noUncheckedIndexedAccess, and this file only started being typechecked
    // when `test/**` was added to tsconfig's include.
    for (const m of src.matchAll(/export const [A-Z_0-9]*VERSION\s*=\s*'([^']+)'/g)) {
      if (m[1]) out.add(m[1]);
    }
  }
  return out;
}

/** Every version-looking token in a topology node subtitle. */
function claimedVersions(): Array<{ subtitle: string; version: string }> {
  const src = readFileSync(TOPOLOGY, 'utf8');
  const out: Array<{ subtitle: string; version: string }> = [];
  for (const m of src.matchAll(/subtitle: '([^']*)'/g)) {
    const subtitle = m[1];
    if (subtitle === undefined) continue;
    // `name.vN` / `name.vN.N` — the shape the prompt VERSION constants use.
    const v = /([a-z0-9-]+\.v\d+(?:\.\d+)?)/.exec(subtitle);
    if (v?.[1]) out.push({ subtitle, version: v[1] });
  }
  return out;
}

describe('application-topology AI node versions', () => {
  it('every version named on the diagram is one a prompt module exports', () => {
    const shipped = shippedVersions();
    expect(shipped.size).toBeGreaterThan(20);

    const claimed = claimedVersions();
    expect(claimed.length).toBeGreaterThan(10);

    // analyst-system.v1 is the AI Analyst's tool-use system prompt, which
    // lives in @kku/shared/analyst rather than the prompts directory.
    const EXEMPT = new Set(['analyst-system.v1']);

    const wrong = claimed
      .filter((c) => !EXEMPT.has(c.version) && !shipped.has(c.version))
      .map((c) => `${c.version}  (in subtitle "${c.subtitle}")`);

    expect(
      wrong,
      `topology names ${wrong.length} prompt version(s) that no module exports. ` +
        `Either the prompt was bumped and the diagram was not, or the node names a ` +
        `prompt that never existed. Update the subtitle in topology-data.ts to the ` +
        `constant the module exports.`,
    ).toEqual([]);
  });

  it('no topology edge points at a node that does not exist', () => {
    // A dangling edge is dropped silently by the graph renderer, so a node
    // added without its edges simply floats with nothing flowing into it.
    const src = readFileSync(TOPOLOGY, 'utf8');
    const ids = new Set([...src.matchAll(/^ {4}id: '([^']+)'/gm)].map((m) => m[1]));
    const dangling: string[] = [];
    for (const m of src.matchAll(/\{ from: '([^']+)', to: '([^']+)'/g)) {
      if (!ids.has(m[1])) dangling.push(`from ${m[1]}`);
      if (!ids.has(m[2])) dangling.push(`to ${m[2]}`);
    }
    expect(ids.size).toBeGreaterThan(100);
    expect(dangling, `dangling edge endpoints: ${dangling.join(', ')}`).toEqual([]);
  });
});
