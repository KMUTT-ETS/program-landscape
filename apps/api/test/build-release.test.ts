import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// Static checks on the build-release script + the artefacts it ships.
// Doesn't actually run `docker build` — that's covered by the real
// release workflow. These tests catch regressions in the bundle
// structure + referenced files before the expensive build runs.

// apps/api/test → repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Case-insensitive regex, not a prefix: Nest routes /api/v1/EXTERNAL/… to the
// same handler, and a case-sensitive prefix would let it skip external_zone.
const EXTERNAL_LOCATION = 'location ~* ^/api/v1/external/ {';

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

  it('nginx conf routes the four /api/* tiers correctly', () => {
    const conf = readFileSync(
      path.join(REPO_ROOT, 'infra/nginx/conf.d/program-landscape.conf'),
      'utf8',
    );
    // Verify the four-tier routing — inverted on 2026-05-11 (commit beda02b)
    // so the default `/api/` goes to web (covers Next route handlers like
    // /api/admin-*, /api/me/, /api/proxy/, /api/profile-*). The explicit
    // /api/v1/ tier handles NestJS controllers. `/api/auth/` stays on web
    // (next-auth's home). Heavy NestJS endpoints route through their own
    // tier with burst-friendly rate limits.
    //
    //   /api/auth/                               → web   (next-auth)
    //   /api/v1/(cockpit/export|programs/.../export-detail-pdf|pdf/generate) → api (heavy)
    //   /api/v1/                                 → api   (NestJS catch-all)
    //   /api/                                    → web   (Next route handler catch-all)
    expect(conf).toMatch(/location\s+\/api\/auth\/\s*\{[^}]*web_upstream/);
    expect(conf).toMatch(/location\s+\/api\/v1\/\s*\{[^}]*api_upstream/);
    // The bare /api/ default must route to web (the user-typed inversion).
    expect(conf).toMatch(/location\s+\/api\/\s*\{[^}]*web_upstream/);
  });

  it('routes /api/v1/external/ through its own rate-limit zone', () => {
    const main = readFileSync(path.join(REPO_ROOT, 'infra', 'nginx', 'nginx.conf'), 'utf8');
    const site = readFileSync(
      path.join(REPO_ROOT, 'infra', 'nginx', 'conf.d', 'program-landscape.conf'),
      'utf8',
    );
    expect(main).toMatch(/limit_req_zone\s+\$binary_remote_addr\s+zone=external_zone:/);
    const start = site.indexOf(EXTERNAL_LOCATION);
    expect(start).toBeGreaterThan(-1);
    // The block runs to its closing brace (no nested braces inside it).
    const block = site.slice(start, site.indexOf('\n  }', start));
    expect(block).toMatch(/limit_req zone=external_zone/);
    expect(block).toMatch(/proxy_pass http:\/\/api_upstream;/);
    // No case-sensitive prefix form may linger alongside it.
    expect(site).not.toMatch(/^\s*location\s+\/api\/v1\/external\//im);
    // Regex locations: first match wins. Every regex location that precedes
    // the external one must be unable to match an /api/v1/external/ path.
    const earlierRegexes = [...site.slice(0, start).matchAll(/location\s+~\*?\s+(\S+)\s*\{/g)];
    for (const m of earlierRegexes) {
      expect(new RegExp(m[1] ?? '', 'i').test('/api/v1/external/staff-profile')).toBe(false);
    }
  });

  it('resolves one trusted hop and hands the external API a single address', () => {
    const main = readFileSync(path.join(REPO_ROOT, 'infra', 'nginx', 'nginx.conf'), 'utf8');
    const site = readFileSync(
      path.join(REPO_ROOT, 'infra', 'nginx', 'conf.d', 'program-landscape.conf'),
      'utf8',
    );
    // http-level only: a location-level real_ip_recursive is ignored by realip.
    expect(main).toMatch(/^\s*real_ip_recursive\s+off;/m);
    expect(main).not.toMatch(/^\s*real_ip_recursive\s+on;/m);
    expect(site).not.toMatch(/^\s*real_ip_recursive\b/m);

    const start = site.indexOf(EXTERNAL_LOCATION);
    const block = site.slice(start, site.indexOf('\n  }', start));
    expect(block).toMatch(/proxy_set_header X-Forwarded-For \$remote_addr;/);
    expect(block).not.toContain('$proxy_add_x_forwarded_for');
    expect(block).not.toContain('real_ip_recursive');

    const preflight = readFileSync(path.join(REPO_ROOT, 'scripts', 'preflight.sh'), 'utf8');
    expect(preflight).toMatch(/^gate_external_api_real_ip\(\)\s*\{/m);
    expect(preflight).toMatch(/^gate_external_api_real_ip\s*$/m);
    expect(preflight).toContain('KKU_PROXY_IPS');
  });

  describe('preflight gate_external_api_real_ip', () => {
    const PREFLIGHT = path.join(REPO_ROOT, 'scripts', 'preflight.sh');

    // Runs ONLY the gate (the script stops after defining gates when
    // sourced) against a throwaway env file + nginx dir.
    function runGate(opts: {
      env: string;
      nginxConf: string;
      confD?: Record<string, string>;
    }): { verdict: string; detail: string } {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'preflight-realip-'));
      try {
        const nginxDir = path.join(dir, 'nginx');
        mkdirSync(path.join(nginxDir, 'conf.d'), { recursive: true });
        writeFileSync(path.join(nginxDir, 'nginx.conf'), opts.nginxConf);
        for (const [name, body] of Object.entries(opts.confD ?? {})) {
          writeFileSync(path.join(nginxDir, 'conf.d', name), body);
        }
        const envFile = path.join(dir, 'env');
        writeFileSync(envFile, opts.env);
        const out = execFileSync(
          'bash',
          [
            '-c',
            // shift first: a bare `source` would hand the script our $1 as
            // its own argument list, which it rejects as an unknown arg.
            'f="$1"; shift; source "$f" && gate_external_api_real_ip && printf "%s\\t%s" "${GATE_VERDICTS[0]}" "${GATE_DETAILS[0]}"',
            'gate-test',
            PREFLIGHT,
          ],
          {
            encoding: 'utf8',
            env: { ...process.env, PREFLIGHT_ENV_FILE: envFile, PREFLIGHT_NGINX_DIR: nginxDir },
          },
        );
        const [verdict = '', detail = ''] = out.split('\t');
        return { verdict, detail };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    const PLACEHOLDERS = [
      'set_real_ip_from 10.0.0.0/8;',
      'set_real_ip_from 172.16.0.0/12;',
      'set_real_ip_from 192.168.0.0/16;',
      'real_ip_header   X-Forwarded-For;',
      'real_ip_recursive off;',
    ].join('\n');

    it('passes when the switch is off, whatever nginx trusts', () => {
      const r = runGate({ env: 'API_CLIENT_IP_ALLOWLIST=\nKKU_PROXY_IPS=\n', nginxConf: PLACEHOLDERS });
      expect(r).toEqual({ verdict: 'PASS', detail: 'ip allowlists off' });
    });

    it('fails when on while set_real_ip_from is still the RFC-1918 placeholders', () => {
      const r = runGate({
        env: 'API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS=10.1.2.3\n',
        nginxConf: PLACEHOLDERS,
      });
      expect(r.verdict).toBe('FAIL');
    });

    it('passes when on and nginx trusts exactly the single pinned proxy', () => {
      const r = runGate({
        env: 'API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS=10.1.2.3\n',
        nginxConf: 'set_real_ip_from 10.1.2.3;\nreal_ip_recursive off;\n',
      });
      expect(r).toEqual({
        verdict: 'PASS',
        detail: 'ip allowlists on; real-ip pinned to 1 proxy address(es)',
      });
    });

    it('treats a bare address and its /32 form as the same host', () => {
      const r = runGate({
        env: 'API_CLIENT_IP_ALLOWLIST="enabled"\nKKU_PROXY_IPS="10.1.2.3/32"\n',
        nginxConf: 'set_real_ip_from 10.1.2.3;\n',
      });
      expect(r.verdict).toBe('PASS');
    });

    it('fails when on with a /16 range, even if KKU_PROXY_IPS lists the same range', () => {
      const r = runGate({
        env: 'API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS=10.101.0.0/16\n',
        nginxConf: 'set_real_ip_from 10.101.0.0/16;\n',
      });
      expect(r.verdict).toBe('FAIL');
    });

    it('fails when on with KKU_PROXY_IPS empty', () => {
      const r = runGate({
        env: 'API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS=\n',
        nginxConf: 'set_real_ip_from 10.1.2.3;\n',
      });
      expect(r.verdict).toBe('FAIL');
      expect(r.detail).toContain('KKU_PROXY_IPS');
    });

    it('fails when on and nginx trusts an address KKU_PROXY_IPS does not name', () => {
      const r = runGate({
        env: 'API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS=10.1.2.3\n',
        nginxConf: 'set_real_ip_from 10.9.9.9;\n',
      });
      expect(r.verdict).toBe('FAIL');
    });

    it('counts a set_real_ip_from in conf.d/*.conf', () => {
      const r = runGate({
        env: 'API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS=10.1.2.3\n',
        nginxConf: 'set_real_ip_from 10.1.2.3;\n',
        confD: { 'site.conf': 'server {\n  set_real_ip_from 10.0.0.0/8;\n}\n' },
      });
      expect(r.verdict).toBe('FAIL');
    });

    it('fails on a directive split across lines (parsed by statement, not by line)', () => {
      const r = runGate({
        env: 'API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS=10.1.1.1\n',
        nginxConf: 'set_real_ip_from 10.1.1.1;\nset_real_ip_from\n    10.0.0.0/8;\n',
      });
      expect(r.verdict).toBe('FAIL');
      expect(r.detail).toContain('10.0.0.0/8');
    });

    it('finds a set_real_ip_from that shares a line with a block opener', () => {
      const r = runGate({
        env: 'API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS=10.1.1.1\n',
        nginxConf: 'http { set_real_ip_from 10.1.1.1; server { set_real_ip_from 10.0.0.0/8; } }\n',
      });
      expect(r.verdict).toBe('FAIL');
    });

    it('fails when set_real_ip_from has no value or more than one', () => {
      const env = 'API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS=10.1.1.1\n';
      expect(runGate({ env, nginxConf: 'set_real_ip_from 10.1.1.1;\nset_real_ip_from;\n' }).verdict).toBe('FAIL');
      expect(runGate({ env, nginxConf: 'set_real_ip_from 10.1.1.1 10.0.0.0/8;\n' }).verdict).toBe('FAIL');
    });

    it('accepts the mime.types and conf.d/*.conf includes the shipped nginx.conf uses', () => {
      const r = runGate({
        env: 'API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS=10.1.1.1\n',
        nginxConf:
          'http {\n  include /etc/nginx/mime.types;\n  set_real_ip_from 10.1.1.1;\n  include /etc/nginx/conf.d/*.conf;\n}\n',
      });
      expect(r.verdict).toBe('PASS');
    });

    it('fails when nginx includes a file the gate does not scan', () => {
      const r = runGate({
        env: 'API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS=10.1.1.1\n',
        nginxConf: 'http {\n  set_real_ip_from 10.1.1.1;\n  include /etc/nginx/realip/*.conf;\n}\n',
      });
      expect(r.verdict).toBe('FAIL');
      expect(r.detail).toContain('include');
    });

    it('accepts KKU_PROXY_IPS separated by commas as well as spaces', () => {
      const nginxConf = 'set_real_ip_from 10.1.1.1;\nset_real_ip_from 10.2.2.2;\n';
      for (const list of ['10.1.1.1,10.2.2.2', '10.1.1.1, 10.2.2.2', '10.1.1.1 10.2.2.2']) {
        const r = runGate({ env: `API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS="${list}"\n`, nginxConf });
        expect(r, list).toEqual({
          verdict: 'PASS',
          detail: 'ip allowlists on; real-ip pinned to 2 proxy address(es)',
        });
      }
    });

    it('ignores a commented-out set_real_ip_from', () => {
      const r = runGate({
        env: 'API_CLIENT_IP_ALLOWLIST=enabled\nKKU_PROXY_IPS=10.1.2.3\n',
        nginxConf: '# set_real_ip_from 10.0.0.0/8;\nset_real_ip_from 10.1.2.3;\n',
      });
      expect(r.verdict).toBe('PASS');
    });
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
