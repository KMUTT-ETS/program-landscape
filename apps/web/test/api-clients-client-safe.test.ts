import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The API-clients console is a CLIENT component. A runtime import from the
// @kku/db or @kku/shared barrel makes webpack try to bundle node:crypto and
// the build breaks; only `import type` and the browser-safe deep path are
// allowed. Whole statements, not lines, so a Prettier-wrapped import cannot
// slip past.
const src = readFileSync(
  path.join(__dirname, '..', 'app', 'admin', 'external', 'api-clients', 'client.tsx'),
  'utf8',
);
const importStatements = src.match(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'[^']+'/gm) ?? [];

describe('api-clients console stays client-safe', () => {
  it('is a client component', () => {
    expect(src.trimStart().startsWith("'use client'")).toBe(true);
  });

  it('has no runtime import from @kku/db or the @kku/shared barrel', () => {
    expect(importStatements.length).toBeGreaterThan(0);
    for (const stmt of importStatements) {
      if (/^\s*(import|export) type\b/.test(stmt)) continue;
      expect(stmt).not.toMatch(/from\s+'@kku\/db(\/[^']*)?'/);
      expect(stmt).not.toMatch(/from\s+'@kku\/shared'/);
    }
  });

  it('takes STAFF_PROFILE_SECTIONS from the browser-safe deep path', () => {
    expect(importStatements.some((s) => s.includes("'@kku/shared/src/staff-profile/api-schema'"))).toBe(true);
  });

  it('labels sections readably and flags teaching evaluation as performance data', () => {
    expect(importStatements.some((s) => s.includes('STAFF_PROFILE_SECTION_LABELS'))).toBe(true);
    expect(src).toContain('Performance data about the person — grant only to systems with a recorded basis for it.');
    expect(src).toContain("toggleSection('teachingEvaluation')");
  });

  it('offers grants as its own opt-in', () => {
    expect(src).toContain("toggleSection('grants')");
    expect(src).toContain('Funding records about the person — grant only to systems with a recorded basis for it.');
  });
});
