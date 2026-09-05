#!/usr/bin/env node
// Build a pack-and-ship release bundle.
//
//   pnpm build:release <version>
//
// Produces a single self-contained .tar.zst at
//   dist/program-landscape-<version>.tar.zst
// plus a SHA-256 checksum at
//   dist/program-landscape-<version>.tar.zst.sha256
//
// zstd rather than gzip: unpacking the gzip bundle twice wedged the prod
// VM (2026-09-05). gunzip is single-threaded and took 79 s on ~7 GB where
// zstd takes 7 s, so this removes most of the cost — though not the 6.7 GB
// that still has to be written. Root cause of the freeze itself is not
// confirmed; see DEPLOYMENT.md. Both machines need the `zstd` binary —
// checked below before any image is built.
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
//   scp program-landscape-<version>.tar.zst kku-prod:/tmp/
//   ssh kku-prod
//   cd /tmp && tar --zstd -xf program-landscape-<version>.tar.zst
//   cd program-landscape-<version> && ./scripts/deploy.sh
//
// The prod server never needs to pull from any Docker registry.

import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ORG = 'khon-kaen-university';
const REPO = 'program-landscape';

// Retention: keep only the last N builds' artefacts on the dev box —
// release tarballs, staging dirs, and tagged docker images. Override
// with KEEP_BUILDS=<n>. Prod applies the same N in scripts/deploy.sh.
const KEEP_BUILDS = Number(process.env.KEEP_BUILDS) || 3;

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

// Checked HERE, not at the tar step: compression is the last thing this
// script does, ~50 minutes in, after every image has been built. Failing
// then would throw all of that away for a missing 400 KB package.
// `tar --zstd` shells out to this binary, so tar's own version is not
// enough — GNU tar 1.31+ knows the flag but still needs zstd on PATH.
try {
  execSync('command -v zstd', { stdio: 'ignore', shell: '/bin/bash' });
} catch {
  console.error('[build-release] zstd not found on PATH.');
  console.error('  Install it:  sudo apt-get install -y zstd');
  console.error('  The PROD server needs it too, to unpack the bundle.');
  process.exit(1);
}

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
  {
    // markitdown sidecar: a thin FastAPI wrapper around Microsoft markitdown
    // that converts uploaded documents → Markdown for the trend-document
    // ingest. pip install runs at build time on the dev box and is baked in,
    // so the air-gapped prod server (docker load) needs no network.
    service: 'markitdown',
    name: `${REPO}-markitdown`,
    dockerfile: 'infra/markitdown/Dockerfile',
    context: 'infra/markitdown',
  },
  {
    // Custom postgres image: postgis + pgvector + pg_trgm + btree_gin.
    // The upstream postgis/postgis:16-3.4 image lacks pgvector, which
    // breaks every CREATE TABLE that references vector(N) columns
    // (skills, pdf_documents, policy_documents, peer_programs, etc.).
    // pg_restore silently --clean --if-exists's past those failures.
    // Verified missing in prod 2026-05-10.
    service: 'postgres',
    name: `${REPO}-postgres`,
    dockerfile: 'infra/postgres/Dockerfile',
    context: 'infra/postgres',
  },
];

const tags = images.map((i) => `ghcr.io/${ORG}/${i.name}:${version}`);

// Use buildx with `--load`. The dev box's Docker daemon must NOT have
// containerd-snapshotter enabled — Docker 29's default-on
// `containerd-snapshotter` mode (Storage Driver: overlayfs +
// driver-type: io.containerd.snapshotter.v1) breaks buildkit's OCI
// exporter on our filesystem with `failed to commit ... snapshot does
// not exist` on runner-stage COPY. The fix is `/etc/docker/daemon.json`
// → `{"features":{"containerd-snapshotter":false}}` + restart docker.
// Verified bug + fix on dev 2026-05-10. After this, `Storage Driver`
// reports `overlay2` and buildkit works reliably.
//
// If we ever need to build on a host where overlay2 isn't an option
// (e.g., CI with the new defaults), set DOCKER_BUILDKIT=0 + drop
// --platform/--load to fall back to the legacy builder. ~30% slower
// because no shared deps-stage cache across images.
// SKIP_BUILDX=1 — assume images are already built (and tagged in the
// local registry) and skip straight to docker save + pack. Used when
// retrying after a packaging-stage failure (disk full, scp interrupted)
// so we don't re-spend 25 min on the buildx pipeline.
const skipBuildx = process.env.SKIP_BUILDX === '1';
if (skipBuildx) {
  console.log(`\n--- SKIP_BUILDX=1 — verifying tagged images present ---`);
  for (const tag of tags) {
    try {
      execSync(`docker image inspect "${tag}" >/dev/null 2>&1`, {
        shell: '/bin/bash',
      });
      console.log(`  ✓ ${tag}`);
    } catch {
      console.error(
        `[build-release] SKIP_BUILDX set but ${tag} is not in the local registry. Re-run without SKIP_BUILDX or build manually.`,
      );
      process.exit(1);
    }
  }
} else {
  for (const [idx, img] of images.entries()) {
    const tag = tags[idx]!;
    console.log(`\n--- [${idx + 1}/${images.length}] docker buildx build ${tag} ---`);
    try {
      execSync(
        `docker buildx build --platform linux/amd64 --load -t "${tag}" -f "${img.dockerfile}" "${img.context}"`,
        { cwd: REPO_ROOT, stdio: 'inherit' },
      );
    } catch (err) {
      console.error(`[build-release] docker build failed for ${tag}`);
      process.exit(1);
    }
  }
}

// ── 1b. Bundle upstream images so the air-gapped host needs no registry ──
// The prod box loads everything via `docker load` and shouldn't depend on
// reaching a registry. Anything in the prod compose that we DON'T build
// ourselves — nginx, redis, and Chainguard MinIO (upstream minio/minio is
// EOL) — must therefore travel in images.tar too. Derive the list straight
// from the prod compose `image:` lines (minus our own ghcr.io/<org> builds)
// so it auto-tracks scripts/pin-image-digests.sh: whatever digest the
// compose is pinned to is exactly what we pull + save here. No second list
// to keep in sync. (Verified on Docker 29: save/load preserves the registry
// digest, so a `name:tag@sha256:…`-pinned compose ref resolves to the
// loaded image without a pull.)
const prodComposeSrc = readFileSync(
  path.join(REPO_ROOT, 'docker-compose.prod.yml'),
  'utf8',
);
const externalImages = [
  ...new Set(
    prodComposeSrc
      .split('\n')
      .map((line) => line.match(/^\s*image:\s*(\S+)/)?.[1])
      .filter(
        (ref): ref is string => !!ref && !ref.includes(`ghcr.io/${ORG}/`),
      ),
  ),
];
console.log(
  `\n--- bundling ${externalImages.length} upstream image(s): ${externalImages.join(', ')} ---`,
);
for (const ext of externalImages) {
  console.log(`\n--- docker pull (external, for bundle) ${ext} ---`);
  execSync(`docker pull --platform linux/amd64 "${ext}"`, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}

// ── 2. Save images into a single tarball ───────────────────────────
const imagesTar = path.join(releaseDir, 'images.tar');
const saveRefs = [...tags, ...externalImages];
console.log(`\n--- docker save → ${path.relative(REPO_ROOT, imagesTar)} ---`);
execSync(`docker save -o "${imagesTar}" ${saveRefs.map((t) => `"${t}"`).join(' ')}`, {
  cwd: REPO_ROOT,
  stdio: 'inherit',
});

// ── 3. Copy deployment artefacts ───────────────────────────────────
const copyPairs: Array<[string, string]> = [
  ['docker-compose.prod.yml', 'docker-compose.yml'],
  ['infra/nginx', 'infra/nginx'],
  ['infra/postgres', 'infra/postgres'],
  // systemd unit files for nightly backup + weekly backup-verify +
  // kku-skills-normalise. The deploy script installs them under
  // /etc/systemd/system/ — without this directory in the bundle the
  // operator can't enable the nightly backup timer on a fresh box.
  ['infra/systemd', 'infra/systemd'],
  ['.env.prod.example', '.env.prod.example'],
  // Core deploy / rollback / backup / restore / smoke-test scripts.
  ['scripts/generate-self-signed-cert.sh', 'scripts/generate-self-signed-cert.sh'],
  ['scripts/deploy.sh', 'scripts/deploy.sh'],
  ['scripts/rollback.sh', 'scripts/rollback.sh'],
  ['scripts/backup.sh', 'scripts/backup.sh'],
  ['scripts/restore.sh', 'scripts/restore.sh'],
  ['scripts/smoke-test.sh', 'scripts/smoke-test.sh'],
  // Bootstrap + ops scripts the operator runs on a fresh box or
  // during a deploy:
  //   - preflight.sh: pre-deploy environment + connectivity check
  //   - ensure-minio-buckets.mjs: bootstraps required MinIO buckets
  //   - pre-deploy-snapshot.mjs: writes a pg_dump snapshot before
  //     destructive migrations (db:migrate:safe chains this)
  //   - pin-image-digests.sh: locks compose tags to SHA-256 digests
  //     post-deploy so a re-pull can't drift the image
  //   - skills-normalise.sh: runner for the weekly kku-skills-
  //     normalise timer in infra/systemd/
  //   - migration-linter.ts: pre-flight check for destructive
  //     migrations; reads packages/db/prisma/migrations/
  //   - dr/: disaster-recovery scripts (verify-backup, restore-drill,
  //     retention-check, check-mirror, verify-minio)
  //   - pdpa/: DSAR + retention sweep + redaction smoke
  //   - load/: ai-cap-probe (load test for AI quota cap)
  ['scripts/preflight.sh', 'scripts/preflight.sh'],
  ['scripts/ensure-minio-buckets.mjs', 'scripts/ensure-minio-buckets.mjs'],
  ['scripts/pre-deploy-snapshot.mjs', 'scripts/pre-deploy-snapshot.mjs'],
  ['scripts/pin-image-digests.sh', 'scripts/pin-image-digests.sh'],
  ['scripts/skills-normalise.sh', 'scripts/skills-normalise.sh'],
  ['scripts/migration-linter.ts', 'scripts/migration-linter.ts'],
  ['scripts/dr', 'scripts/dr'],
  ['scripts/pdpa', 'scripts/pdpa'],
  ['scripts/load', 'scripts/load'],
  ['DEPLOYMENT.md', 'DEPLOYMENT.md'],
  // Per-prompt hardening reports — read by scripts/preflight.sh's
  // `reports_present` + `no_unowned_deferrals` gates. Without these,
  // every release fails preflight and the operator has to override
  // with OVERRIDE_REASON. Bundle them so the preflight gate is real.
  ['docs/hardening', 'docs/hardening'],
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
const bundleName = `${REPO}-${version}.tar.zst`;
const bundlePath = path.join(distDir, bundleName);
const stagingRoot = path.dirname(releaseDir); // dist/releases
const stagingName = path.basename(releaseDir); // program-landscape-<ver>

// zstd, not gzip. `docker save` writes layers UNCOMPRESSED, so the bundle
// is ~6.7 GB of highly compressible tar — which is why gzip got it to
// ~2.4 GB, and why reversing that on the prod server was so expensive:
// gunzip is single-threaded — 79 s on this bundle where zstd takes 7 s —
// and unpacking it twice wedged the prod box (cause unconfirmed; see
// DEPLOYMENT.md).
//
// zstd decompresses several times faster than gzip at a small, fixed
// memory window. Its decompression speed is essentially independent of
// the level used to compress, so a higher level costs THIS machine time
// and gives prod a smaller download for free. -T0 uses all cores here,
// making the build step faster than the gzip it replaces despite -12.
//
// --use-compress-program rather than a shell pipe: it propagates the
// child's exit status, where `tar | zstd` would report success whenever
// zstd succeeded, even if tar had failed.
console.log(`\n--- tar + zstd → ${path.relative(REPO_ROOT, bundlePath)} ---`);
rmSync(bundlePath, { force: true });
execSync(
  `tar --use-compress-program='zstd -T0 -12' -cf "${bundlePath}" -C "${stagingRoot}" "${stagingName}"`,
  { cwd: REPO_ROOT, stdio: 'inherit' },
);

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
// Unpacking has twice wedged the prod VM (2026-09-05). Cause unconfirmed —
// tmpfs /tmp or a storage stall; see DEPLOYMENT.md. The staged tree is
// ~6.7 GB, so the free-space check is the part that always applies.
console.log(`  (needs zstd: command -v zstd || sudo apt-get install -y zstd)`);
console.log(`  df -h /tmp   # ~9 GB free — unpacking expands to ~6.7 GB`);
console.log(`  cd /tmp && tar --zstd -xf ${bundleName} && cd ${stagingName} && ./scripts/deploy.sh`);

// ── 6. Prune old builds — keep the last KEEP_BUILDS ────────────────
// Runs only after a successful build, so the just-built version is the
// newest and is never pruned.
pruneOldBuilds();

function tryExec(cmd: string, cwd: string): string | undefined {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

// Newest-first list of entries in `dir` matching `match`, by mtime.
function byMtimeDesc(dir: string, match: RegExp, kind: 'file' | 'dir'): string[] {
  return readdirSync(dir)
    .filter((n) => match.test(n))
    .map((n) => ({ n, st: statSync(path.join(dir, n)) }))
    .filter((x) => (kind === 'dir' ? x.st.isDirectory() : x.st.isFile()))
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
    .map((x) => x.n);
}

function pruneOldBuilds(): void {
  console.log(`\n--- pruning old builds (keeping last ${KEEP_BUILDS}) ---`);

  // dist/ release tarballs (+ their .sha256 checksums).
  // Matches .tar.gz too, so bundles built before the switch to zstd are
  // still pruned instead of accumulating forever.
  for (const old of byMtimeDesc(distDir, /^program-landscape-.*\.tar\.(gz|zst)$/, 'file').slice(
    KEEP_BUILDS,
  )) {
    rmSync(path.join(distDir, old), { force: true });
    rmSync(path.join(distDir, `${old}.sha256`), { force: true });
    console.log(`  removed ${old} (+ .sha256)`);
  }

  // dist/releases/ staging dirs (each carries a multi-GB images.tar).
  const stagingRoot = path.join(distDir, 'releases');
  if (existsSync(stagingRoot)) {
    for (const old of byMtimeDesc(stagingRoot, /^program-landscape-/, 'dir').slice(KEEP_BUILDS)) {
      rmSync(path.join(stagingRoot, old), { recursive: true, force: true });
      console.log(`  removed releases/${old}`);
    }
  }

  pruneOldImages();
}

// Keep the last KEEP_BUILDS versions of the tagged build images; remove
// the rest. CreatedAt sorts lexically = chronologically, so the
// just-built version is newest and kept.
function pruneOldImages(): void {
  let raw: string;
  try {
    raw = execSync(
      `docker images --filter=reference='ghcr.io/${ORG}/${REPO}-*' --format '{{.CreatedAt}}|{{.Tag}}'`,
      { encoding: 'utf8' },
    );
  } catch {
    console.warn('  (docker images query failed — skipping image prune)');
    return;
  }
  const seen = new Set<string>();
  const versionsNewestFirst: string[] = [];
  for (const line of raw.trim().split('\n').filter(Boolean).sort().reverse()) {
    const tag = line.split('|')[1]?.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    versionsNewestFirst.push(tag);
  }
  for (const ver of versionsNewestFirst.slice(KEEP_BUILDS)) {
    if (ver === version) continue; // never the version just built
    try {
      const imgs = execSync(
        `docker images --filter=reference='ghcr.io/${ORG}/${REPO}-*:${ver}' --format '{{.Repository}}:{{.Tag}}'`,
        { encoding: 'utf8' },
      )
        .trim()
        .split('\n')
        .filter(Boolean);
      for (const img of imgs) execSync(`docker rmi "${img}"`, { stdio: 'ignore' });
      console.log(`  removed images for v${ver}`);
    } catch {
      // image in use or already gone — ignore.
    }
  }
}
