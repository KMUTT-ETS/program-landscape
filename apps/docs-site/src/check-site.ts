import fs from 'node:fs';
import path from 'node:path';
import { BILINGUAL_PAGES, RETIRED_NAMES, RETIRED_NAME_ALLOWLIST, THAI_DIR, twinOf } from './manifest';

export interface SidebarLike {
  link?: string;
  items?: SidebarLike[];
}

export type ProblemKind = 'missing-from-sidebar' | 'sidebar-without-page' | 'retired-name' | 'bilingual-twin' | 'page-shape' | 'wrong-language';

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
    if (route !== '/' && route !== `/${THAI_DIR}/` && !links.has(route)) {
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

/** `##` / `###` headings outside fenced code, in order. */
export function structuralHeadings(md: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (!fence && /^#{2,3} \S/.test(line)) out.push(line.trim());
  }
  return out;
}

/** Fenced code blocks, in order, as their raw inner text. */
export function fencedBlocks(md: string): string[] {
  const out: string[] = [];
  let cur: string[] | null = null;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      if (cur === null) cur = [];
      else {
        out.push(cur.join('\n'));
        cur = null;
      }
    } else if (cur !== null) cur.push(line);
  }
  return out;
}

/** True when one of the first 30 lines of `md` (the page at `fromRel`) links to the page `toRel`. */
function linksTo(md: string, fromRel: string, toRel: string): boolean {
  const top = md.split(/\r?\n/).slice(0, 30).join('\n');
  for (const m of top.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = (m[1] ?? '').replace(/#.*$/, '');
    if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
    if (path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), target)) === toRel) return true;
  }
  return false;
}

/** Structural comparison of an English page and its Thai twin. */
export function checkTwinPair(enRel: string, en: string, th: string | null): SiteProblem[] {
  const thRel = twinOf(enRel);
  const problem = (detail: string): SiteProblem => ({ kind: 'bilingual-twin', detail: `${enRel}: ${detail}` });
  if (th === null) return [problem(`Thai twin ${thRel} is missing`)];
  const problems: SiteProblem[] = [];
  const eh = structuralHeadings(en);
  const th2 = structuralHeadings(th);
  if (eh.length !== th2.length) {
    problems.push(problem(`heading drift — ${eh.length} ##/### headings in English, ${th2.length} in ${thRel}`));
  }
  const ec = fencedBlocks(en);
  const tc = fencedBlocks(th);
  if (ec.length !== tc.length) {
    problems.push(problem(`code drift — ${ec.length} fenced code blocks in English, ${tc.length} in ${thRel}`));
  } else {
    const i = ec.findIndex((b, n) => b !== tc[n]);
    if (i >= 0) problems.push(problem(`code drift — fenced code block ${i + 1} differs between English and ${thRel}`));
  }
  if (!linksTo(en, enRel, thRel)) {
    problems.push(problem(`the English page must link to ${thRel} near the top`));
  }
  if (!linksTo(th, thRel, enRel)) {
    problems.push(problem(`${thRel} must link back to ${enRel} near the top`));
  }
  return problems;
}

export function checkBilingualTwins(docsDir: string, pages: readonly string[] = BILINGUAL_PAGES): SiteProblem[] {
  const read = (rel: string): string | null => {
    const full = path.join(docsDir, ...rel.split('/'));
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  };
  return pages.flatMap((rel) => {
    const en = read(rel);
    if (en === null) return [{ kind: 'bilingual-twin' as const, detail: `${rel} is listed as bilingual but does not exist` }];
    return checkTwinPair(rel, en, read(twinOf(rel)));
  });
}

/** The markers every tutorial, guide and workshop page carries, per language. */
const PAGE_SHAPE_MARKERS = {
  en: { outcome: '**Outcome.**', next: '## Next step' },
  th: { outcome: '**ผลลัพธ์**', next: '## ขั้นต่อไป' },
} as const;

/** An outcome line within the first 20 lines, and a next-step heading. */
export function checkPageShape(docsRel: string, md: string): SiteProblem[] {
  const m = docsRel.startsWith(`${THAI_DIR}/`) ? PAGE_SHAPE_MARKERS.th : PAGE_SHAPE_MARKERS.en;
  const lines = md.split(/\r?\n/);
  const problems: SiteProblem[] = [];
  if (!lines.slice(0, 20).some((l) => l.startsWith(m.outcome))) {
    problems.push({ kind: 'page-shape', detail: `${docsRel} needs a paragraph starting ${m.outcome} in its first 20 lines` });
  }
  if (!lines.some((l) => l.trim() === m.next)) {
    problems.push({ kind: 'page-shape', detail: `${docsRel} needs a "${m.next}" section` });
  }
  return problems;
}

/**
 * A Thai page must not send its reader to an English page that has a Thai twin. The one allowed
 * English link is the banner back to the page's own English twin.
 */
export function checkThaiLinks(thRel: string, md: string, exists: (docsRel: string) => boolean): SiteProblem[] {
  const ownEnglish = thRel.slice(THAI_DIR.length + 1);
  const problems: SiteProblem[] = [];
  let fence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = (m[1] ?? '').replace(/#.*$/, '');
      if (!target.endsWith('.md') || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(thRel), target));
      if (rel.startsWith(`${THAI_DIR}/`) || rel.startsWith('..') || rel === ownEnglish) continue;
      if (exists(`${THAI_DIR}/${rel}`)) {
        problems.push({
          kind: 'wrong-language',
          detail: `${thRel} links the English ${rel}; link the Thai ${THAI_DIR}/${rel} instead`,
        });
      }
    }
  }
  return problems;
}
