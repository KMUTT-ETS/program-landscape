import fs from 'node:fs';
import path from 'node:path';
import { rimrafSync } from 'rimraf';
import { GATHERED, GENERATED_DIR_NAME, toPosix } from './manifest';

export class GatherError extends Error {}

const FENCE = /^\s*(```|~~~)/;
const MD_LINK = /\]\(([^)\s]+)\)/g;

function isRelativeLink(href: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#') && !href.startsWith('/');
}

/** Rewrite relative Markdown links written for `fromDir` so they resolve from `toDir`. Fenced code is left alone. */
export function rebaseLinks(markdown: string, fromDir: string, toDir: string): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(MD_LINK, (whole: string, href: string) => {
        if (!isRelativeLink(href)) return whole;
        const hashAt = href.indexOf('#');
        const rel = hashAt === -1 ? href : href.slice(0, hashAt);
        const hash = hashAt === -1 ? '' : href.slice(hashAt);
        let rebased = toPosix(path.relative(toDir, path.resolve(fromDir, rel)));
        if (!rebased.startsWith('.')) rebased = `./${rebased}`;
        return `](${rebased}${hash})`;
      });
    })
    .join('\n');
}

export function insertBanner(markdown: string, sourceRel: string): string {
  const banner = `::: info Generated page\nGenerated from \`${sourceRel}\` — edit the source, not this page.\n:::\n`;
  const lines = markdown.split('\n');
  const first = lines[0];
  if (first !== undefined && first.startsWith('# ')) {
    return [first, '', banner, ...lines.slice(1)].join('\n');
  }
  return `${banner}\n${markdown}`;
}

function codeSpan(s: string): string {
  return s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``;
}

export interface ScriptEntry {
  name: string;
  command: string;
}

export interface ScriptGroup {
  title: string;
  scripts: ScriptEntry[];
}

export function groupScripts(scripts: Record<string, string>): ScriptGroup[] {
  const groups = new Map<string, ScriptEntry[]>();
  for (const name of Object.keys(scripts).sort()) {
    const colon = name.indexOf(':');
    const title = colon === -1 ? 'General' : name.slice(0, colon);
    const list = groups.get(title) ?? [];
    list.push({ name, command: scripts[name] ?? '' });
    groups.set(title, list);
  }
  const titles = [...groups.keys()].sort((a, b) => {
    if (a === 'General') return -1;
    if (b === 'General') return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return titles.map((title) => ({ title, scripts: groups.get(title) ?? [] }));
}

export function renderScriptsPage(groups: ScriptGroup[]): string {
  const out = [
    '# pnpm scripts',
    '',
    'Every script in the root `package.json`, grouped by name prefix. Run one with `pnpm <name>` from the repository root.',
    '',
  ];
  for (const g of groups) {
    out.push(`## ${g.title}`, '');
    for (const s of g.scripts) out.push(`- ${codeSpan(s.name)} — ${codeSpan(s.command)}`);
    out.push('');
  }
  return out.join('\n');
}

export interface EnvEntry {
  key: string;
  value: string;
  comment: string;
  optional: boolean;
}

export interface EnvSection {
  title: string;
  entries: EnvEntry[];
}

const SECTION = /^#\s*-{2,}\s*(.+?)\s*-{2,}\s*$/;
const ASSIGN = /^([A-Z][A-Z0-9_]*)=(.*)$/;
const COMMENTED_ASSIGN = /^#\s?([A-Z][A-Z0-9_]*)=(.*)$/;
const RULE_LINE = /^[─━═-]+$/;

export function isSecretKey(key: string): boolean {
  return /SECRET|PASSWORD|KEY|TOKEN/i.test(key);
}

/** Value as shown on the page: secret keys blank, `scheme://user:pass@` credentials masked. */
export function displayValue(key: string, value: string): string {
  if (isSecretKey(key)) return '';
  return value.replace(/(:\/\/[^/:@\s]+:)[^/@\s]+@/g, '$1****@');
}

export function parseEnvExample(text: string): EnvSection[] {
  const sections: EnvSection[] = [];
  let current: EnvSection = { title: 'General', entries: [] };
  let pending: string[] = [];
  const flush = (): void => {
    if (current.entries.length > 0) sections.push(current);
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      pending = [];
      continue;
    }
    const section = SECTION.exec(line);
    if (section) {
      flush();
      current = { title: section[1] ?? '', entries: [] };
      pending = [];
      continue;
    }
    const assign = ASSIGN.exec(line);
    const commented = assign ? null : COMMENTED_ASSIGN.exec(line);
    const match = assign ?? commented;
    if (match) {
      const key = match[1] ?? '';
      current.entries.push({
        key,
        value: displayValue(key, match[2] ?? ''),
        comment: pending.join(' '),
        optional: commented !== null,
      });
      pending = [];
      continue;
    }
    if (line.startsWith('#')) {
      const t = line.replace(/^#+\s?/, '').trim();
      if (t !== '' && !RULE_LINE.test(t)) pending.push(t);
    }
  }
  flush();
  return sections;
}

export function renderEnvPage(sections: EnvSection[]): string {
  const out = [
    '# Environment variables',
    '',
    'Every variable in `.env.example`, grouped by its own sections. Values are the template defaults; secret-looking keys are shown empty and credentials inside URLs are masked. Copy `.env.example` to `.env` and edit there.',
    '',
  ];
  for (const s of sections) {
    out.push(`## ${s.title}`, '');
    for (const e of s.entries) {
      const value = e.value === '' ? '*(empty)*' : codeSpan(e.value);
      const optional = e.optional ? ' *(optional — commented out in the template)*' : '';
      out.push(`- ${codeSpan(e.key)} = ${value}${optional}`);
      if (e.comment !== '') out.push(`  ${e.comment}`);
    }
    out.push('');
  }
  return out.join('\n');
}

function repoFile(repoRoot: string, repoRel: string): string {
  return path.join(repoRoot, ...repoRel.split('/'));
}

/** Validate every input first, then replace docs/_generated/ wholesale. */
export function runGather(repoRoot: string): { written: string[] } {
  for (const g of GATHERED) {
    if (!fs.existsSync(repoFile(repoRoot, g.source))) {
      throw new GatherError(`Gathered source missing: ${g.source}`);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(repoFile(repoRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  if (!pkg.scripts || Object.keys(pkg.scripts).length === 0) {
    throw new GatherError('package.json has no scripts');
  }
  const envPath = repoFile(repoRoot, '.env.example');
  if (!fs.existsSync(envPath)) throw new GatherError('Gathered source missing: .env.example');
  const envSections = parseEnvExample(fs.readFileSync(envPath, 'utf8'));
  if (envSections.length === 0) throw new GatherError('.env.example has no variables');

  const generatedDir = path.join(repoRoot, 'docs', GENERATED_DIR_NAME);
  rimrafSync(generatedDir);
  fs.mkdirSync(generatedDir, { recursive: true });

  const written: string[] = [];
  const write = (name: string, content: string): void => {
    fs.writeFileSync(path.join(generatedDir, name), content.endsWith('\n') ? content : `${content}\n`);
    written.push(`${GENERATED_DIR_NAME}/${name}`);
  };

  for (const g of GATHERED) {
    const src = repoFile(repoRoot, g.source);
    const text = fs.readFileSync(src, 'utf8');
    write(g.target, insertBanner(rebaseLinks(text, path.dirname(src), generatedDir), g.source));
  }
  write('scripts.md', insertBanner(renderScriptsPage(groupScripts(pkg.scripts)), 'package.json'));
  write('env.md', insertBanner(renderEnvPage(envSections), '.env.example'));
  return { written };
}
