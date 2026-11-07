import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSidebar, buildThaiSidebar } from '../.vitepress/sidebar';
import { checkBilingualTwins, checkSidebarCoverage, collectSidebarLinks, findRetiredNames, htmlRoute } from '../src/check-site';
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
  const links = collectSidebarLinks([...buildSidebar(docsDir), ...buildThaiSidebar(docsDir)]);
  const html = new Map<string, string>();
  for (const rel of fs.readdirSync(distDir, { recursive: true, encoding: 'utf8' }).map(toPosix)) {
    if (!rel.endsWith('.html') || rel === '404.html') continue;
    html.set(htmlRoute(rel), fs.readFileSync(path.join(distDir, ...rel.split('/')), 'utf8'));
  }
  const problems = [...checkSidebarCoverage(routes, links), ...findRetiredNames(html), ...checkBilingualTwins(docsDir)];
  if (problems.length > 0) {
    for (const p of problems) console.error(`docs-site check [${p.kind}]: ${p.detail}`);
    process.exitCode = 1;
  } else {
    console.log(`docs-site check: ${routes.length} pages, sidebar complete, no retired names`);
  }
}
