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
  // KKU's own installation: not instructions for an adopting institution.
  'auth/kku-sso.md',
  'deployment/kku-network-integration.md',
  'production-infrastructure.md',
  'rollout-plan.md',
  'dashboard-chatbot-tests.md',
  'acknowledgements/jobthai.md',
  'guides/admin-runbook.md',
];

/**
 * English pages that must have a Thai twin (`<name>.th.md` next to them). check-site verifies
 * each twin exists, mirrors the English structure and links both ways.
 */
export const BILINGUAL_PAGES: readonly string[] = [
  'adopters/README.md',
  'tutorials/README.md',
  'tutorials/getting-started.md',
  'tutorials/program-deep-dive.md',
  'data-import.md',
  'workshop/README.md',
  'guides/windows-wsl2.md',
  'workshop/00-before-the-day.md',
  'workshop/01-environment-and-ai-tools.md',
  'workshop/02-architecture-and-source.md',
  'workshop/03-university-data.md',
  'workshop/06-testing-and-security.md',
  'workshop/troubleshooting.md',
  'workshop/facilitator.md',
];

/**
 * Pages under these docs folders open every link to ANOTHER page in a new tab,
 * so a reader working through a step-by-step page keeps their place. Links to a
 * heading on the same page stay in the current tab.
 */
export const NEW_TAB_DOC_PREFIXES: readonly string[] = ['workshop/'];

/** 'adopters/README.md' -> 'adopters/README.th.md'. */
export function twinOf(docsRel: string): string {
  return docsRel.replace(/\.md$/, '.th.md');
}

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

/**
 * Files outside docs/ that the site needs. Copied (never edited) by gather.ts.
 * CLAUDE.md (internal project contract) and DEPLOYMENT.md (KKU's on-prem runbook) are
 * deliberately NOT gathered; links to them render as repository links.
 */
export const GATHERED: readonly GatheredFile[] = [
  { source: 'README.md', target: 'readme.md' },
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
  '/glossary-th-en',
  '/adopters/README',
  '/adopters/README.th',
];

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * True when `id` (a native path or a Vite module id, which is always '/'-separated) lies inside
 * `dir`. Both separators are normalised explicitly so the answer is the same on every platform.
 */
export function isUnderDir(id: string, dir: string): boolean {
  const prefix = dir.replace(/\\/g, '/').replace(/\/*$/, '/');
  return id.replace(/\\/g, '/').startsWith(prefix);
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
