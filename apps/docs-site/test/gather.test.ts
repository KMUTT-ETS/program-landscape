import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GatherError,
  displayValue,
  groupScripts,
  insertBanner,
  parseEnvExample,
  rebaseLinks,
  renderEnvPage,
  renderScriptsPage,
  runGather,
} from '../src/gather';
import { GATHERED } from '../src/manifest';

const ENV_FIXTURE = [
  '# ────────────────',
  '# Program Landscape — environment template',
  '# ────────────────',
  '',
  '# --- Core ---',
  'NODE_ENV=development',
  '# Where the web app listens.',
  'APP_URL=http://localhost:3000',
  '# APP_PUBLIC_URL (the public URL) is sent in User-Agents.',
  '# APP_PUBLIC_URL=https://program-landscape.example.ac.th',
  '',
  '# --- Database ---',
  'POSTGRES_PASSWORD=kku_dev_password',
  'DATABASE_URL=postgresql://kku:kku_dev_password@localhost:5432/pl?schema=public',
  '# Create it once with:  createdb -U kku program_landscape_shadow',
  '# INSTITUTION_NAME_TH must equal the TCAS column exactly.',
  'MINIO_ACCESS_KEY=minio_dev',
  '',
].join('\n');

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-site-gather-'));
  for (const g of GATHERED) {
    const full = path.join(root, ...g.source.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `# ${g.source}\n\nSee [backups](docs/backup-dr.md).\n`);
  }
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { dev: 'concurrently a b', 'db:up': 'docker compose up -d', 'db:down': 'docker compose down' } }),
  );
  fs.writeFileSync(path.join(root, '.env.example'), ENV_FIXTURE);
  return root;
}

describe('rebaseLinks', () => {
  const root = path.join(os.tmpdir(), 'r');
  const gen = path.join(root, 'docs', '_generated');

  it('rebases relative links to the new location and keeps the anchor', () => {
    expect(rebaseLinks('[b](docs/backup-dr.md#restore)', root, gen)).toBe('[b](../backup-dr.md#restore)');
    expect(rebaseLinks('[d](./DEPLOYMENT.md)', root, gen)).toBe('[d](../../DEPLOYMENT.md)');
  });

  it('leaves external, absolute, mailto and anchor links alone', () => {
    const src = '[a](https://x.org) [b](/abs) [c](mailto:a@example.org) [d](#top)';
    expect(rebaseLinks(src, root, gen)).toBe(src);
  });

  it('does not touch links inside fenced code blocks', () => {
    const src = ['```md', '[x](docs/a.md)', '```', '[y](docs/a.md)'].join('\n');
    expect(rebaseLinks(src, root, gen)).toBe(['```md', '[x](docs/a.md)', '```', '[y](../a.md)'].join('\n'));
  });
});

describe('insertBanner', () => {
  it('puts the banner directly under the H1', () => {
    const out = insertBanner('# Title\n\nBody\n', 'DEPLOYMENT.md');
    expect(out.startsWith('# Title\n\n::: info Generated page\nGenerated from `DEPLOYMENT.md`')).toBe(true);
    expect(out).toContain('Body');
  });

  it('puts the banner at the top when there is no H1', () => {
    expect(insertBanner('Body\n', 'x.md').startsWith('::: info Generated page')).toBe(true);
  });
});

describe('scripts page', () => {
  it('groups by prefix, General first, everything sorted', () => {
    const groups = groupScripts({ 'z:b': 'zb', dev: 'd', 'db:up': 'u', 'db:down': 'dn', check: 'c' });
    expect(groups.map((g) => g.title)).toEqual(['General', 'db', 'z']);
    expect(groups[0]?.scripts.map((s) => s.name)).toEqual(['check', 'dev']);
    expect(groups[1]?.scripts.map((s) => s.name)).toEqual(['db:down', 'db:up']);
  });

  it('renders each script as name and command code spans', () => {
    const page = renderScriptsPage(groupScripts({ 'db:up': 'docker compose up -d' }));
    expect(page).toContain('## db');
    expect(page).toContain('- `db:up` — `docker compose up -d`');
  });

  it('uses a double-backtick span when the command contains a backtick', () => {
    const page = renderScriptsPage(groupScripts({ x: 'echo `date`' }));
    expect(page).toContain('- `x` — `` echo `date` ``');
  });
});

describe('env page', () => {
  const sections = parseEnvExample(ENV_FIXTURE);

  it('splits into the file’s own sections and ignores the header banner', () => {
    expect(sections.map((s) => s.title)).toEqual(['Core', 'Database']);
  });

  it('attaches the comment block above a key', () => {
    const appUrl = sections[0]?.entries.find((e) => e.key === 'APP_URL');
    expect(appUrl?.comment).toBe('Where the web app listens.');
  });

  it('treats "# KEY=value" as an optional entry but keeps prose comments as prose', () => {
    const optional = sections[0]?.entries.find((e) => e.key === 'APP_PUBLIC_URL');
    expect(optional?.optional).toBe(true);
    expect(optional?.value).toBe('https://program-landscape.example.ac.th');
    const keys = sections.flatMap((s) => s.entries.map((e) => e.key));
    expect(keys).not.toContain('INSTITUTION_NAME_TH');
    const minio = sections[1]?.entries.find((e) => e.key === 'MINIO_ACCESS_KEY');
    expect(minio?.comment).toContain('Create it once with:');
  });

  it('blanks secret-looking keys and masks credentials inside URLs', () => {
    const db = sections[1]?.entries ?? [];
    expect(db.find((e) => e.key === 'POSTGRES_PASSWORD')?.value).toBe('');
    expect(db.find((e) => e.key === 'MINIO_ACCESS_KEY')?.value).toBe('');
    expect(db.find((e) => e.key === 'DATABASE_URL')?.value).toBe(
      'postgresql://kku:****@localhost:5432/pl?schema=public',
    );
    expect(displayValue('APP_URL', 'http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('renders keys, values and optional markers', () => {
    const page = renderEnvPage(sections);
    expect(page).toContain('## Core');
    expect(page).toContain('- `APP_URL` = `http://localhost:3000`');
    expect(page).toContain('- `POSTGRES_PASSWORD` = *(empty)*');
    expect(page).toContain('*(optional — commented out in the template)*');
    expect(page).not.toContain('kku_dev_password');
  });
});

describe('runGather', () => {
  it('writes every gathered and generated page', () => {
    const root = makeRepo();
    const { written } = runGather(root);
    expect(written).toEqual([
      '_generated/readme.md',
      '_generated/security-policy.md',
      '_generated/connector-session-template.md',
      '_generated/gotenberg-fonts.md',
      '_generated/scripts.md',
      '_generated/env.md',
    ]);
    const readme = fs.readFileSync(path.join(root, 'docs', '_generated', 'readme.md'), 'utf8');
    expect(readme).toContain('Generated from `README.md`');
    expect(readme).toContain('[backups](../backup-dr.md)');
  });

  it('is byte-identical across runs', () => {
    const root = makeRepo();
    const read = () =>
      ['scripts.md', 'env.md', 'security-policy.md'].map((f) =>
        fs.readFileSync(path.join(root, 'docs', '_generated', f), 'utf8'),
      );
    runGather(root);
    const first = read();
    runGather(root);
    expect(read()).toEqual(first);
  });

  it('fails loudly, naming the file, and leaves the previous output intact', () => {
    const root = makeRepo();
    runGather(root);
    fs.rmSync(path.join(root, 'SECURITY.md'));
    expect(() => runGather(root)).toThrow(GatherError);
    expect(() => runGather(root)).toThrow('SECURITY.md');
    expect(fs.existsSync(path.join(root, 'docs', '_generated', 'security-policy.md'))).toBe(true);
  });

  it('fails when package.json has no scripts', () => {
    const root = makeRepo();
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    expect(() => runGather(root)).toThrow('package.json has no scripts');
  });
});

describe('env page parsing edge cases', () => {
  const text = [
    '# ──────────────────',
    '# ── Alpha ──────────────────────────────────',
    'A_ONE=1',
    '# ── Beta ──',
    '# Enables the dev-only provider. REFUSES to load if',
    '# NODE_ENV=production. In prod, KKU SSO is the only path.',
    'B_FLAG=false',
    'B_HOST=REPLACE_ME  # Oracle SCAN host',
    'B_MODE=real             # prompt 14 note',
    'B_QUOTED="abc#def"',
    "B_PW2='x #y'",
    'B_REDIS=redis://:s3cret@cache:6379/0',
    '',
  ].join('\n');
  const sections = parseEnvExample(text);
  const all = sections.flatMap((s) => s.entries);

  it('accepts "# ── Name ──" headers with a long trailing rule', () => {
    expect(sections.map((s) => s.title)).toEqual(['Alpha', 'Beta']);
    expect(sections[0]?.entries.map((e) => e.key)).toEqual(['A_ONE']);
  });

  it('does not turn a pure rule line into a section', () => {
    expect(sections.map((s) => s.title)).not.toContain('General');
    expect(sections.every((s) => /[A-Za-z]/.test(s.title))).toBe(true);
  });

  it('moves an unquoted inline comment out of the value and into the comment', () => {
    const host = all.find((e) => e.key === 'B_HOST');
    expect(host?.value).toBe('REPLACE_ME');
    expect(host?.comment).toContain('Oracle SCAN host');
    expect(all.find((e) => e.key === 'B_MODE')?.value).toBe('real');
  });

  it('keeps a quoted value containing # intact', () => {
    expect(all.find((e) => e.key === 'B_QUOTED')?.value).toBe('"abc#def"');
    expect(displayValue('X_NAME', '"abc#def"')).toBe('"abc#def"');
    const q = parseEnvExample("# --- S ---\nX_NAME='x #y'\n");
    expect(q[0]?.entries[0]?.value).toBe("'x #y'");
    expect(q[0]?.entries[0]?.comment).toBe('');
  });

  it('keeps prose containing KEY=value as comment text, not an entry', () => {
    expect(all.map((e) => e.key)).not.toContain('NODE_ENV');
    const flag = all.find((e) => e.key === 'B_FLAG');
    expect(flag?.comment).toContain('REFUSES to load');
    expect(flag?.comment).toContain('NODE_ENV=production. In prod, KKU SSO is the only path.');
  });

  it('masks a URL credential with an empty username', () => {
    expect(displayValue('REDIS_URL', 'redis://:s3cret@cache:6379/0')).toBe('redis://:****@cache:6379/0');
  });
});
