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
    expect(classifyLink('../../SECURITY.md', p, repoRoot)).toEqual({ kind: 'href', href: './security-policy.md' });
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

  it('turns links to pages taken off the site (KKU-only, CLAUDE.md, DEPLOYMENT.md) into repo paths', () => {
    const p = page('docs/adopters/README.md').path;
    expect(classifyLink('../auth/kku-sso.md', p, repoRoot)).toEqual({ kind: 'repo-path', repoRel: 'docs/auth/kku-sso.md' });
    expect(classifyLink('../../CLAUDE.md', p, repoRoot)).toEqual({ kind: 'repo-path', repoRel: 'CLAUDE.md' });
    expect(classifyLink('../../DEPLOYMENT.md', p, repoRoot)).toEqual({ kind: 'repo-path', repoRel: 'DEPLOYMENT.md' });
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

  it('escapes an unsafe tag nested inside a safe html block', () => {
    const html = render('<div>\n<ProvenanceButton>\n</div>\n', 'docs/a.md');
    expect(html).toContain('<div>');
    expect(html).toContain('&lt;ProvenanceButton&gt;');
    expect(html).toContain('</div>');
  });

  it('escapes only the unsafe tag inside a details block', () => {
    const html = render('<details>\n<summary>x</summary>\nsee <Foo bar="1">\n</details>\n', 'docs/a.md');
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>x</summary>');
    expect(html).toContain('&lt;Foo bar=&quot;1&quot;&gt;');
  });

  it('leaves a comment containing a tag untouched', () => {
    expect(render('<!-- <Foo> -->\n', 'docs/a.md')).toContain('<!-- <Foo> -->');
  });
});

describe('workshop pages open other pages in a new tab', () => {
  const NEW_TAB = 'target="_blank" rel="noopener"';

  it('adds target=_blank to a link from a workshop page to another page', () => {
    expect(render('[s](./01-session.md)', 'docs/workshop/00-before.md')).toContain(
      `<a href="./01-session.md" ${NEW_TAB}>s</a>`,
    );
    expect(render('[g](../tutorials/getting-started.md#1-check)', 'docs/workshop/00-before.md')).toContain(
      `<a href="../tutorials/getting-started.md#1-check" ${NEW_TAB}>g</a>`,
    );
  });

  it('applies to a gathered page and to an absolute site link', () => {
    expect(render('[c](../../SECURITY.md)', 'docs/workshop/02.md')).toContain(NEW_TAB);
    expect(render('[r](/tutorials/README)', 'docs/workshop/02.md')).toContain(NEW_TAB);
  });

  it('keeps same-page anchors in the current tab', () => {
    const html = render('[x](#goal)', 'docs/workshop/01.md');
    expect(html).toContain('<a href="#goal">x</a>');
    expect(html).not.toContain('_blank');
  });

  it('leaves links on pages outside the workshop alone', () => {
    expect(render('[b](./b.md)', 'docs/tutorials/a.md')).toContain('<a href="./b.md">b</a>');
  });

  it('does not turn a repository path into a link', () => {
    expect(render('[s](../../apps/api/src/x.ts)', 'docs/workshop/02.md')).not.toContain('<a ');
  });

  it('lets an installed link renderer rewrite the href before target is added', () => {
    // Stands in for VitePress, whose renderer skips links that already have a target.
    const vp = new MarkdownIt({ html: true });
    vp.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
      const tok = tokens[idx];
      const href = tok?.attrGet('href');
      if (tok && href && tok.attrGet('target') === null) tok.attrSet('href', href.replace(/\.md/, '.html'));
      return self.renderToken(tokens, idx, options);
    };
    vp.use(repoLinkPlugin, { repoRoot });
    expect(vp.render('[s](./01.md#goal)', page('docs/workshop/00.md'))).toContain(
      `<a href="./01.html#goal" ${NEW_TAB}>s</a>`,
    );
  });
});
