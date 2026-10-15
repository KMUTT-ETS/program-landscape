import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Every CLI script — including the six the worker spawns as child
// processes — must load the organisation before main() does any work,
// or the first AI prompt / User-Agent it builds throws
// OrganizationNotLoadedError. Scripts with no main() are listed here.
const EXEMPT = new Set(['ai-eval-accuracy.ts']);
const DIR = path.join(__dirname, '..', 'src', 'scripts');

describe('CLI scripts load the organisation', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !EXEMPT.has(f));

  it.each(files)('%s awaits loadOrganization() first in main()', (file) => {
    const src = readFileSync(path.join(DIR, file), 'utf8');
    const body = src.split(/^async function main\([^)]*\)[^{]*\{\s*$/m)[1];
    expect(body, 'no `async function main(` found — add it to EXEMPT only if the script has no entry point').toBeDefined();
    expect(body!.trimStart().startsWith('await loadOrganization();')).toBe(true);
  });
});
