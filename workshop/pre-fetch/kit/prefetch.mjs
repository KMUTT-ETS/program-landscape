#!/usr/bin/env node
// Program Landscape workshop — pre-fetch.
//
// Downloads every npm package into your pnpm store and builds/pulls every
// Docker image the app needs, so that on the workshop day `pnpm setup` in the
// real project downloads almost nothing.
//
//   node prefetch.mjs                 do everything (safe to re-run)
//   node prefetch.mjs --check         only check that everything is in place
//   node prefetch.mjs --skip-docker   packages only
//   node prefetch.mjs --skip-packages Docker images only

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const doPackages = !args.has('--skip-packages');
const doDocker = !args.has('--skip-docker');

const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));
const pinnedPnpm = pkg.packageManager.split('@')[1];
const minNode = (pkg.engines?.node ?? '>=24.22.1').replace(/[^\d.]/g, '');

const BUILT_IMAGES = [
  'program-landscape-postgres:dev',
  'program-landscape-gotenberg:dev',
  'program-landscape-markitdown:dev',
];
const PULLED_IMAGES = ['redis:7-alpine', 'cgr.dev/chainguard/minio:latest'];

const problems = [];
const say = (m) => console.log(m);
const ok = (m) => say(`  ✓ ${m}`);
const bad = (m, fix) => {
  say(`  ✗ ${m}${fix ? `\n      → ${fix}` : ''}`);
  problems.push(m);
};
const warn = (m) => say(`  ! ${m}`);

function run(cmd, cmdArgs, opts = {}) {
  return spawnSync(cmd, cmdArgs, { cwd: here, encoding: 'utf8', ...opts });
}
function runLoud(cmd, cmdArgs) {
  say(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: here, stdio: 'inherit' });
  return r.status === 0;
}
function versionAtLeast(have, want) {
  const a = have.split('.').map(Number);
  const b = want.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}
function stop() {
  say(`\n✗ ${problems.length} problem(s) above. Fix them and run this again.`);
  process.exit(1);
}

// ── 1. Environment ─────────────────────────────────────────────────────────
say('\n1. Checking your environment');

if (process.platform === 'win32') {
  bad(
    'You are running Windows Node.js. Run this inside WSL2 (the Ubuntu terminal).',
    'Open Ubuntu, copy the kit into your Linux home folder (~), and run it there.',
  );
  stop();
}

if (versionAtLeast(process.versions.node, minNode)) ok(`Node.js ${process.versions.node}`);
else bad(`Node.js ${process.versions.node} is too old`, `Install Node.js ${minNode} or later.`);

if (here.startsWith('/mnt/')) {
  bad(
    `This folder (${here}) is on the Windows disk.`,
    'Move the kit into your Linux home folder, e.g. ~/program-landscape-prefetch, and clone the project there on the day too. ' +
      'pnpm keeps one package store per disk, so a kit on C: would be wasted.',
  );
}

const pnpmV = run('pnpm', ['--version']);
if (pnpmV.status !== 0) {
  bad('pnpm is not available', 'Run: corepack enable   (then open a new terminal)');
} else if (pnpmV.stdout.trim() !== pinnedPnpm) {
  bad(
    `pnpm ${pnpmV.stdout.trim()} found, but the project uses ${pinnedPnpm}`,
    'Run: corepack enable   — corepack then picks the right version in this folder.',
  );
} else ok(`pnpm ${pinnedPnpm}`);

if (doDocker) {
  const dv = run('docker', ['version', '--format', '{{.Server.Version}}']);
  if (dv.status !== 0) {
    bad('Docker is not running (or not reachable from here)', 'Start Docker Desktop; on Windows enable WSL integration for Ubuntu.');
  } else ok(`Docker ${dv.stdout.trim()}`);

  const cv = run('docker', ['compose', 'version', '--short']);
  if (cv.status !== 0) bad('Docker Compose v2 is missing', 'Install Docker Compose v2 (included in Docker Desktop).');
  else ok(`Docker Compose ${cv.stdout.trim()}`);

  if (!checkOnly) {
    const info = run('docker', ['info']);
    if (info.status === 0 && !/Username:/.test(info.stdout)) {
      warn('You are not logged in to Docker Hub. Many people on one network share a pull limit.');
      warn('If a pull fails with "toomanyrequests", run `docker login` (free account) and run this again.');
    }
  }
}

if (problems.length) stop();

// ── 2. npm packages ────────────────────────────────────────────────────────
if (doPackages && !checkOnly) {
  say('\n2. Downloading npm packages into your pnpm store (~430 MB)');
  if (!runLoud('pnpm', ['fetch'])) bad('pnpm fetch failed', 'Check your connection and run this again; it resumes.');
}

// ── 3. Docker images ───────────────────────────────────────────────────────
if (doDocker && !checkOnly && !problems.length) {
  say('\n3. Building and pulling Docker images (~1.2 GB download)');
  if (!runLoud('docker', ['compose', 'build'])) bad('docker compose build failed', 'Run this again; finished layers are kept.');
  else if (!runLoud('docker', ['compose', 'pull', 'redis', 'minio'])) bad('docker compose pull failed', 'Run this again.');
}

if (problems.length) stop();

// ── 4. Verify ──────────────────────────────────────────────────────────────
say('\n4. Checking the result');

if (doPackages) {
  // --offline fails if any package in the lockfile is missing from the store.
  const r = run('pnpm', ['fetch', '--offline']);
  if (r.status === 0) ok('every npm package is in your pnpm store');
  else bad('some npm packages are missing from the store', 'Run: node prefetch.mjs --skip-docker');
}

if (doDocker) {
  for (const image of [...BUILT_IMAGES, ...PULLED_IMAGES]) {
    const r = run('docker', ['image', 'inspect', image, '--format', '{{.Size}}']);
    if (r.status === 0) ok(`${image} (${(Number(r.stdout.trim()) / 1e9).toFixed(2)} GB)`);
    else bad(`${image} is missing`, 'Run: node prefetch.mjs --skip-packages');
  }
}

if (problems.length) stop();

say(`
✓ All done. You are ready for the workshop.

  Please keep:   your pnpm store and these Docker images.
                 Do not run "pnpm store prune" or "docker system prune -a" before the workshop.
  Do not run:    "docker compose up" in this folder (it would block ports the app needs).
  You may delete this folder now; the downloads live outside it.
`);
