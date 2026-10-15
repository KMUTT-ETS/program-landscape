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
