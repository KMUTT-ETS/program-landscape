import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// profile-view.tsx is a CLIENT component and imports runtime helpers from
// profile-types. If any import on that path reaches the @kku/shared or
// @kku/db barrel, webpack tries to bundle node:crypto and the build breaks.
// Pin the two files' import lines structurally.
const read = (...p: string[]) => readFileSync(path.join(__dirname, '..', ...p), 'utf8');
// Whole statements, not lines: a runtime import Prettier wraps across lines
// (`import {\n  z,\n} from 'zod';`) is exactly the one that must not slip past.
const importLines = (src: string) => src.match(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'[^']+'/gm) ?? [];

describe('profile types stay client-safe', () => {
  it('the shared types module has no runtime imports at all', () => {
    const src = read('..', '..', 'packages', 'shared', 'src', 'staff-profile', 'types.ts');
    for (const line of importLines(src)) expect(line).toMatch(/^\s*(import|export) type\b/);
  });

  it('web profile-types takes runtime code only from the deep path', () => {
    const src = read('src', 'lib', 'profile-types.ts');
    for (const line of importLines(src)) {
      if (/^\s*(import|export) type\b/.test(line)) continue;
      expect(line).toContain("'@kku/shared/src/staff-profile/types'");
    }
  });

  it('the shared types carry the new provenance fields', () => {
    const src = read('..', '..', 'packages', 'shared', 'src', 'staff-profile', 'types.ts');
    expect(src).toMatch(/source:\s*string\s*\|\s*null/);
    expect(src).toMatch(/scholarPaperId:\s*string\s*\|\s*null/);
  });
});
