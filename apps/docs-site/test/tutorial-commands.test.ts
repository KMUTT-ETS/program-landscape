import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(__dirname, '../../..');
const REQUIRED_PAGES = [
  ...['getting-started', 'program-deep-dive'].map((n) =>
    path.join(repo, 'docs', 'tutorials', `${n}.md`),
  ),
  path.join(repo, 'docs', 'workshop', 'README.md'),
];

/** Every workshop page in both languages, plus the WSL2 guide once it exists. */
function optionalPages(): string[] {
  const out: string[] = [];
  for (const dir of [path.join(repo, 'docs', 'workshop'), path.join(repo, 'docs', 'th', 'workshop')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (f.endsWith('.md')) out.push(path.join(dir, f));
    }
  }
  const wsl = path.join(repo, 'docs', 'guides', 'windows-wsl2.md');
  if (fs.existsSync(wsl)) out.push(wsl);
  return out;
}

const PAGES = [...new Set([...REQUIRED_PAGES, ...optionalPages()])];

function packageJsonFiles(): string[] {
  const out = [path.join(repo, 'package.json')];
  for (const group of ['apps', 'packages']) {
    const dir = path.join(repo, group);
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir)) {
      const f = path.join(dir, d, 'package.json');
      if (fs.existsSync(f)) out.push(f);
    }
  }
  return out;
}

function allScripts(): Set<string> {
  const names = new Set<string>();
  for (const f of packageJsonFiles()) {
    const json = JSON.parse(fs.readFileSync(f, 'utf8')) as { scripts?: Record<string, string> };
    for (const k of Object.keys(json.scripts ?? {})) names.add(k);
  }
  return names;
}

/** Built-in pnpm commands that are not package scripts. */
const BUILTIN = new Set(['install', 'add', 'exec', 'dlx', 'run', 'filter', 'approve-builds']);

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

describe('tutorial pages', () => {
  it('exist', () => {
    for (const p of REQUIRED_PAGES) expect(fs.existsSync(p), p).toBe(true);
  });

  it('only mention pnpm scripts that exist', () => {
    const scripts = allScripts();
    const missing: string[] = [];
    for (const p of PAGES) {
      if (!fs.existsSync(p)) continue;
      for (const m of read(p).matchAll(/pnpm\s+([a-z][\w:.-]*)/g)) {
        const name = m[1] as string;
        if (BUILTIN.has(name) || scripts.has(name)) continue;
        missing.push(`${path.basename(p)}: pnpm ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('only mention /admin routes that exist under apps/web/app', () => {
    const missing: string[] = [];
    for (const p of PAGES) {
      if (!fs.existsSync(p)) continue;
      for (const m of read(p).matchAll(/`(\/admin(?:\/[\w<>\-[\]]+)*)/g)) {
        const route = m[1] as string;
        const segments = route.split('/').filter(Boolean);
        let dir = path.join(repo, 'apps/web/app');
        let ok = true;
        for (const seg of segments) {
          if (seg.startsWith('<')) {
            const dyn = fs.existsSync(dir)
              ? fs.readdirSync(dir).find((d) => d.startsWith('[') && d.endsWith(']'))
              : undefined;
            if (!dyn) {
              ok = false;
              break;
            }
            dir = path.join(dir, dyn);
          } else {
            const next = path.join(dir, seg);
            const dyn = fs.existsSync(dir)
              ? fs.readdirSync(dir).find((d) => d.startsWith('[') && d.endsWith(']'))
              : undefined;
            if (fs.existsSync(next)) dir = next;
            else if (dyn) dir = path.join(dir, dyn);
            else {
              ok = false;
              break;
            }
          }
        }
        if (!ok) missing.push(`${path.basename(p)}: ${route}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
