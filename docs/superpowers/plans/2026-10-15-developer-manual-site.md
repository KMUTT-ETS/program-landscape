# Developer Manual Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, offline, searchable VitePress site that renders the repo's `docs/` in place along a curated adopter-journey sidebar, plus gathered root docs and generated pnpm-script and environment-variable reference pages.

**Architecture:** A new workspace package `apps/docs-site` holds only config, a sidebar, a markdown-it plugin and two Node scripts. `gather.ts` copies six out-of-tree Markdown files and writes two generated pages into `docs/_generated/` (gitignored); VitePress builds with `srcDir` = `docs/`; `check-site.ts` then fails the build on sidebar drift or retired product names. All decision logic lives in small pure modules under `apps/docs-site/src/` with Vitest coverage; the CLIs are thin wrappers.

**Tech Stack:** VitePress 1.6.4 (pinned), markdown-it 14, TypeScript strict, tsx, Vitest 2, rimraf, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-15-developer-manual-site-design.md`

## Global Constraints

- Work only in the worktree `/home/chun/git-repos/program-landscape-docs-site`, branch `feat/docs-site`. Never touch the main checkout.
- Audience: developers at adopting institutions. English only. Local only — nothing published.
- `docs/` stays the single source of truth; no hand-maintained copies of any doc.
- TypeScript strict, **no `any`**; `noUncheckedIndexedAccess` is on (index results may be `undefined`).
- Cross-platform: Node/tsx only, `path.join`/`path.resolve` for filesystem paths, `rimraf` (never `rm -rf`), no POSIX shell in scripts; every path written into Markdown or compared as a route is POSIX (`toPosix`).
- VitePress pinned exactly to `1.6.4`.
- No DB, Docker or `.env` needed for any task.
- Conventional commits: `feat(docs-site): …` for the package, `docs: …` for source-doc edits, `chore: …` for config. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Retired product names (*Curriculum Compass*, *ทักษทัศน์*, *KKU Curriculum Landscape*) must never appear in new text.
- Do not add `docs:build` to `pnpm check` or CI.
- PII rule (org policy): generated pages contain only what is already in the repo; secret-looking env values are blanked and URL credentials masked. Before each commit, run the PII pattern check in that task's commit step.

**Deliberate refinements of the spec (decided while planning, keep them):**
1. Retired-name allowlist also includes `/glossary-th-en` and `/adopters/README` — both record the names on purpose (verified: they are the only two curated docs that contain them).
2. Instead of hand-backticking the bare `<Tag>` prose sites (only one is real: `docs/dashboard-chatbot-tests.md:768`; the others are indented code or excluded), the link plugin escapes any raw HTML tag not on a small safe-tag allowlist. Markdown `html` stays on, so `<details>`, `<br>` etc. still work, and gathered files like `CLAUDE.md` are protected too.
3. The "Generated from …" banner is a VitePress `::: info` container placed directly under the page's H1 (at the top when there is no H1), so the page title stays the H1.
4. Out-of-tree links that aren't gathered render as `text (` `repo/path` `)`, or just the code path when the link text already is the path.
5. Package scripts are named `site:dev` / `site:build` / `site:preview` (not `dev`/`build`) so no recursive `pnpm -r build` or dev filter ever picks the site up.

## Review Focus

1. **URL values carrying credentials under a non-secret key** (`DATABASE_URL=postgresql://kku:kku_dev_password@…`) — the key does not match `SECRET|PASSWORD|KEY|TOKEN`, so a naive filter would print the password. Expect the password masked as `****`. Test in Task 2.
2. **A `# KEY=value` commented-out line vs. prose comments in `.env.example`** — `# APP_PUBLIC_URL=https://…` must become an optional entry; `# Create it once with:  createdb -U kku …` and `# INSTITUTION_NAME_TH must equal …` must stay comment text. Test in Task 2.
3. **Links inside fenced code blocks of gathered files** (e.g. a Markdown example in `CLAUDE.md`) must not be rebased. Test in Task 2.
4. **Links with an anchor or percent-encoding to a gathered or out-of-tree file** (`../../prompts/14-integration-session-template.md#pre-session`, `../My%20File.md`) — anchor preserved, path decoded. Tests in Task 3.
5. **HTML comments and lowercase safe tags** (`<!-- note -->`, `<details>`) must render untouched, while `<this student>` / `<ProvenanceButton>` must appear as visible escaped text rather than break the Vue compile. Tests in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/docs-site/package.json` | Package manifest, scripts, pinned deps |
| `apps/docs-site/tsconfig.json` | Typecheck config for src, scripts, tests, `.vitepress` |
| `apps/docs-site/vitest.config.ts` | Test discovery (`test/**/*.test.ts`) |
| `apps/docs-site/src/env.d.ts` | `*.css` module declaration for the theme import |
| `apps/docs-site/src/manifest.ts` | Single source for exclusions, gathered files, retired names, page listing, routes |
| `apps/docs-site/src/gather.ts` | Pure gather logic: link rebasing, banner, scripts page, env page, `runGather` |
| `apps/docs-site/src/link-plugin.ts` | markdown-it core rule: link classification/rewrite + unsafe-HTML escaping |
| `apps/docs-site/src/check-site.ts` | Pure post-build checks: sidebar coverage, retired names, html routes |
| `apps/docs-site/scripts/gather.ts` | CLI wrapper for `runGather` |
| `apps/docs-site/scripts/check-site.ts` | CLI wrapper: reads dist + docs, prints problems, sets exit code |
| `apps/docs-site/.vitepress/sidebar.ts` | Curated adopter-journey sidebar |
| `apps/docs-site/.vitepress/config.ts` | VitePress config |
| `apps/docs-site/.vitepress/theme/index.ts`, `custom.css` | Default theme + font/accent/`repo-path` styles |
| `apps/docs-site/test/*.test.ts` | Unit tests per module |
| `docs/index.md` | Landing page (new) |
| `docs/methodologies/README.md` | Fix the dead `benchmarking.md` link |
| `README.md`, `docs/adopters/README.md` | One-line pointers to the site |
| `package.json` (root), `.gitignore`, `pnpm-lock.yaml` | Root scripts, ignores, lockfile |

---

### Task 1: Package scaffold and manifest

**Files:**
- Create: `apps/docs-site/package.json`, `apps/docs-site/tsconfig.json`, `apps/docs-site/vitest.config.ts`, `apps/docs-site/src/env.d.ts`, `apps/docs-site/src/manifest.ts`
- Modify: `.gitignore` (append), `pnpm-lock.yaml` (via install)
- Test: `apps/docs-site/test/manifest.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (from `src/manifest.ts`):
  - `GENERATED_DIR_NAME: '_generated'`
  - `EXCLUDED: readonly string[]` (docs-relative POSIX; trailing `/` = folder)
  - `isExcluded(docsRel: string): boolean`
  - `excludedGlobs(): string[]`
  - `interface GatheredFile { source: string; target: string }` and `GATHERED: readonly GatheredFile[]`
  - `RETIRED_NAMES: readonly string[]`, `RETIRED_NAME_ALLOWLIST: readonly string[]` (routes)
  - `toPosix(p: string): string`
  - `listRenderedPages(docsDir: string): string[]` (sorted docs-relative POSIX `.md` paths, exclusions removed)
  - `pageRoute(docsRel: string): string`

- [ ] **Step 1: Create the package files**

`apps/docs-site/package.json`:

```json
{
  "name": "docs-site",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "gather": "tsx scripts/gather.ts",
    "site:dev": "tsx scripts/gather.ts && vitepress dev .",
    "site:build": "tsx scripts/gather.ts && vitepress build . && tsx scripts/check-site.ts",
    "site:preview": "vitepress preview .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/markdown-it": "14.1.2",
    "@types/node": "^20.17.10",
    "markdown-it": "14.1.0",
    "rimraf": "^6.0.1",
    "tsx": "4.21.0",
    "typescript": "^5.6.3",
    "vitepress": "1.6.4",
    "vitest": "^2.1.8"
  }
}
```

`apps/docs-site/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "lib": ["ES2022", "DOM"],
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts", ".vitepress/**/*.ts"],
  "exclude": ["node_modules", "dist", ".vitepress/cache"]
}
```

`apps/docs-site/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
```

`apps/docs-site/src/env.d.ts`:

```ts
// The theme imports a plain stylesheet; VitePress (Vite) bundles it.
declare module '*.css';
```

Append to `.gitignore`:

```
# Developer manual site (apps/docs-site) — build artefacts
docs/_generated/
apps/docs-site/.vitepress/cache/
```

(`dist/` is already ignored repo-wide.)

- [ ] **Step 2: Install**

Run (in the worktree root): `pnpm install`
Expected: completes; `pnpm-lock.yaml` gains an `apps/docs-site` importer with `vitepress 1.6.4`. If pnpm asks to approve build scripts for a new dependency (e.g. `esbuild` is already approved), approve only what the install names, then re-run.

- [ ] **Step 3: Write the failing test**

`apps/docs-site/test/manifest.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GATHERED,
  excludedGlobs,
  isExcluded,
  listRenderedPages,
  pageRoute,
  toPosix,
} from '../src/manifest';

describe('manifest', () => {
  it('excludes whole folders and single files, and nothing else', () => {
    expect(isExcluded('superpowers/specs/x.md')).toBe(true);
    expect(isExcluded('hardening/01.md')).toBe(true);
    expect(isExcluded('user-manual.md')).toBe(true);
    expect(isExcluded('data-sources/_template.md')).toBe(true);
    expect(isExcluded('guides/admin-runbook.md')).toBe(false);
    expect(isExcluded('superpowers.md')).toBe(false);
  });

  it('turns folder exclusions into globs and keeps file exclusions as-is', () => {
    expect(excludedGlobs()).toContain('superpowers/**');
    expect(excludedGlobs()).toContain('user-manual.md');
  });

  it('maps docs-relative paths to routes', () => {
    expect(pageRoute('index.md')).toBe('/');
    expect(pageRoute('adopters/README.md')).toBe('/adopters/README');
    expect(pageRoute('_generated/env.md')).toBe('/_generated/env');
    expect(pageRoute('methodologies/program-health-and-lifecycle.th.md')).toBe(
      '/methodologies/program-health-and-lifecycle.th',
    );
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

  it('converts platform separators to POSIX', () => {
    expect(toPosix(['a', 'b', 'c.md'].join(path.sep))).toBe('a/b/c.md');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter docs-site test`
Expected: FAIL — `Failed to resolve import "../src/manifest"`.

- [ ] **Step 5: Write the implementation**

`apps/docs-site/src/manifest.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

/** Folder (inside docs/) that gather.ts writes into; gitignored. Not a dot-dir: VitePress skips those. */
export const GENERATED_DIR_NAME = '_generated';

/**
 * docs-relative POSIX paths that are NOT rendered. A trailing '/' excludes a whole folder.
 * Working documents and end-user-only material live here; they stay in the repo.
 */
export const EXCLUDED: readonly string[] = [
  'superpowers/',
  'hardening/',
  'design/',
  'data-sources/_template.md',
  'user-manual.md',
  'guides/council-th.md',
  'guides/executive.md',
  'guides/analyst.md',
  'adopters/README.th.md',
];

export function isExcluded(docsRel: string): boolean {
  return EXCLUDED.some((e) => (e.endsWith('/') ? docsRel.startsWith(e) : docsRel === e));
}

/** EXCLUDED in VitePress `srcExclude` glob form. */
export function excludedGlobs(): string[] {
  return EXCLUDED.map((e) => (e.endsWith('/') ? `${e}**` : e));
}

export interface GatheredFile {
  /** repo-relative POSIX path of the original */
  source: string;
  /** file name inside docs/_generated/ */
  target: string;
}

/** Files outside docs/ that the site needs. Copied (never edited) by gather.ts. */
export const GATHERED: readonly GatheredFile[] = [
  { source: 'README.md', target: 'readme.md' },
  { source: 'DEPLOYMENT.md', target: 'deployment.md' },
  { source: 'CLAUDE.md', target: 'project-contract.md' },
  { source: 'SECURITY.md', target: 'security-policy.md' },
  { source: 'prompts/14-integration-session-template.md', target: 'connector-session-template.md' },
  { source: 'infra/gotenberg/README.md', target: 'gotenberg-fonts.md' },
];

export const RETIRED_NAMES: readonly string[] = [
  'Curriculum Compass',
  'ทักษทัศน์',
  'KKU Curriculum Landscape',
];

/** Routes allowed to contain retired names because they record them deliberately. */
export const RETIRED_NAME_ALLOWLIST: readonly string[] = [
  `/${GENERATED_DIR_NAME}/project-contract`,
  '/glossary-th-en',
  '/adopters/README',
];

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Every docs-relative .md path VitePress will render, sorted. */
export function listRenderedPages(docsDir: string): string[] {
  return fs
    .readdirSync(docsDir, { recursive: true, encoding: 'utf8' })
    .map(toPosix)
    .filter((p) => p.endsWith('.md') && !isExcluded(p))
    .sort();
}

/** 'adopters/README.md' → '/adopters/README'; 'index.md' → '/'. */
export function pageRoute(docsRel: string): string {
  return `/${docsRel.replace(/\.md$/, '').replace(/(^|\/)index$/, '$1')}`;
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter docs-site test && pnpm --filter docs-site typecheck`
Expected: 6 tests PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/docs-site/package.json apps/docs-site/tsconfig.json apps/docs-site/vitest.config.ts apps/docs-site/src/env.d.ts apps/docs-site/src/manifest.ts apps/docs-site/test/manifest.test.ts .gitignore pnpm-lock.yaml
git commit -m "feat(docs-site): scaffold package and page manifest" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Gather step (gathered copies + generated reference pages)

**Files:**
- Create: `apps/docs-site/src/gather.ts`, `apps/docs-site/scripts/gather.ts`
- Test: `apps/docs-site/test/gather.test.ts`

**Interfaces:**
- Consumes (Task 1): `GATHERED`, `GENERATED_DIR_NAME`, `toPosix`.
- Produces (from `src/gather.ts`):
  - `class GatherError extends Error`
  - `rebaseLinks(markdown: string, fromDir: string, toDir: string): string`
  - `insertBanner(markdown: string, sourceRel: string): string`
  - `interface ScriptEntry { name: string; command: string }`, `interface ScriptGroup { title: string; scripts: ScriptEntry[] }`
  - `groupScripts(scripts: Record<string, string>): ScriptGroup[]`, `renderScriptsPage(groups: ScriptGroup[]): string`
  - `interface EnvEntry { key: string; value: string; comment: string; optional: boolean }`, `interface EnvSection { title: string; entries: EnvEntry[] }`
  - `isSecretKey(key: string): boolean`, `displayValue(key: string, value: string): string`
  - `parseEnvExample(text: string): EnvSection[]`, `renderEnvPage(sections: EnvSection[]): string`
  - `runGather(repoRoot: string): { written: string[] }` — writes `docs/_generated/{readme,deployment,project-contract,security-policy,connector-session-template,gotenberg-fonts,scripts,env}.md`

- [ ] **Step 1: Write the failing test**

`apps/docs-site/test/gather.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GatherError,
  displayValue,
  groupScripts,
  insertBanner,
  parseEnvExample,
  rebaseLinks,
  renderEnvPage,
  renderScriptsPage,
  runGather,
} from '../src/gather';
import { GATHERED } from '../src/manifest';

const ENV_FIXTURE = [
  '# ────────────────',
  '# Program Landscape — environment template',
  '# ────────────────',
  '',
  '# --- Core ---',
  'NODE_ENV=development',
  '# Where the web app listens.',
  'APP_URL=http://localhost:3000',
  '# APP_PUBLIC_URL (the public URL) is sent in User-Agents.',
  '# APP_PUBLIC_URL=https://program-landscape.example.ac.th',
  '',
  '# --- Database ---',
  'POSTGRES_PASSWORD=kku_dev_password',
  'DATABASE_URL=postgresql://kku:kku_dev_password@localhost:5432/pl?schema=public',
  '# Create it once with:  createdb -U kku program_landscape_shadow',
  '# INSTITUTION_NAME_TH must equal the TCAS column exactly.',
  'MINIO_ACCESS_KEY=minio_dev',
  '',
].join('\n');

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-site-gather-'));
  for (const g of GATHERED) {
    const full = path.join(root, ...g.source.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `# ${g.source}\n\nSee [backups](docs/backup-dr.md).\n`);
  }
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { dev: 'concurrently a b', 'db:up': 'docker compose up -d', 'db:down': 'docker compose down' } }),
  );
  fs.writeFileSync(path.join(root, '.env.example'), ENV_FIXTURE);
  return root;
}

describe('rebaseLinks', () => {
  const root = path.join(os.tmpdir(), 'r');
  const gen = path.join(root, 'docs', '_generated');

  it('rebases relative links to the new location and keeps the anchor', () => {
    expect(rebaseLinks('[b](docs/backup-dr.md#restore)', root, gen)).toBe('[b](../backup-dr.md#restore)');
    expect(rebaseLinks('[d](./DEPLOYMENT.md)', root, gen)).toBe('[d](../../DEPLOYMENT.md)');
  });

  it('leaves external, absolute, mailto and anchor links alone', () => {
    const src = '[a](https://x.org) [b](/abs) [c](mailto:a@example.org) [d](#top)';
    expect(rebaseLinks(src, root, gen)).toBe(src);
  });

  it('does not touch links inside fenced code blocks', () => {
    const src = ['```md', '[x](docs/a.md)', '```', '[y](docs/a.md)'].join('\n');
    expect(rebaseLinks(src, root, gen)).toBe(['```md', '[x](docs/a.md)', '```', '[y](../a.md)'].join('\n'));
  });
});

describe('insertBanner', () => {
  it('puts the banner directly under the H1', () => {
    const out = insertBanner('# Title\n\nBody\n', 'DEPLOYMENT.md');
    expect(out.startsWith('# Title\n\n::: info Generated page\nGenerated from `DEPLOYMENT.md`')).toBe(true);
    expect(out).toContain('Body');
  });

  it('puts the banner at the top when there is no H1', () => {
    expect(insertBanner('Body\n', 'x.md').startsWith('::: info Generated page')).toBe(true);
  });
});

describe('scripts page', () => {
  it('groups by prefix, General first, everything sorted', () => {
    const groups = groupScripts({ 'z:b': 'zb', dev: 'd', 'db:up': 'u', 'db:down': 'dn', check: 'c' });
    expect(groups.map((g) => g.title)).toEqual(['General', 'db', 'z']);
    expect(groups[0]?.scripts.map((s) => s.name)).toEqual(['check', 'dev']);
    expect(groups[1]?.scripts.map((s) => s.name)).toEqual(['db:down', 'db:up']);
  });

  it('renders each script as name and command code spans', () => {
    const page = renderScriptsPage(groupScripts({ 'db:up': 'docker compose up -d' }));
    expect(page).toContain('## db');
    expect(page).toContain('- `db:up` — `docker compose up -d`');
  });

  it('uses a double-backtick span when the command contains a backtick', () => {
    const page = renderScriptsPage(groupScripts({ x: 'echo `date`' }));
    expect(page).toContain('- `x` — `` echo `date` ``');
  });
});

describe('env page', () => {
  const sections = parseEnvExample(ENV_FIXTURE);

  it('splits into the file’s own sections and ignores the header banner', () => {
    expect(sections.map((s) => s.title)).toEqual(['Core', 'Database']);
  });

  it('attaches the comment block above a key', () => {
    const appUrl = sections[0]?.entries.find((e) => e.key === 'APP_URL');
    expect(appUrl?.comment).toBe('Where the web app listens.');
  });

  it('treats "# KEY=value" as an optional entry but keeps prose comments as prose', () => {
    const optional = sections[0]?.entries.find((e) => e.key === 'APP_PUBLIC_URL');
    expect(optional?.optional).toBe(true);
    expect(optional?.value).toBe('https://program-landscape.example.ac.th');
    const keys = sections.flatMap((s) => s.entries.map((e) => e.key));
    expect(keys).not.toContain('INSTITUTION_NAME_TH');
    const minio = sections[1]?.entries.find((e) => e.key === 'MINIO_ACCESS_KEY');
    expect(minio?.comment).toContain('Create it once with:');
  });

  it('blanks secret-looking keys and masks credentials inside URLs', () => {
    const db = sections[1]?.entries ?? [];
    expect(db.find((e) => e.key === 'POSTGRES_PASSWORD')?.value).toBe('');
    expect(db.find((e) => e.key === 'MINIO_ACCESS_KEY')?.value).toBe('');
    expect(db.find((e) => e.key === 'DATABASE_URL')?.value).toBe(
      'postgresql://kku:****@localhost:5432/pl?schema=public',
    );
    expect(displayValue('APP_URL', 'http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('renders keys, values and optional markers', () => {
    const page = renderEnvPage(sections);
    expect(page).toContain('## Core');
    expect(page).toContain('- `APP_URL` = `http://localhost:3000`');
    expect(page).toContain('- `POSTGRES_PASSWORD` = *(empty)*');
    expect(page).toContain('*(optional — commented out in the template)*');
    expect(page).not.toContain('kku_dev_password');
  });
});

describe('runGather', () => {
  it('writes every gathered and generated page', () => {
    const root = makeRepo();
    const { written } = runGather(root);
    expect(written).toEqual([
      '_generated/readme.md',
      '_generated/deployment.md',
      '_generated/project-contract.md',
      '_generated/security-policy.md',
      '_generated/connector-session-template.md',
      '_generated/gotenberg-fonts.md',
      '_generated/scripts.md',
      '_generated/env.md',
    ]);
    const readme = fs.readFileSync(path.join(root, 'docs', '_generated', 'readme.md'), 'utf8');
    expect(readme).toContain('Generated from `README.md`');
    expect(readme).toContain('[backups](../backup-dr.md)');
  });

  it('is byte-identical across runs', () => {
    const root = makeRepo();
    const read = () =>
      ['scripts.md', 'env.md', 'project-contract.md'].map((f) =>
        fs.readFileSync(path.join(root, 'docs', '_generated', f), 'utf8'),
      );
    runGather(root);
    const first = read();
    runGather(root);
    expect(read()).toEqual(first);
  });

  it('fails loudly, naming the file, and leaves the previous output intact', () => {
    const root = makeRepo();
    runGather(root);
    fs.rmSync(path.join(root, 'DEPLOYMENT.md'));
    expect(() => runGather(root)).toThrow(GatherError);
    expect(() => runGather(root)).toThrow('DEPLOYMENT.md');
    expect(fs.existsSync(path.join(root, 'docs', '_generated', 'deployment.md'))).toBe(true);
  });

  it('fails when package.json has no scripts', () => {
    const root = makeRepo();
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    expect(() => runGather(root)).toThrow('package.json has no scripts');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter docs-site test -- gather`
Expected: FAIL — `Failed to resolve import "../src/gather"`.

- [ ] **Step 3: Write the implementation**

`apps/docs-site/src/gather.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { rimrafSync } from 'rimraf';
import { GATHERED, GENERATED_DIR_NAME, toPosix } from './manifest';

export class GatherError extends Error {}

const FENCE = /^\s*(```|~~~)/;
const MD_LINK = /\]\(([^)\s]+)\)/g;

function isRelativeLink(href: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#') && !href.startsWith('/');
}

/** Rewrite relative Markdown links written for `fromDir` so they resolve from `toDir`. Fenced code is left alone. */
export function rebaseLinks(markdown: string, fromDir: string, toDir: string): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(MD_LINK, (whole: string, href: string) => {
        if (!isRelativeLink(href)) return whole;
        const hashAt = href.indexOf('#');
        const rel = hashAt === -1 ? href : href.slice(0, hashAt);
        const hash = hashAt === -1 ? '' : href.slice(hashAt);
        let rebased = toPosix(path.relative(toDir, path.resolve(fromDir, rel)));
        if (!rebased.startsWith('.')) rebased = `./${rebased}`;
        return `](${rebased}${hash})`;
      });
    })
    .join('\n');
}

export function insertBanner(markdown: string, sourceRel: string): string {
  const banner = `::: info Generated page\nGenerated from \`${sourceRel}\` — edit the source, not this page.\n:::\n`;
  const lines = markdown.split('\n');
  const first = lines[0];
  if (first !== undefined && first.startsWith('# ')) {
    return [first, '', banner, ...lines.slice(1)].join('\n');
  }
  return `${banner}\n${markdown}`;
}

function codeSpan(s: string): string {
  return s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``;
}

export interface ScriptEntry {
  name: string;
  command: string;
}

export interface ScriptGroup {
  title: string;
  scripts: ScriptEntry[];
}

export function groupScripts(scripts: Record<string, string>): ScriptGroup[] {
  const groups = new Map<string, ScriptEntry[]>();
  for (const name of Object.keys(scripts).sort()) {
    const colon = name.indexOf(':');
    const title = colon === -1 ? 'General' : name.slice(0, colon);
    const list = groups.get(title) ?? [];
    list.push({ name, command: scripts[name] ?? '' });
    groups.set(title, list);
  }
  const titles = [...groups.keys()].sort((a, b) => {
    if (a === 'General') return -1;
    if (b === 'General') return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return titles.map((title) => ({ title, scripts: groups.get(title) ?? [] }));
}

export function renderScriptsPage(groups: ScriptGroup[]): string {
  const out = [
    '# pnpm scripts',
    '',
    'Every script in the root `package.json`, grouped by name prefix. Run one with `pnpm <name>` from the repository root.',
    '',
  ];
  for (const g of groups) {
    out.push(`## ${g.title}`, '');
    for (const s of g.scripts) out.push(`- ${codeSpan(s.name)} — ${codeSpan(s.command)}`);
    out.push('');
  }
  return out.join('\n');
}

export interface EnvEntry {
  key: string;
  value: string;
  comment: string;
  optional: boolean;
}

export interface EnvSection {
  title: string;
  entries: EnvEntry[];
}

const SECTION = /^#\s*-{2,}\s*(.+?)\s*-{2,}\s*$/;
const ASSIGN = /^([A-Z][A-Z0-9_]*)=(.*)$/;
const COMMENTED_ASSIGN = /^#\s?([A-Z][A-Z0-9_]*)=(.*)$/;
const RULE_LINE = /^[─━═\-]+$/;

export function isSecretKey(key: string): boolean {
  return /SECRET|PASSWORD|KEY|TOKEN/i.test(key);
}

/** Value as shown on the page: secret keys blank, `scheme://user:pass@` credentials masked. */
export function displayValue(key: string, value: string): string {
  if (isSecretKey(key)) return '';
  return value.replace(/(:\/\/[^/:@\s]+:)[^/@\s]+@/g, '$1****@');
}

export function parseEnvExample(text: string): EnvSection[] {
  const sections: EnvSection[] = [];
  let current: EnvSection = { title: 'General', entries: [] };
  let pending: string[] = [];
  const flush = (): void => {
    if (current.entries.length > 0) sections.push(current);
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      pending = [];
      continue;
    }
    const section = SECTION.exec(line);
    if (section) {
      flush();
      current = { title: section[1] ?? '', entries: [] };
      pending = [];
      continue;
    }
    const assign = ASSIGN.exec(line);
    const commented = assign ? null : COMMENTED_ASSIGN.exec(line);
    const match = assign ?? commented;
    if (match) {
      const key = match[1] ?? '';
      current.entries.push({
        key,
        value: displayValue(key, match[2] ?? ''),
        comment: pending.join(' '),
        optional: commented !== null,
      });
      pending = [];
      continue;
    }
    if (line.startsWith('#')) {
      const t = line.replace(/^#+\s?/, '').trim();
      if (t !== '' && !RULE_LINE.test(t)) pending.push(t);
    }
  }
  flush();
  return sections;
}

export function renderEnvPage(sections: EnvSection[]): string {
  const out = [
    '# Environment variables',
    '',
    'Every variable in `.env.example`, grouped by its own sections. Values are the template defaults; secret-looking keys are shown empty and credentials inside URLs are masked. Copy `.env.example` to `.env` and edit there.',
    '',
  ];
  for (const s of sections) {
    out.push(`## ${s.title}`, '');
    for (const e of s.entries) {
      const value = e.value === '' ? '*(empty)*' : codeSpan(e.value);
      const optional = e.optional ? ' *(optional — commented out in the template)*' : '';
      out.push(`- ${codeSpan(e.key)} = ${value}${optional}`);
      if (e.comment !== '') out.push(`  ${e.comment}`);
    }
    out.push('');
  }
  return out.join('\n');
}

function repoFile(repoRoot: string, repoRel: string): string {
  return path.join(repoRoot, ...repoRel.split('/'));
}

/** Validate every input first, then replace docs/_generated/ wholesale. */
export function runGather(repoRoot: string): { written: string[] } {
  for (const g of GATHERED) {
    if (!fs.existsSync(repoFile(repoRoot, g.source))) {
      throw new GatherError(`Gathered source missing: ${g.source}`);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(repoFile(repoRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  if (!pkg.scripts || Object.keys(pkg.scripts).length === 0) {
    throw new GatherError('package.json has no scripts');
  }
  const envPath = repoFile(repoRoot, '.env.example');
  if (!fs.existsSync(envPath)) throw new GatherError('Gathered source missing: .env.example');
  const envSections = parseEnvExample(fs.readFileSync(envPath, 'utf8'));
  if (envSections.length === 0) throw new GatherError('.env.example has no variables');

  const generatedDir = path.join(repoRoot, 'docs', GENERATED_DIR_NAME);
  rimrafSync(generatedDir);
  fs.mkdirSync(generatedDir, { recursive: true });

  const written: string[] = [];
  const write = (name: string, content: string): void => {
    fs.writeFileSync(path.join(generatedDir, name), content.endsWith('\n') ? content : `${content}\n`);
    written.push(`${GENERATED_DIR_NAME}/${name}`);
  };

  for (const g of GATHERED) {
    const src = repoFile(repoRoot, g.source);
    const text = fs.readFileSync(src, 'utf8');
    write(g.target, insertBanner(rebaseLinks(text, path.dirname(src), generatedDir), g.source));
  }
  write('scripts.md', insertBanner(renderScriptsPage(groupScripts(pkg.scripts)), 'package.json'));
  write('env.md', insertBanner(renderEnvPage(envSections), '.env.example'));
  return { written };
}
```

`apps/docs-site/scripts/gather.ts`:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGather } from '../src/gather';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

try {
  const { written } = runGather(repoRoot);
  console.log(`docs-site gather: wrote ${written.length} pages to docs/_generated/`);
} catch (err) {
  console.error(`docs-site gather failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter docs-site test && pnpm --filter docs-site typecheck`
Expected: all manifest + gather tests PASS; typecheck exits 0.

- [ ] **Step 5: Run the real gather and inspect output**

Run: `pnpm --filter docs-site gather`
Expected: `docs-site gather: wrote 8 pages to docs/_generated/`.
Then: `grep -c 'kku_dev_password' docs/_generated/env.md` → `0`; `grep -n 'DATABASE_URL' docs/_generated/env.md` shows `postgresql://kku:****@…`; `git status --short` shows nothing under `docs/_generated/` (gitignored).

- [ ] **Step 6: Commit**

PII check first: `grep -nE '[0-9]{13}|0[0-9]{8,9}' apps/docs-site/src/gather.ts apps/docs-site/test/gather.test.ts apps/docs-site/scripts/gather.ts` → no output.

```bash
git add apps/docs-site/src/gather.ts apps/docs-site/scripts/gather.ts apps/docs-site/test/gather.test.ts
git commit -m "feat(docs-site): gather root docs and generate script and env references" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: markdown-it link plugin

**Files:**
- Create: `apps/docs-site/src/link-plugin.ts`
- Test: `apps/docs-site/test/link-plugin.test.ts`

**Interfaces:**
- Consumes (Task 1): `GATHERED`, `GENERATED_DIR_NAME`, `isExcluded`, `toPosix`.
- Produces:
  - `type LinkTarget = { kind: 'leave' } | { kind: 'href'; href: string } | { kind: 'repo-path'; repoRel: string }`
  - `classifyLink(href: string, pagePath: string, repoRoot: string): LinkTarget` — `pagePath` is the absolute path of the Markdown file being rendered
  - `interface LinkPluginOptions { repoRoot: string }`
  - `repoLinkPlugin(md: MarkdownIt, opts: LinkPluginOptions): void` — reads the page path from `env.path` (VitePress sets it to the absolute file path)

- [ ] **Step 1: Write the failing test**

`apps/docs-site/test/link-plugin.test.ts`:

```ts
import os from 'node:os';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { classifyLink, repoLinkPlugin } from '../src/link-plugin';

const repoRoot = path.join(os.tmpdir(), 'repo');
const md = new MarkdownIt({ html: true }).use(repoLinkPlugin, { repoRoot });
const page = (rel: string): { path: string } => ({ path: path.join(repoRoot, ...rel.split('/')) });
const render = (src: string, rel: string): string => md.render(src, page(rel));

describe('classifyLink', () => {
  it('leaves rendered docs pages, anchors, absolute and external links alone', () => {
    const p = page('docs/a.md').path;
    expect(classifyLink('./b.md', p, repoRoot)).toEqual({ kind: 'leave' });
    expect(classifyLink('#x', p, repoRoot)).toEqual({ kind: 'leave' });
    expect(classifyLink('/abs', p, repoRoot)).toEqual({ kind: 'leave' });
    expect(classifyLink('https://x.org/a.md', p, repoRoot)).toEqual({ kind: 'leave' });
  });

  it('routes a gathered file to its generated page and keeps the anchor', () => {
    const p = page('docs/data-sources/README.md').path;
    expect(classifyLink('../../prompts/14-integration-session-template.md#pre-session', p, repoRoot)).toEqual({
      kind: 'href',
      href: '../_generated/connector-session-template.md#pre-session',
    });
  });

  it('routes gathered-to-gathered links to the sibling copy', () => {
    const p = page('docs/_generated/readme.md').path;
    expect(classifyLink('../../DEPLOYMENT.md', p, repoRoot)).toEqual({ kind: 'href', href: './deployment.md' });
  });

  it('turns source files, excluded docs and folders into repo paths', () => {
    const p = page('docs/data-sources/README.md').path;
    expect(classifyLink('../../packages/shared/src/ingestion/catalog.ts', p, repoRoot)).toEqual({
      kind: 'repo-path',
      repoRel: 'packages/shared/src/ingestion/catalog.ts',
    });
    expect(classifyLink('./_template.md', p, repoRoot)).toEqual({
      kind: 'repo-path',
      repoRel: 'docs/data-sources/_template.md',
    });
  });

  it('decodes percent-encoding before classifying', () => {
    expect(classifyLink('../My%20File.md', page('docs/a.md').path, repoRoot)).toEqual({
      kind: 'repo-path',
      repoRel: 'My File.md',
    });
  });
});

describe('repoLinkPlugin rendering', () => {
  it('rewrites a gathered link href', () => {
    expect(render('[t](../../prompts/14-integration-session-template.md)', 'docs/data-sources/README.md')).toContain(
      'href="../_generated/connector-session-template.md"',
    );
  });

  it('renders a source link as text plus repo path code, without an anchor tag', () => {
    const html = render('[the catalog](../packages/shared/src/ingestion/catalog.ts)', 'docs/data-sources.md');
    expect(html).not.toContain('<a');
    expect(html).toContain(
      'the catalog (<code class="repo-path" title="Repository file — not part of this site">packages/shared/src/ingestion/catalog.ts</code>)',
    );
  });

  it('renders only the code path when the link text already is the path', () => {
    const html = render('[`LICENSE`](../LICENSE)', 'docs/licensing.md');
    expect(html).toContain('<code class="repo-path" title="Repository file — not part of this site">LICENSE</code>');
    expect(html.match(/LICENSE/g)?.length).toBe(1);
  });

  it('leaves rendered-page links untouched', () => {
    expect(render('[b](./b.md)', 'docs/a.md')).toContain('<a href="./b.md">b</a>');
  });

  it('does nothing to links when the page path is unknown', () => {
    expect(md.render('[x](../LICENSE)', {})).toContain('<a href="../LICENSE">x</a>');
  });

  it('escapes unknown or component-like tags but keeps safe HTML and comments', () => {
    const html = render(
      'refuses "<this student>" and <ProvenanceButton> but keeps <br> here\n\n<details><summary>More</summary>\n\nx\n\n</details>\n\n<!-- hidden note -->\n',
      'docs/a.md',
    );
    expect(html).toContain('&lt;this student&gt;');
    expect(html).toContain('&lt;ProvenanceButton&gt;');
    expect(html).toContain('<br>');
    expect(html).toContain('<details><summary>More</summary>');
    expect(html).toContain('<!-- hidden note -->');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter docs-site test -- link-plugin`
Expected: FAIL — `Failed to resolve import "../src/link-plugin"`.

- [ ] **Step 3: Write the implementation**

`apps/docs-site/src/link-plugin.ts`:

```ts
import path from 'node:path';
import type MarkdownIt from 'markdown-it';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type Token from 'markdown-it/lib/token.mjs';
import { GATHERED, GENERATED_DIR_NAME, isExcluded, toPosix } from './manifest';

export interface LinkPluginOptions {
  repoRoot: string;
}

export type LinkTarget =
  | { kind: 'leave' }
  | { kind: 'href'; href: string }
  | { kind: 'repo-path'; repoRel: string };

/** Lowercase HTML tags allowed through. Anything else (incl. `<Component>`) is escaped so Vue never compiles it. */
const SAFE_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'ol', 'p', 'pre', 's',
  'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'u', 'ul',
]);

const REPO_PATH_TITLE = 'Repository file — not part of this site';

export function classifyLink(href: string, pagePath: string, repoRoot: string): LinkTarget {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) {
    return { kind: 'leave' };
  }
  const hashAt = href.indexOf('#');
  const rel = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return { kind: 'leave' };
  }
  const pageDir = path.dirname(pagePath);
  const repoRel = toPosix(path.relative(repoRoot, path.resolve(pageDir, decoded)));
  if (repoRel === '' || repoRel.startsWith('..')) return { kind: 'leave' };

  const gathered = GATHERED.find((g) => g.source === repoRel);
  if (gathered) {
    const targetFile = path.join(repoRoot, 'docs', GENERATED_DIR_NAME, gathered.target);
    let rebased = toPosix(path.relative(pageDir, targetFile));
    if (!rebased.startsWith('.')) rebased = `./${rebased}`;
    return { kind: 'href', href: `${rebased}${hash}` };
  }
  if (repoRel.startsWith('docs/')) {
    const docsRel = repoRel.slice('docs/'.length);
    // A rendered page (or a missing .md, which VitePress's dead-link check must still catch).
    if (docsRel.endsWith('.md') && !isExcluded(docsRel)) return { kind: 'leave' };
  }
  return { kind: 'repo-path', repoRel };
}

function escapeUnsafeHtml(token: Token, md: MarkdownIt): void {
  const content = token.content;
  if (content.trimStart().startsWith('<!--')) return;
  const tag = /^\s*<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(content)?.[1];
  if (tag !== undefined && tag === tag.toLowerCase() && SAFE_TAGS.has(tag)) return;
  token.content = md.utils.escapeHtml(content);
}

function rewriteInline(
  children: Token[],
  pagePath: string | undefined,
  opts: LinkPluginOptions,
  state: StateCore,
  md: MarkdownIt,
): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < children.length; i++) {
    const tok = children[i];
    if (tok === undefined) continue;
    if (tok.type === 'html_inline') {
      escapeUnsafeHtml(tok, md);
      out.push(tok);
      continue;
    }
    if (tok.type !== 'link_open' || pagePath === undefined) {
      out.push(tok);
      continue;
    }
    const href = tok.attrGet('href');
    const target: LinkTarget = href === null ? { kind: 'leave' } : classifyLink(href, pagePath, opts.repoRoot);
    if (target.kind === 'leave') {
      out.push(tok);
      continue;
    }
    if (target.kind === 'href') {
      tok.attrSet('href', target.href);
      out.push(tok);
      continue;
    }
    // repo-path: drop link_open … link_close, keep the inner tokens, append the path as code.
    const inner: Token[] = [];
    let depth = 1;
    let j = i + 1;
    for (; j < children.length; j++) {
      const t = children[j];
      if (t === undefined) continue;
      if (t.type === 'link_open') depth++;
      if (t.type === 'link_close') {
        depth--;
        if (depth === 0) break;
      }
      if (t.type === 'html_inline') escapeUnsafeHtml(t, md);
      inner.push(t);
    }
    i = j;
    const code = new state.Token('code_inline', 'code', 0);
    code.content = target.repoRel;
    code.attrSet('class', 'repo-path');
    code.attrSet('title', REPO_PATH_TITLE);
    const text = inner.map((t) => t.content).join('').trim();
    if (text === '' || text === target.repoRel || target.repoRel.endsWith(`/${text}`)) {
      out.push(code);
    } else {
      const open = new state.Token('text', '', 0);
      open.content = ' (';
      const close = new state.Token('text', '', 0);
      close.content = ')';
      out.push(...inner, open, code, close);
    }
  }
  return out;
}

export function repoLinkPlugin(md: MarkdownIt, opts: LinkPluginOptions): void {
  md.core.ruler.push('repo_links', (state: StateCore) => {
    const pagePath = (state.env as { path?: unknown }).path;
    const page = typeof pagePath === 'string' ? pagePath : undefined;
    for (const block of state.tokens) {
      if (block.type === 'html_block') {
        escapeUnsafeHtml(block, md);
        continue;
      }
      if (block.children) block.children = rewriteInline(block.children, page, opts, state, md);
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter docs-site test && pnpm --filter docs-site typecheck`
Expected: all tests PASS; typecheck exits 0. If the `markdown-it/lib/*.mjs` type imports fail to resolve, switch both to `import type { StateCore, Token } from 'markdown-it';` (both are exported names in `@types/markdown-it@14`) and re-run.

- [ ] **Step 5: Commit**

```bash
git add apps/docs-site/src/link-plugin.ts apps/docs-site/test/link-plugin.test.ts
git commit -m "feat(docs-site): markdown-it plugin for repo links and unsafe HTML" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Curated sidebar and post-build checks

**Files:**
- Create: `apps/docs-site/.vitepress/sidebar.ts`, `apps/docs-site/src/check-site.ts`, `apps/docs-site/scripts/check-site.ts`
- Test: `apps/docs-site/test/check-site.test.ts`, `apps/docs-site/test/sidebar.test.ts`

**Interfaces:**
- Consumes (Task 1): `isExcluded`, `listRenderedPages`, `pageRoute`, `RETIRED_NAMES`, `RETIRED_NAME_ALLOWLIST`, `GENERATED_DIR_NAME`.
- Produces:
  - `.vitepress/sidebar.ts`: `buildSidebar(docsDir: string): DefaultTheme.SidebarItem[]`, `dataSourceItems(docsDir: string): DefaultTheme.SidebarItem[]`
  - `src/check-site.ts`: `interface SidebarLike { link?: string; items?: SidebarLike[] }`, `type ProblemKind = 'missing-from-sidebar' | 'sidebar-without-page' | 'retired-name'`, `interface SiteProblem { kind: ProblemKind; detail: string }`, `collectSidebarLinks(items: readonly SidebarLike[]): string[]`, `checkSidebarCoverage(routes: readonly string[], sidebarLinks: readonly string[]): SiteProblem[]`, `htmlRoute(distRel: string): string`, `findRetiredNames(htmlByRoute: ReadonlyMap<string, string>, allowlist?: readonly string[]): SiteProblem[]`

- [ ] **Step 1: Write the failing tests**

`apps/docs-site/test/check-site.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  checkSidebarCoverage,
  collectSidebarLinks,
  findRetiredNames,
  htmlRoute,
} from '../src/check-site';

describe('collectSidebarLinks', () => {
  it('walks nested groups', () => {
    expect(
      collectSidebarLinks([{ link: '/a' }, { items: [{ link: '/b' }, { items: [{ link: '/c' }] }] }]),
    ).toEqual(['/a', '/b', '/c']);
  });
});

describe('checkSidebarCoverage', () => {
  it('passes when routes and links match, ignoring the landing page', () => {
    expect(checkSidebarCoverage(['/', '/a', '/b'], ['/a', '/b'])).toEqual([]);
  });

  it('reports a rendered page missing from the sidebar, naming where to fix it', () => {
    const problems = checkSidebarCoverage(['/a', '/new-doc'], ['/a']);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe('missing-from-sidebar');
    expect(problems[0]?.detail).toContain('/new-doc');
    expect(problems[0]?.detail).toContain('sidebar.ts');
  });

  it('reports a sidebar entry with no page', () => {
    const problems = checkSidebarCoverage(['/a'], ['/a', '/gone']);
    expect(problems).toEqual([{ kind: 'sidebar-without-page', detail: 'sidebar links /gone but no such page exists' }]);
  });
});

describe('htmlRoute', () => {
  it('maps built files to routes', () => {
    expect(htmlRoute('index.html')).toBe('/');
    expect(htmlRoute('adopters/README.html')).toBe('/adopters/README');
  });
});

describe('findRetiredNames', () => {
  it('flags a retired name outside the allowlist and skips allowlisted pages', () => {
    const html = new Map([
      ['/architecture', '<p>Welcome to Curriculum Compass</p>'],
      ['/glossary-th-en', '<td>Curriculum Compass</td>'],
      ['/ok', '<p>Program Landscape</p>'],
    ]);
    expect(findRetiredNames(html)).toEqual([
      { kind: 'retired-name', detail: '/architecture contains retired name "Curriculum Compass"' },
    ]);
  });
});
```

`apps/docs-site/test/sidebar.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataSourceItems } from '../.vitepress/sidebar';

describe('dataSourceItems', () => {
  it('lists every per-source spec except README and the template, sorted', () => {
    const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-site-sidebar-'));
    fs.mkdirSync(path.join(docs, 'data-sources'));
    for (const f of ['README.md', '_template.md', 'tcas.md', 'kku-hr.md', 'notes.txt']) {
      fs.writeFileSync(path.join(docs, 'data-sources', f), '# x\n');
    }
    expect(dataSourceItems(docs)).toEqual([
      { text: 'kku-hr', link: '/data-sources/kku-hr' },
      { text: 'tcas', link: '/data-sources/tcas' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter docs-site test -- check-site sidebar`
Expected: FAIL — unresolved imports `../src/check-site` and `../.vitepress/sidebar`.

- [ ] **Step 3: Write the implementation**

`apps/docs-site/src/check-site.ts`:

```ts
import { RETIRED_NAMES, RETIRED_NAME_ALLOWLIST } from './manifest';

export interface SidebarLike {
  link?: string;
  items?: SidebarLike[];
}

export type ProblemKind = 'missing-from-sidebar' | 'sidebar-without-page' | 'retired-name';

export interface SiteProblem {
  kind: ProblemKind;
  detail: string;
}

export function collectSidebarLinks(items: readonly SidebarLike[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.link !== undefined) out.push(item.link);
    if (item.items) out.push(...collectSidebarLinks(item.items));
  }
  return out;
}

export function checkSidebarCoverage(routes: readonly string[], sidebarLinks: readonly string[]): SiteProblem[] {
  const links = new Set(sidebarLinks);
  const pages = new Set(routes);
  const problems: SiteProblem[] = [];
  for (const route of [...pages].sort()) {
    if (route !== '/' && !links.has(route)) {
      problems.push({
        kind: 'missing-from-sidebar',
        detail: `${route} is rendered but has no sidebar entry — add it to apps/docs-site/.vitepress/sidebar.ts, or to EXCLUDED in apps/docs-site/src/manifest.ts`,
      });
    }
  }
  for (const link of [...links].sort()) {
    if (!pages.has(link)) {
      problems.push({ kind: 'sidebar-without-page', detail: `sidebar links ${link} but no such page exists` });
    }
  }
  return problems;
}

/** 'index.html' → '/', 'adopters/README.html' → '/adopters/README' (POSIX input). */
export function htmlRoute(distRel: string): string {
  return `/${distRel.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1')}`;
}

export function findRetiredNames(
  htmlByRoute: ReadonlyMap<string, string>,
  allowlist: readonly string[] = RETIRED_NAME_ALLOWLIST,
): SiteProblem[] {
  const problems: SiteProblem[] = [];
  for (const route of [...htmlByRoute.keys()].sort()) {
    if (allowlist.includes(route)) continue;
    const html = htmlByRoute.get(route) ?? '';
    for (const name of RETIRED_NAMES) {
      if (html.includes(name)) {
        problems.push({ kind: 'retired-name', detail: `${route} contains retired name "${name}"` });
      }
    }
  }
  return problems;
}
```

`apps/docs-site/.vitepress/sidebar.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { DefaultTheme } from 'vitepress';
import { GENERATED_DIR_NAME, isExcluded } from '../src/manifest';

const gen = (name: string): string => `/${GENERATED_DIR_NAME}/${name}`;

/** One entry per docs/data-sources/*.md spec — new specs appear without editing this file. */
export function dataSourceItems(docsDir: string): DefaultTheme.SidebarItem[] {
  return fs
    .readdirSync(path.join(docsDir, 'data-sources'))
    .filter((f) => f.endsWith('.md') && f !== 'README.md' && !isExcluded(`data-sources/${f}`))
    .sort()
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      return { text: slug, link: `/data-sources/${slug}` };
    });
}

/** The adopter journey. Order follows the adopter guide's "suggested order of work". */
export function buildSidebar(docsDir: string): DefaultTheme.SidebarItem[] {
  return [
    {
      text: 'Start here',
      items: [
        { text: 'Adopter guide', link: '/adopters/README' },
        { text: 'Licensing', link: '/licensing' },
        { text: 'Fresh checkout setup', link: '/guides/fresh-checkout-setup' },
        { text: 'Architecture', link: '/architecture' },
        { text: 'Evaluation pipeline', link: '/evaluation-pipeline' },
        { text: 'Project contract & decision log', link: gen('project-contract') },
      ],
    },
    {
      text: 'Data integration',
      items: [
        { text: 'Ingestion framework', link: '/data-sources' },
        { text: 'Source catalogue', link: '/data-sources/README' },
        { text: 'Per-source specs', collapsed: true, items: dataSourceItems(docsDir) },
        { text: 'JobThai acknowledgement', link: '/acknowledgements/jobthai' },
        { text: 'Connector session template', link: gen('connector-session-template') },
        { text: 'Migration policy', link: '/migration-policy' },
        { text: 'DB indexes', link: '/db-indexes' },
        { text: 'Dev database safety', link: '/dev-database-safety' },
      ],
    },
    {
      text: 'Documents & PDFs',
      items: [
        { text: 'PDF ingestion', link: '/pdf-ingestion' },
        { text: 'PDF generation', link: '/pdf-generation' },
        { text: 'Gotenberg fonts', link: gen('gotenberg-fonts') },
        { text: 'MarkItDown', link: '/markitdown' },
      ],
    },
    {
      text: 'AI layer',
      items: [
        { text: 'AI governance', link: '/ai-governance' },
        { text: 'Prompt standard', link: '/prompt-standard' },
        { text: 'Evaluation & accuracy', link: '/methodologies/ai-extraction-accuracy' },
        { text: 'Trend monitors', link: '/trend-monitors' },
        { text: 'Dashboard chatbot tests', link: '/dashboard-chatbot-tests' },
      ],
    },
    {
      text: 'Methodologies',
      collapsed: true,
      items: [
        { text: 'Overview', link: '/methodologies/README' },
        { text: 'Health score', link: '/methodologies/health-score' },
        { text: 'Programme health & lifecycle', link: '/methodologies/program-health-and-lifecycle' },
        { text: 'Programme health & lifecycle (Thai)', link: '/methodologies/program-health-and-lifecycle.th' },
        { text: 'Risk scoring', link: '/methodologies/risk-scoring' },
        { text: 'Risk management', link: '/methodologies/risk-management' },
        { text: 'Forecasting', link: '/methodologies/forecasting' },
        { text: 'Scenario engine', link: '/methodologies/scenario-engine' },
        { text: 'Gap map', link: '/methodologies/gap-map' },
        { text: 'Programme overlap', link: '/methodologies/program-overlap' },
        { text: 'Landscape atlas', link: '/methodologies/landscape-atlas' },
        { text: 'Cost allocation', link: '/methodologies/cost-allocation' },
        { text: 'Evaluations', link: '/methodologies/evaluations' },
        { text: 'Class GPA', link: '/methodologies/class-gpa' },
        { text: 'Cross-scope consistency', link: '/methodologies/cross-scope-consistency' },
        { text: 'Verdict stability', link: '/methodologies/verdict-stability' },
      ],
    },
    {
      text: 'UI & branding',
      items: [
        { text: 'Design system', link: '/design-system' },
        { text: 'Profile page', link: '/profile-page' },
        { text: 'Glossary TH–EN', link: '/glossary-th-en' },
      ],
    },
    {
      text: 'Auth, security & privacy',
      items: [
        { text: 'KKU SSO', link: '/auth/kku-sso' },
        { text: 'RBAC', link: '/auth/rbac' },
        { text: 'Security review', link: '/security-review' },
        { text: 'PDPA', link: '/pdpa' },
        { text: 'DSAR workflow', link: '/dsar-workflow' },
      ],
    },
    {
      text: 'Deploy & operate',
      items: [
        { text: 'Deployment', link: gen('deployment') },
        { text: 'Production infrastructure', link: '/production-infrastructure' },
        { text: 'Network integration', link: '/deployment/kku-network-integration' },
        { text: 'Backup & DR', link: '/backup-dr' },
        { text: 'Admin runbook', link: '/guides/admin-runbook' },
        { text: 'Readiness checklist', link: '/readiness-checklist' },
        { text: 'Rollout plan', link: '/rollout-plan' },
        { text: 'Security policy', link: gen('security-policy') },
      ],
    },
    {
      text: 'Integrations',
      items: [{ text: 'Staff Profile API', link: '/integrations/staff-profile-api' }],
    },
    {
      text: 'Reference',
      items: [
        { text: 'pnpm scripts', link: gen('scripts') },
        { text: 'Environment variables', link: gen('env') },
        { text: 'Repository README', link: gen('readme') },
      ],
    },
  ];
}
```

`apps/docs-site/scripts/check-site.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSidebar } from '../.vitepress/sidebar';
import { checkSidebarCoverage, collectSidebarLinks, findRetiredNames, htmlRoute } from '../src/check-site';
import { listRenderedPages, pageRoute, toPosix } from '../src/manifest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const docsDir = path.join(repoRoot, 'docs');
const distDir = path.resolve(here, '..', 'dist');

if (!fs.existsSync(distDir)) {
  console.error(`docs-site check: no build output at ${distDir} — run vitepress build first`);
  process.exitCode = 1;
} else {
  const routes = listRenderedPages(docsDir).map(pageRoute);
  const links = collectSidebarLinks(buildSidebar(docsDir));
  const html = new Map<string, string>();
  for (const rel of fs.readdirSync(distDir, { recursive: true, encoding: 'utf8' }).map(toPosix)) {
    if (!rel.endsWith('.html') || rel === '404.html') continue;
    html.set(htmlRoute(rel), fs.readFileSync(path.join(distDir, ...rel.split('/')), 'utf8'));
  }
  const problems = [...checkSidebarCoverage(routes, links), ...findRetiredNames(html)];
  if (problems.length > 0) {
    for (const p of problems) console.error(`docs-site check [${p.kind}]: ${p.detail}`);
    process.exitCode = 1;
  } else {
    console.log(`docs-site check: ${routes.length} pages, sidebar complete, no retired names`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter docs-site test && pnpm --filter docs-site typecheck`
Expected: all tests PASS; typecheck exits 0.

(Coverage of the *real* `docs/` tree is verified by the first full build in Task 5, Step 5 — `check-site.ts` needs the build output.)

- [ ] **Step 5: Commit**

```bash
git add apps/docs-site/.vitepress/sidebar.ts apps/docs-site/src/check-site.ts apps/docs-site/scripts/check-site.ts apps/docs-site/test/check-site.test.ts apps/docs-site/test/sidebar.test.ts
git commit -m "feat(docs-site): curated sidebar and post-build site checks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: VitePress config, theme, landing page, wiring and first full build

**Files:**
- Create: `apps/docs-site/.vitepress/config.ts`, `apps/docs-site/.vitepress/theme/index.ts`, `apps/docs-site/.vitepress/theme/custom.css`, `docs/index.md`
- Modify: root `package.json` (scripts), `docs/methodologies/README.md:26`, `README.md` (Scripts table), `docs/adopters/README.md` (§21 intro)

**Interfaces:**
- Consumes: `excludedGlobs` (Task 1), `repoLinkPlugin` (Task 3), `buildSidebar` (Task 4), the `site:*` scripts (Task 1), `gather` and `check-site` CLIs (Tasks 2, 4).
- Produces: `pnpm docs:dev`, `pnpm docs:build`, `pnpm docs:preview` at the repo root; static site in `apps/docs-site/dist/`.

- [ ] **Step 1: VitePress config**

`apps/docs-site/.vitepress/config.ts`:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';
import { repoLinkPlugin } from '../src/link-plugin';
import { excludedGlobs } from '../src/manifest';
import { buildSidebar } from './sidebar';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const docsDir = path.join(repoRoot, 'docs');

export default defineConfig({
  title: 'Program Landscape',
  titleTemplate: ':title · Developer manual',
  description: 'Developer manual for institutions adopting Program Landscape — KKU Curriculum Intelligence Platform.',
  srcDir: docsDir,
  srcExclude: excludedGlobs(),
  outDir: path.resolve(here, '..', 'dist'),
  cleanUrls: false,
  ignoreDeadLinks: false,
  lastUpdated: false,
  markdown: {
    config: (md) => {
      md.use(repoLinkPlugin, { repoRoot });
    },
  },
  vite: {
    // srcDir sits outside this package; let the dev server read it.
    server: { fs: { allow: [repoRoot] } },
  },
  themeConfig: {
    nav: [
      { text: 'Adopter guide', link: '/adopters/README' },
      { text: 'Scripts', link: '/_generated/scripts' },
      { text: 'Environment', link: '/_generated/env' },
    ],
    sidebar: buildSidebar(docsDir),
    search: { provider: 'local' },
    outline: [2, 3],
    footer: {
      message: 'Rendered from the repository’s docs/ folder. Licensed CC BY-NC-SA 4.0.',
    },
  },
});
```

If typecheck rejects `md.use(repoLinkPlugin, …)` because VitePress's bundled `MarkdownIt` type differs from `@types/markdown-it`, change `repoLinkPlugin`'s first parameter type to `MarkdownIt` imported as `import type { MarkdownRenderer } from 'vitepress'` **only in the config call** via a typed wrapper: `md.use((m: typeof md) => repoLinkPlugin(m as unknown as Parameters<typeof repoLinkPlugin>[0], { repoRoot }))`. Do not loosen the plugin's own types.

Also confirm VitePress passes the page's absolute path as `env.path` to markdown-it (smoke-test item 6 depends on it). If links in the built site are not rewritten, inspect `env` in the core rule, adapt the field read in `repoLinkPlugin`, and add a regression test.

- [ ] **Step 2: Theme**

`apps/docs-site/.vitepress/theme/index.ts`:

```ts
import DefaultTheme from 'vitepress/theme';
import './custom.css';

export default DefaultTheme;
```

`apps/docs-site/.vitepress/theme/custom.css` (VitePress's own variables need literal values; this file is not linted by the repo's TS colour rule):

```css
:root {
  --vp-font-family-base: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, sans-serif;
  --vp-font-family-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --vp-c-brand-1: #4f46e5;
  --vp-c-brand-2: #4338ca;
  --vp-c-brand-3: #3730a3;
}

.dark {
  --vp-c-brand-1: #a5b4fc;
  --vp-c-brand-2: #818cf8;
  --vp-c-brand-3: #6366f1;
}

/* Links to repository files the site does not render (see src/link-plugin.ts). */
.vp-doc code.repo-path::before {
  content: '⧉ ';
  opacity: 0.6;
}
```

- [ ] **Step 3: Landing page**

`docs/index.md`:

```md
---
layout: home
hero:
  name: Program Landscape
  text: Developer manual for adopting institutions
  tagline: Fork it, point it at your own data and run it, without losing the provenance and audit trail that make its numbers trustworthy.
  actions:
    - theme: brand
      text: Start with the adopter guide
      link: /adopters/README
    - theme: alt
      text: Fresh checkout setup
      link: /guides/fresh-checkout-setup
features:
  - title: Start
    details: What the platform is, the licence, the architecture and how the scores fit together.
    link: /adopters/README
  - title: Adapt your data
    details: The connector contract, the source catalogue and one spec per data source.
    link: /data-sources
  - title: Run it
    details: Pack-and-ship deployment, network integration, backups and day-to-day operations.
    link: /_generated/deployment
  - title: Reference
    details: Every pnpm script and environment variable, generated from the repository on each build.
    link: /_generated/scripts
---

Program Landscape is a decision-support platform for university councils. It scores academic programmes against demand, finances, quality and future skills, and every number carries its sources, freshness and methodology version.

The code is licensed **CC BY-NC-SA 4.0**: attribution, ShareAlike and non-commercial use are obligations, and the licence covers neither KKU's trademarks nor its data. Read [Licensing](./licensing.md) before you publish anything built from it.

This site renders the repository's `docs/` folder in place. To change a page, edit its Markdown file in the repository. Pages marked *Generated* are rebuilt from their source on every build.
```

- [ ] **Step 4: Fix the dead link and add the pointers**

In `docs/methodologies/README.md` line 26, replace

```
See [benchmarking.md](./benchmarking.md) (placeholder — extend from service comments)
```

with

```
No methodology doc yet — the formula is documented in the service comments of `packages/db/src/benchmarking.ts`
```

In `README.md`, in the Scripts table, insert after the `| \`pnpm check\` | … |` row:

```
| `pnpm docs:dev` | developer manual site (adopter docs) at `http://localhost:5173` |
| `pnpm docs:build` | build the manual to `apps/docs-site/dist/` and run its checks |
```

In `docs/adopters/README.md`, directly after the line `Read these when the situation calls for it, not front to back.` under `## 21. Appendix — documentation map`, add a blank line and:

```
Everything below is also browsable and searchable offline as the developer manual site: run `pnpm docs:dev` from the repository root.
```

In the root `package.json` `scripts`, add after `"check"`:

```json
"docs:dev": "pnpm --filter docs-site site:dev",
"docs:build": "pnpm --filter docs-site site:build",
"docs:preview": "pnpm --filter docs-site site:preview",
```

- [ ] **Step 5: First full build**

Run: `pnpm docs:build`
Expected: gather prints `wrote 8 pages`, VitePress builds without dead links, then `docs-site check: N pages, sidebar complete, no retired names` and exit 0.

If it fails, fix by failure class — never by adding `ignoreDeadLinks` or exclusions just to go green:
- **Dead link to a docs page that moved:** correct the link in the source doc (`docs: fix … link` commit).
- **Dead link to something the plugin should have converted:** add a failing case to `test/link-plugin.test.ts`, fix `classifyLink`, re-run.
- **Vue compile error (`Element is missing end tag`, `Invalid end tag`, interpolation):** add the offending snippet as a failing case to the HTML-escaping test, fix `escapeUnsafeHtml`, re-run. For `{{` in prose, wrap the text in backticks in the source doc.
- **`missing-from-sidebar`:** add the page to `sidebar.ts`; if it is a working document, add it to `EXCLUDED` instead.

- [ ] **Step 6: Run the whole repo's gates**

Run: `pnpm lint && pnpm typecheck && pnpm --filter docs-site test`
Expected: all exit 0. (Full `pnpm test` needs no services for this package; the other packages' suites are unchanged by this work.)

- [ ] **Step 7: Manual smoke test**

Run: `pnpm docs:preview` and open the printed URL. Verify and note results for the merge/PR description:
1. The landing page shows four feature cards; each link opens a page.
2. Search (`/` or Ctrl+K) for `realDataWhere` returns the adopter guide and decision-log hits.
3. Adopter guide: click three table-of-contents anchors (e.g. §9, §14, §21); each scrolls to its heading.
4. Toggle dark mode; the accent and text stay readable.
5. *Deployment* shows the "Generated from `DEPLOYMENT.md`" banner under its title.
6. On *Source catalogue*, the link to the registry renders as a `⧉ apps/ingestion/src/connectors/registry.ts` code path, and the session-template link opens the generated page.
7. *Environment variables* shows `DATABASE_URL` with `****` in place of the password.

Stop the preview server.

- [ ] **Step 8: Commit**

PII check first: `grep -nE '[0-9]{13}|0[0-9]{8,9}' docs/index.md apps/docs-site/.vitepress/config.ts apps/docs-site/.vitepress/theme/custom.css` → no output.

```bash
git add apps/docs-site/.vitepress/config.ts apps/docs-site/.vitepress/theme docs/index.md package.json
git commit -m "feat(docs-site): VitePress config, theme and landing page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git add docs/methodologies/README.md README.md docs/adopters/README.md
git commit -m "docs: point to the developer manual site and fix a dead methodology link" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Hand back**

Report the smoke-test results, then ask the user to choose: merge `feat/docs-site` into `develop`, open a PR, or keep the branch. After that is done, remove the worktree with `git worktree remove ../program-landscape-docs-site` (run from the main checkout).
