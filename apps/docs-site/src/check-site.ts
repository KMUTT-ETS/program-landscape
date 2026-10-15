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
