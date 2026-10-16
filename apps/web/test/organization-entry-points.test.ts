import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Recurrence guard for the white-label C1 defect: the web server read the
// organisation identity (via @kku/db / @kku/shared helpers) in a process that
// had never loaded it, so faculty-scoped dashboards crashed and /profile
// cached an "AI not configured" placeholder.
//
// Every web server file that imports a function whose code path reads
// getInstitution() must also await ensureOrganizationLoaded() — it self-heals
// a skipped or failed boot-time load (instrumentation.ts). When you make a
// new @kku/db / @kku/shared function read the identity and call it from the
// web app, add its name here.
const IDENTITY_READERS = [
  // @kku/shared
  'getInstitution',
  'outboundUserAgent',
  'isOwnInstitution',
  /^build\w*Messages$/,
  // @kku/db — health-score.ts, program-deep-dive.ts, staff-profile/*
  'getDashboardOverview',
  'computeHealthScores',
  'getProgramScoreIndex',
  'computeGapMap',
  'buildStaffProfile',
  'programTcasStats',
  'facultyTcasStats',
  'universityTcasStats',
  'programLifecycleVerdict',
  'programAiPeers',
] as const;

const ROOT = path.resolve(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function importedNames(source: string): string[] {
  const names: string[] = [];
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@kku\/(?:db|shared)[^']*'/g;
  for (const m of source.matchAll(re)) {
    for (const part of (m[1] ?? '').split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function isReader(name: string): boolean {
  return IDENTITY_READERS.some((r) => (typeof r === 'string' ? r === name : r.test(name)));
}

describe('web entry points that read the organisation identity', () => {
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'src'))];
  const readers = files
    .map((f) => ({ file: path.relative(ROOT, f), source: readFileSync(f, 'utf8') }))
    .filter(({ source }) => importedNames(source).some(isReader));

  it('finds the known readers (guards the scan itself)', () => {
    const found = readers.map((r) => r.file).sort();
    expect(found).toEqual(
      expect.arrayContaining([
        'app/dashboards/executive-landscape/page.tsx',
        'src/lib/profile-data.ts',
        'src/lib/profile-narrative.ts',
      ]),
    );
  });

  it.each(readers.map((r) => [r.file, r.source] as const))('%s awaits ensureOrganizationLoaded()', (_file, source) => {
    expect(source).toMatch(/await\s+ensureOrganizationLoaded\(/);
  });
});
