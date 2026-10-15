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
