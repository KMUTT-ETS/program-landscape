#!/usr/bin/env node
// Builds the workshop pre-fetch kit: the files a participant needs to
// download every npm package and build every Docker image BEFORE they receive
// the source code. Output: workshop/pre-fetch/dist/program-landscape-prefetch/
// and a .tar.gz of it next to it. See workshop/pre-fetch/README.md.
//
// Usage: pnpm workshop:prefetch-kit

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const kitName = 'program-landscape-prefetch';
const distDir = path.join(here, 'dist');
const outDir = path.join(distDir, kitName);
const archive = path.join(distDir, `${kitName}.tar.gz`);

// Everything copied from the repository. Nothing here is application code:
// the lockfile lists dependencies, infra/* holds the three locally built
// Docker images (Dockerfiles, fonts, Postgres init SQL, the markitdown
// sidecar's server.py).
const FROM_REPO = [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'docker-compose.yml',
  path.join('infra', 'postgres'),
  path.join('infra', 'gotenberg'),
  path.join('infra', 'markitdown'),
];

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function git(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function hashPaths(rels) {
  const h = createHash('sha256');
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs).sort()) walk(path.join(rel, name));
    } else {
      h.update(rel.split(path.sep).join('/'));
      h.update(readFileSync(abs));
    }
  };
  rels.forEach(walk);
  return h.digest('hex').slice(0, 16);
}

const rootPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!rootPkg.packageManager) fail('root package.json has no packageManager field');

// pnpm-workspace.yaml names patch files; `pnpm fetch` needs them present.
const workspaceYaml = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
const patchFiles = [...workspaceYaml.matchAll(/"(patches\/[^"]+)"/g)].map((m) => m[1]);
for (const p of patchFiles) {
  if (!existsSync(path.join(root, p))) fail(`pnpm-workspace.yaml names ${p}, which does not exist`);
}

const included = [...FROM_REPO, ...patchFiles.map((p) => path.join(...p.split('/')))];
for (const rel of included) {
  if (!existsSync(path.join(root, rel))) fail(`missing ${rel}`);
}

// Warn when the kit would not match what is committed: participants clone
// the committed code, so a kit built from uncommitted edits goes stale.
const dirty = git(['status', '--porcelain', '--', ...included.map((p) => p.split(path.sep).join('/'))]);
if (dirty) {
  console.warn('⚠ Uncommitted changes in files that go into the kit:\n' + dirty);
  console.warn('  Participants will clone the committed version. Commit first, or expect a mismatch.\n');
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const rel of included) {
  cpSync(path.join(root, rel), path.join(outDir, rel), { recursive: true });
}
cpSync(path.join(here, 'kit'), outDir, { recursive: true });

// A stub package.json: just enough for `pnpm fetch` to pick the pinned pnpm
// version and the same build-script allowlist as the real project.
const stub = {
  name: kitName,
  private: true,
  description: 'Pre-fetches Program Landscape dependencies and Docker images before the workshop.',
  packageManager: rootPkg.packageManager,
  engines: rootPkg.engines,
  pnpm: rootPkg.pnpm,
};
writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(stub, null, 2) + '\n');

const lockHash = hashPaths(['pnpm-lock.yaml', ...patchFiles.map((p) => path.join(...p.split('/')))]);
const imageHash = hashPaths(['docker-compose.yml', ...FROM_REPO.filter((p) => p.startsWith('infra'))]);
const version = [
  `Program Landscape pre-fetch kit`,
  `built:          ${new Date().toISOString()}`,
  `branch:         ${git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown'}`,
  `commit:         ${git(['rev-parse', 'HEAD']) || 'unknown'}`,
  `packageManager: ${rootPkg.packageManager}`,
  `packages hash:  ${lockHash}   (pnpm-lock.yaml + patches)`,
  `images hash:    ${imageHash}   (docker-compose.yml + infra/postgres, gotenberg, markitdown)`,
  '',
].join('\n');
writeFileSync(path.join(outDir, 'KIT-VERSION.txt'), version);

const tar = spawnSync('tar', ['-czf', archive, '-C', distDir, kitName], { stdio: 'inherit' });
if (tar.status !== 0) fail('tar failed; the kit folder is still at ' + outDir);

const sizeMb = (statSync(archive).size / 1e6).toFixed(1);
console.log(version);
console.log(`✓ Kit folder:  ${outDir}`);
console.log(`✓ Archive:     ${archive} (${sizeMb} MB)`);
console.log('\nSend the archive to participants. To know later whether a kit is stale,');
console.log('rebuild it and compare the two hashes in KIT-VERSION.txt.');
