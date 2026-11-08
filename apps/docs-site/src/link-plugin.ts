import path from 'node:path';
import type MarkdownIt from 'markdown-it';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type Token from 'markdown-it/lib/token.mjs';
import { GATHERED, GENERATED_DIR_NAME, NEW_TAB_DOC_PREFIXES, isExcluded, toPosix } from './manifest';

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

/** True when links on this page that lead to another page should open in a new tab. */
export function opensLinksInNewTab(pagePath: string, repoRoot: string): boolean {
  const docsRel = toPosix(path.relative(path.join(repoRoot, 'docs'), pagePath));
  return NEW_TAB_DOC_PREFIXES.some((prefix) => docsRel.startsWith(prefix));
}

/**
 * Marker set in the core rule and turned into target/rel at render time.
 * Setting `target` directly is not enough: VitePress's link renderer skips any
 * link that already has a target, so the .md → .html rewrite and the dead-link
 * check would never run for it.
 */
const NEW_TAB_MARKER = 'data-new-tab';

function markNewTab(tok: Token): void {
  tok.attrSet(NEW_TAB_MARKER, '1');
}

/** Escape every tag that is not a lowercase SAFE_TAGS member; HTML comments pass through verbatim. */
function escapeUnsafeHtml(token: Token, md: MarkdownIt): void {
  token.content = token.content
    .split(/(<!--[\s\S]*?-->)/)
    .map((part) =>
      part.startsWith('<!--')
        ? part
        : part.replace(/<\/?([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g, (match, tag: string) =>
            tag === tag.toLowerCase() && SAFE_TAGS.has(tag) ? match : md.utils.escapeHtml(match),
          ),
    )
    .join('');
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
    // Same-page anchors stay put; external links already open in a new tab.
    const newTab = href !== null && !href.startsWith('#') && opensLinksInNewTab(pagePath, opts.repoRoot);
    if (target.kind === 'leave') {
      if (newTab) markNewTab(tok);
      out.push(tok);
      continue;
    }
    if (target.kind === 'href') {
      tok.attrSet('href', target.href);
      if (newTab) markNewTab(tok);
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
  // Wrap whatever link renderer is installed (VitePress's, when this plugin is
  // registered from markdown.config, which runs after the built-in plugins).
  // The original runs first, without a target, so it rewrites the href; then
  // the marked link is rendered again with target/rel added.
  const original = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const tok = tokens[idx];
    const marked = tok !== undefined && tok.attrGet(NEW_TAB_MARKER) !== null;
    if (marked) tok.attrs = (tok.attrs ?? []).filter(([name]) => name !== NEW_TAB_MARKER);
    const html = original ? original(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    if (!marked || tok === undefined || tok.attrGet('target') !== null) return html;
    tok.attrSet('target', '_blank');
    tok.attrSet('rel', 'noopener');
    return self.renderToken(tokens, idx, options);
  };
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
