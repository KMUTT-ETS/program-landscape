import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitepress';
import { repoLinkPlugin } from '../src/link-plugin';
import { excludedGlobs, isUnderDir } from '../src/manifest';
import { githubSlugify } from '../src/slugify';
import { buildSidebar } from './sidebar';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const docsDir = path.join(repoRoot, 'docs');

const vitepressEntry = createRequire(import.meta.url).resolve('vitepress');

/**
 * Pages live in docs/, outside this package, where pnpm's strict layout makes `vue` unresolvable.
 * VitePress aliases bare `vue` for the client build only; the SSR build imports `vue` and
 * `vue/server-renderer` from every compiled page. Resolve those as VitePress itself would, so the
 * pages and the theme share one Vue.
 */
function resolveVueForPages(): Plugin {
  return {
    name: 'docs-site:resolve-vue-for-pages',
    enforce: 'pre',
    resolveId(id, importer, options) {
      if (id !== 'vue' && !id.startsWith('vue/')) return null;
      if (importer === undefined || !isUnderDir(importer, docsDir)) return null;
      return this.resolve(id, vitepressEntry, { ...options, skipSelf: true });
    },
  };
}

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
    // The docs are written for GitHub; keep its heading anchors so their #links resolve here too.
    anchor: { slugify: githubSlugify },
    headers: { slugify: githubSlugify },
    config: (md) => {
      md.use(repoLinkPlugin, { repoRoot });
    },
  },
  vite: {
    // srcDir sits outside this package; let the dev server read it.
    server: { fs: { allow: [repoRoot] } },
    plugins: [resolveVueForPages()],
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
