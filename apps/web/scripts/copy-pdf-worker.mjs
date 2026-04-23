#!/usr/bin/env node
// Copies the pdfjs-dist worker into /public so the /admin/pdf-review
// viewer can load it as a plain static asset. This sidesteps two
// unrelated issues with react-pdf in Next.js:
//   1. If we reference the worker via `new URL(..., import.meta.url)`,
//      Next bundles + Terser-minifies it and chokes on ES module
//      syntax in the already-minified worker.
//   2. On-prem KKU can't reach unpkg.com at runtime, so the common
//      CDN workerSrc pattern is a non-starter.
//
// Runs as `prebuild` — every `next build` refreshes the copy. We
// version the filename by the pdfjs-dist version so caches bust
// automatically when the dep bumps.

import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');
mkdirSync(publicDir, { recursive: true });

const require = createRequire(import.meta.url);
// resolve pdfjs-dist from this workspace's node_modules
const pkgJsonPath = require.resolve('pdfjs-dist/package.json');
const { version } = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
const workerSrc = path.join(path.dirname(pkgJsonPath), 'build', 'pdf.worker.min.mjs');

// Clean stale worker files from prior versions.
for (const entry of readdirSync(publicDir)) {
  if (entry.startsWith('pdf.worker.') && entry.endsWith('.mjs')) {
    unlinkSync(path.join(publicDir, entry));
  }
}

const targetName = `pdf.worker.${version}.mjs`;
copyFileSync(workerSrc, path.join(publicDir, targetName));
// eslint-disable-next-line no-console
console.log(`copy-pdf-worker: /public/${targetName}`);
