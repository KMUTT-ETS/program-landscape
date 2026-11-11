import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// The `@kku/shared` root barrel re-exports './pdf' and './ingestion/kmitl-token',
// both of which import node:crypto, and '@kku/db' drags Prisma. A 'use client'
// component that imports a RUNTIME VALUE from either barrel makes webpack try
// to bundle those modules for the browser and the build dies with
// UnhandledSchemeError: Reading from "node:crypto" is not handled by plugins.
//
// `import type { X } from '@kku/shared'` is safe (erased at compile time), and
// so is `import { type X } from '@kku/shared'` — when EVERY specifier is
// marked `type`, the whole statement is elided. Anything else must go through
// a client-safe subpath (see the exports map in packages/shared/package.json).
//
// api-clients-client-safe.test.ts and profile-types-client-safe.test.ts pin
// individual files; this test pins the rule for every 'use client' file under
// app/ and src/ — the directories that ship in the browser bundle. Walked with
// fs rather than shelled out to grep: this repo's primary dev machine is
// Windows (see CLAUDE.md), so a test that needs a POSIX binary passes here
// and fails there.

const webRoot = join(__dirname, '..');
const scanRoots = [join(webRoot, 'app'), join(webRoot, 'src')];

/** Whole statements, not lines — a Prettier-wrapped import cannot slip past. */
const importStatements = (src: string): string[] =>
  src.match(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'[^']+'/gm) ?? [];

/** Client components in the two scan roots, as app/src-relative paths. */
function findClientComponents(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // directory does not exist — nothing to scan
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        const src = readFileSync(full, 'utf8');
        if (/^['"]use client['"]/.test(src.trimStart().slice(0, 200))) {
          found.push(relative(webRoot, full));
        }
      }
    }
  };
  scanRoots.forEach(walk);
  return found;
}

/**
 * Given a statement like `import { a, type B } from '@kku/shared'`, returns
 * the import clause (`{ a, type B }`). Anything not starting with `{` (default
 * import, `* as ns`, `export *`) pulls runtime code.
 */
function importClause(stmt: string): string {
  return stmt
    .replace(/^\s*(?:import|export)\b/, '')
    .replace(/\bfrom\s+'[^']*'[\s;]*$/, '')
    .trim();
}

/** True when the statement pulls runtime code, not just erased types. */
function pullsRuntimeCode(stmt: string): boolean {
  const clause = importClause(stmt);
  if (!clause.startsWith('{')) return true;
  return clause
    .slice(1, -1)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .some((spec) => !/^type\s/.test(spec));
}

const clientComponents = findClientComponents();
const read = (rel: string): string => readFileSync(join(webRoot, rel), 'utf8');

describe('no client component pulls the @kku/shared or @kku/db barrel at runtime', () => {
  it('found client components to scan (guards against a broken walk)', () => {
    expect(clientComponents.length).toBeGreaterThan(20);
    // Known client components from both scan roots — if these disappear the
    // walk broke and the assertions below would pass vacuously.
    expect(clientComponents).toContain(join('app', 'cockpit', 'client.tsx'));
    expect(clientComponents).toContain(join('app', 'admin', 'data-sources', '[slug]', 'run-log-dialog.tsx'));
    expect(clientComponents).toContain(join('src', 'components', 'theme-toggle.tsx'));
  });

  it('has no runtime import from either barrel in any of them', () => {
    const offenders: string[] = [];
    for (const rel of clientComponents) {
      for (const stmt of importStatements(read(rel))) {
        if (/^\s*(?:import|export)\s+type\b/.test(stmt)) continue; // erased whole
        const specifier = stmt.match(/from\s+'([^']+)'/)?.[1];
        if (specifier !== '@kku/shared' && specifier !== '@kku/db') continue; // subpath — fine
        if (pullsRuntimeCode(stmt)) offenders.push(`${rel}: ${stmt.trim().replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no dynamic import() or require() of either barrel in any of them', () => {
    const offenders: string[] = [];
    for (const rel of clientComponents) {
      if (/import\(\s*['"]@kku\/(?:shared|db)['"]\s*\)|require\(\s*['"]@kku\/(?:shared|db)['"]\s*\)/.test(read(rel))) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// The run-log modal is the file that broke the build once already
// (2026-11-11: `isRunLogFinal` imported from the barrel). Pin its fix.
describe('the run-log modal stays client-safe', () => {
  const dialogRel = join('app', 'admin', 'data-sources', '[slug]', 'run-log-dialog.tsx');

  it('takes isRunLogFinal from the browser-safe subpath, not the barrel', () => {
    const stmt = importStatements(read(dialogRel)).find((s) => s.includes('isRunLogFinal'));
    expect(stmt).toBeDefined();
    expect(stmt).toContain("'@kku/shared/ingestion/run-log'");
  });

  it('is backed by a shared module whose only runtime import is zod', () => {
    const moduleSrc = readFileSync(
      join(webRoot, '..', '..', 'packages', 'shared', 'src', 'ingestion', 'run-log.ts'),
      'utf8',
    );
    const stmts = importStatements(moduleSrc);
    expect(stmts.length).toBeGreaterThan(0);
    for (const stmt of stmts) {
      if (/^\s*import\s+type\b/.test(stmt)) continue;
      expect(stmt).toMatch(/from\s+'zod'/);
    }
    expect(moduleSrc).not.toMatch(/from\s+'node:/);
  });
});
