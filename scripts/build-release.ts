#!/usr/bin/env node
// Build a pack-and-ship release bundle.
//
//   pnpm build:release <version>
//
// Produces a single self-contained .tar.gz at
//   dist/program-landscape-<version>.tar.gz
// plus a SHA-256 checksum at
//   dist/program-landscape-<version>.tar.gz.sha256
//
// The bundle contains everything the prod Ubuntu server needs:
//   - images.tar          — docker save of the 4 app images
//   - docker-compose.yml  — production compose
//   - infra/nginx/        — nginx conf + conf.d (certs are per-host)
//   - infra/postgres/     — init SQL (extensions)
//   - scripts/            — deploy, rollback, backup, restore, smoke,
//                           generate-self-signed-cert
//   - .env.prod.example   — template
//   - DEPLOYMENT.md       — runbook
//   - VERSION             — bare version string
//   - manifest.json       — build metadata + image list
//
// Prod server workflow:
//   scp program-landscape-<version>.tar.gz kku-prod:/tmp/
//   ssh kku-prod
//   cd /tmp && tar xzf program-landscape-<version>.tar.gz
//   cd program-landscape-<version> && ./scripts/deploy.sh
//
// The prod server never needs to pull from any Docker registry.

import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ORG = 'khon-kaen-university';
const REPO = 'program-landscape';

const versionArg = process.argv[2];
if (!versionArg) {
  console.error('Usage: pnpm build:release <version>');
  console.error('       e.g. pnpm build:release 1.0.0');
  process.exit(1);
}
const version = versionArg.replace(/^v/, '');

// Validate version shape. Allow `1.2.3` + `1.2.3-rc.1` + `dev-<anything>`.
if (!/^(\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?|dev-[a-zA-Z0-9.-]+)$/.test(version)) {
  console.error(`[build-release] invalid version "${version}"`);
  console.error('Expected: 1.2.3 | 1.2.3-rc.1 | dev-<label>');
  process.exit(1);
}

const releaseDir = path.join(REPO_ROOT, 'dist', 'releases', `${REPO}-${version}`);
const distDir = path.join(REPO_ROOT, 'dist');

console.log(`=== build-release ${REPO} v${version} ===`);

// Clean + stage.
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
mkdirSync(path.join(releaseDir, 'infra'), { recursive: true });
mkdirSync(path.join(releaseDir, 'scripts'), { recursive: true });

// ── 1. Build images ────────────────────────────────────────────────
interface ImageBuild {
  service: string;
  name: string;
  dockerfile: string;
  context: string;
}

const images: ImageBuild[] = [
  {
    service: 'web',
    name: `${REPO}-web`,
    dockerfile: 'apps/web/Dockerfile.prod',
    context: '.',
  },
  {
    service: 'api',
    name: `${REPO}-api`,
    dockerfile: 'apps/api/Dockerfile.prod',
    context: '.',
  },
  {
    service: 'ingestion',
    name: `${REPO}-ingestion`,
    dockerfile: 'apps/ingestion/Dockerfile.prod',
    context: '.',
  },
  {
    service: 'gotenberg',
    name: `${REPO}-gotenberg`,
    dockerfile: 'infra/gotenberg/Dockerfile',
    context: 'infra/gotenberg',
  },
];

const tags = images.map((i) => `ghcr.io/${ORG}/${i.name}:${version}`);

// Use legacy docker builder (DOCKER_BUILDKIT=0) instead of buildx.
// Reason: buildkit v0.29.0 + the dev box's Ceph-RBD-backed
// /var/lib/docker fails the OCI exporter snapshot commit on the api
// + ingestion runner stages with `failed to commit ... snapshot does
// not exist` — same snapshot ID across full prunes, so it's a stuck
// content-store state, not transient. Legacy builder uses dockerd's
// own builder + bypasses the broken exporter completely.
// Verified working 2026-05-09. Revert to buildx once buildkit ships
// a fix or we move /var/lib/docker off RBD.
//
// Trade-offs: (a) no `--platform linux/amd64` flag — dev is native
// linux/amd64 so this is a no-op. (b) no parallel multi-stage cache
// reuse — slightly slower but correctness wins.
const buildEnv = { ...process.env, DOCKER_BUILDKIT: '0' };
for (const [idx, img] of images.entries()) {
  const tag = tags[idx]!;
  console.log(`\n--- [${idx + 1}/${images.length}] docker build ${tag} ---`);
  try {
    execSync(
      `docker build -t "${tag}" -f "${img.dockerfile}" "${img.context}"`,
      { cwd: REPO_ROOT, stdio: 'inherit', env: buildEnv },
    );
  } catch (err) {
    console.error(`[build-release] docker build failed for ${tag}`);
    process.exit(1);
  }
}

// ── 2. Save images into a single tarball ───────────────────────────
const imagesTar = path.join(releaseDir, 'images.tar');
console.log(`\n--- docker save → ${path.relative(REPO_ROOT, imagesTar)} ---`);
execSync(`docker save -o "${imagesTar}" ${tags.map((t) => `"${t}"`).join(' ')}`, {
  cwd: REPO_ROOT,
  stdio: 'inherit',
});

// ── 3. Copy deployment artefacts ───────────────────────────────────
const copyPairs: Array<[string, string]> = [
  ['docker-compose.prod.yml', 'docker-compose.yml'],
  ['infra/nginx', 'infra/nginx'],
  ['infra/postgres', 'infra/postgres'],
  ['.env.prod.example', '.env.prod.example'],
  ['scripts/generate-self-signed-cert.sh', 'scripts/generate-self-signed-cert.sh'],
  ['scripts/deploy.sh', 'scripts/deploy.sh'],
  ['scripts/rollback.sh', 'scripts/rollback.sh'],
  ['scripts/backup.sh', 'scripts/backup.sh'],
  ['scripts/restore.sh', 'scripts/restore.sh'],
  ['scripts/smoke-test.sh', 'scripts/smoke-test.sh'],
  ['DEPLOYMENT.md', 'DEPLOYMENT.md'],
];

for (const [src, dest] of copyPairs) {
  const srcPath = path.join(REPO_ROOT, src);
  const destPath = path.join(releaseDir, dest);
  if (!existsSync(srcPath)) {
    console.warn(`[build-release] missing source: ${src} — skipping`);
    continue;
  }
  mkdirSync(path.dirname(destPath), { recursive: true });
  cpSync(srcPath, destPath, { recursive: true });
}

// Drop the in-tree nginx certs placeholder — the cert lives per-host
// under /opt/program-landscape/certs.
const bundledCerts = path.join(releaseDir, 'infra/nginx/certs');
if (existsSync(bundledCerts)) {
  rmSync(bundledCerts, { recursive: true, force: true });
  mkdirSync(bundledCerts, { recursive: true });
  writeFileSync(
    path.join(bundledCerts, 'README.txt'),
    [
      'This directory is populated on the prod server at deploy time.',
      'The deploy script symlinks it from /opt/program-landscape/certs/.',
      'Generate the cert with scripts/generate-self-signed-cert.sh once.',
      '',
    ].join('\n'),
  );
}

// ── 4. VERSION + manifest ──────────────────────────────────────────
const commit = tryExec('git rev-parse HEAD', REPO_ROOT) ?? 'unknown';
const branch = tryExec('git rev-parse --abbrev-ref HEAD', REPO_ROOT) ?? 'unknown';
const dirty = tryExec('git status --porcelain', REPO_ROOT) ? 'dirty' : 'clean';

writeFileSync(path.join(releaseDir, 'VERSION'), `${version}\n`);
writeFileSync(
  path.join(releaseDir, 'manifest.json'),
  JSON.stringify(
    {
      version,
      builtAt: new Date().toISOString(),
      builtBy: process.env.USER ?? process.env.USERNAME ?? 'unknown',
      host: tryExec('hostname', REPO_ROOT) ?? 'unknown',
      org: ORG,
      repo: REPO,
      commit,
      branch,
      treeState: dirty,
      images: tags.map((tag, i) => ({
        service: images[i]!.service,
        tag,
      })),
      files: copyPairs.map(([, dest]) => dest),
    },
    null,
    2,
  ) + '\n',
);

// ── 5. Tar + checksum ──────────────────────────────────────────────
const bundleName = `${REPO}-${version}.tar.gz`;
const bundlePath = path.join(distDir, bundleName);
const stagingRoot = path.dirname(releaseDir); // dist/releases
const stagingName = path.basename(releaseDir); // program-landscape-<ver>

console.log(`\n--- tar → ${path.relative(REPO_ROOT, bundlePath)} ---`);
rmSync(bundlePath, { force: true });
execSync(`tar czf "${bundlePath}" -C "${stagingRoot}" "${stagingName}"`, {
  cwd: REPO_ROOT,
  stdio: 'inherit',
});

const checksumPath = `${bundlePath}.sha256`;
execSync(`cd "${distDir}" && sha256sum "${bundleName}" > "${path.basename(checksumPath)}"`, {
  shell: '/bin/bash',
});

const sizeHuman = tryExec(`du -h "${bundlePath}"`, REPO_ROOT)?.split(/\s+/)[0] ?? '?';
const sha = readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];

console.log(`\n=== bundle ready ===`);
console.log(`  file     : ${path.relative(REPO_ROOT, bundlePath)}`);
console.log(`  size     : ${sizeHuman}`);
console.log(`  sha256   : ${sha}`);
console.log(`  checksum : ${path.relative(REPO_ROOT, checksumPath)}`);
console.log(`  version  : ${version}`);
console.log(`\nTransfer with:`);
console.log(`  scp ${path.relative(REPO_ROOT, bundlePath)} kku-prod:/tmp/`);
console.log(`\nOn kku-prod:`);
console.log(`  cd /tmp && tar xzf ${bundleName} && cd ${stagingName} && ./scripts/deploy.sh`);

function tryExec(cmd: string, cwd: string): string | undefined {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}
