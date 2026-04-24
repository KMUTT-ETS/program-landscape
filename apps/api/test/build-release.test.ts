import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Static checks on the build-release script + the artefacts it ships.
// Doesn't actually run `docker build` — that's covered by the real
// release workflow. These tests catch regressions in the bundle
// structure + referenced files before the expensive build runs.

// apps/api/test → repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('build-release', () => {
  it('has a tsx-runnable root script', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    );
    expect(pkg.scripts['build:release']).toBeDefined();
    expect(pkg.scripts['build:release']).toMatch(/scripts\/build-release\.ts/);
    // tsx needs to be in root devDependencies so CI can invoke the script.
    expect(pkg.devDependencies.tsx).toBeDefined();
  });

  it('references every file it claims to pack', () => {
    const src = readFileSync(
      path.join(REPO_ROOT, 'scripts/build-release.ts'),
      'utf8',
    );
    const required = [
      'docker-compose.prod.yml',
      'infra/nginx',
      'infra/postgres',
      '.env.prod.example',
      'scripts/generate-self-signed-cert.sh',
      'scripts/deploy.sh',
      'scripts/rollback.sh',
      'scripts/backup.sh',
      'scripts/restore.sh',
      'scripts/smoke-test.sh',
      'DEPLOYMENT.md',
    ];
    for (const rel of required) {
      expect(src, `copy pair missing for ${rel}`).toContain(rel);
      expect(existsSync(path.join(REPO_ROOT, rel)), `source missing: ${rel}`).toBe(true);
    }
  });

  it('Dockerfiles exist for each service in the image list', () => {
    const src = readFileSync(
      path.join(REPO_ROOT, 'scripts/build-release.ts'),
      'utf8',
    );
    for (const df of [
      'apps/web/Dockerfile.prod',
      'apps/api/Dockerfile.prod',
      'apps/ingestion/Dockerfile.prod',
      'infra/gotenberg/Dockerfile',
    ]) {
      expect(src).toContain(df);
      expect(existsSync(path.join(REPO_ROOT, df))).toBe(true);
    }
  });

  it('docker-compose.prod.yml references ${RELEASE_VERSION}', () => {
    const compose = readFileSync(
      path.join(REPO_ROOT, 'docker-compose.prod.yml'),
      'utf8',
    );
    // Every image tag must use the injected release version so a
    // misbehaving deploy can't silently run an old image.
    for (const svc of ['program-landscape-web', 'program-landscape-api', 'program-landscape-ingestion', 'program-landscape-gotenberg']) {
      const re = new RegExp(`image: ghcr\\.io/khon-kaen-university/${svc}:\\$\\{RELEASE_VERSION\\}`);
      expect(compose.match(re), `image tag for ${svc} not pinned to RELEASE_VERSION`).not.toBeNull();
    }
  });

  it('nginx conf routes /api/auth/* to web (next-auth lives there)', () => {
    const conf = readFileSync(
      path.join(REPO_ROOT, 'infra/nginx/conf.d/program-landscape.conf'),
      'utf8',
    );
    // Verify the auth split — /api/auth/* → web, /api/* → api.
    expect(conf).toMatch(/location\s+\/api\/auth\/\s*\{[^}]*web_upstream/);
    expect(conf).toMatch(/location\s+\/api\/\s*\{[^}]*api_upstream/);
  });

  it('deploy + rollback scripts are executable', () => {
    // chmod +x state is preserved by git; Vitest can only check the
    // file exists. The `execMode` check below verifies the POSIX
    // mode bits via stat.
    const { statSync } = require('node:fs') as typeof import('node:fs');
    for (const script of [
      'scripts/deploy.sh',
      'scripts/rollback.sh',
      'scripts/backup.sh',
      'scripts/restore.sh',
      'scripts/smoke-test.sh',
      'scripts/generate-self-signed-cert.sh',
    ]) {
      const s = statSync(path.join(REPO_ROOT, script));
      // 0o111 = any-execute (owner/group/world).
      expect(s.mode & 0o111, `not executable: ${script}`).toBeGreaterThan(0);
    }
  });
});
