import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GATHERED,
  excludedGlobs,
  isUnderDir,
  isExcluded,
  listRenderedPages,
  pageRoute,
  toPosix,
  twinOf,
} from '../src/manifest';

describe('manifest', () => {
  it('excludes whole folders and single files, and nothing else', () => {
    expect(isExcluded('superpowers/specs/x.md')).toBe(true);
    expect(isExcluded('hardening/01.md')).toBe(true);
    expect(isExcluded('user-manual.md')).toBe(true);
    expect(isExcluded('data-sources/_template.md')).toBe(true);
    expect(isExcluded('guides/windows-wsl2.md')).toBe(false);
    expect(isExcluded('superpowers.md')).toBe(false);
  });

  it('turns folder exclusions into globs and keeps file exclusions as-is', () => {
    expect(excludedGlobs()).toContain('superpowers/**');
    expect(excludedGlobs()).toContain('user-manual.md');
    expect(isExcluded('th/adopters/README.md')).toBe(false);
  });

  it('maps docs-relative paths to routes', () => {
    expect(pageRoute('index.md')).toBe('/');
    expect(pageRoute('adopters/README.md')).toBe('/adopters/README');
    expect(pageRoute('_generated/env.md')).toBe('/_generated/env');
    expect(pageRoute('th/tutorials/getting-started.md')).toBe('/th/tutorials/getting-started');
    expect(pageRoute('th/index.md')).toBe('/th/');
  });

  it('lists rendered pages sorted, skipping exclusions and non-markdown', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-site-manifest-'));
    for (const f of ['b.md', 'a/c.md', 'superpowers/s.md', 'user-manual.md', 'design/x.html']) {
      const full = path.join(dir, ...f.split('/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '# t\n');
    }
    expect(listRenderedPages(dir)).toEqual(['a/c.md', 'b.md']);
  });

  it('gives every gathered file a unique target name', () => {
    const targets = GATHERED.map((g) => g.target);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('puts a Thai twin under docs/th/ at the same path', () => {
    expect(twinOf('tutorials/getting-started.md')).toBe('th/tutorials/getting-started.md');
    expect(twinOf('data-import.md')).toBe('th/data-import.md');
  });

  it('keeps KKU-only pages off the site', () => {
    for (const p of ['auth/kku-sso.md', 'deployment/kku-network-integration.md', 'production-infrastructure.md',
      'rollout-plan.md', 'dashboard-chatbot-tests.md', 'acknowledgements/jobthai.md', 'guides/admin-runbook.md']) {
      expect(isExcluded(p)).toBe(true);
    }
  });

  it('does not publish the project contract or KKU runbook', () => {
    expect(GATHERED.map((g) => g.source)).not.toContain('CLAUDE.md');
    expect(GATHERED.map((g) => g.source)).not.toContain('DEPLOYMENT.md');
  });

  it('converts platform separators to POSIX', () => {
    expect(toPosix(['a', 'b', 'c.md'].join(path.sep))).toBe('a/b/c.md');
  });
});

describe('isUnderDir', () => {
  it('matches a POSIX module id against a Windows-style dir', () => {
    expect(isUnderDir('C:/repo/docs/x.md', 'C:\\repo\\docs')).toBe(true);
  });
  it('matches a Windows-style id against a Windows-style dir', () => {
    expect(isUnderDir('C:\\repo\\docs\\sub\\x.md', 'C:\\repo\\docs')).toBe(true);
  });
  it('matches POSIX paths, with or without a trailing slash on the dir', () => {
    expect(isUnderDir('/repo/docs/x.md?vue&type=script', '/repo/docs')).toBe(true);
    expect(isUnderDir('/repo/docs/x.md', '/repo/docs/')).toBe(true);
  });
  it('rejects a sibling dir sharing the prefix, and the dir itself', () => {
    expect(isUnderDir('/repo/docs-old/x.md', '/repo/docs')).toBe(false);
    expect(isUnderDir('C:/repo/docs-old/x.md', 'C:\\repo\\docs')).toBe(false);
    expect(isUnderDir('/repo/docs', '/repo/docs')).toBe(false);
    expect(isUnderDir('C:\\repo\\docs', 'C:/repo/docs')).toBe(false);
  });
});
