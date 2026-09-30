import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* A documented operator step has twice named a script that does not exist
 * inside the production image. At v1.9.4, four JobThai hydration scripts were
 * missing from the esbuild target list and each died in prod on
 * `dotenv/config not found` or ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.
 *
 * Dev cannot catch this: `pnpm <script>` runs the TypeScript source through
 * tsx, which works whether or not the script was ever bundled. The cheapest
 * place to compare the two is here, against the target list itself.
 *
 * Direction checked: everything a runbook tells an operator to run must be
 * bundled. The reverse — a bundled script nobody documents — is harmless and
 * deliberately not checked.
 *
 * The first draft of this file scanned five named files, two of which
 * referenced no script at all, so those cases passed vacuously. It also could
 * not detect its own regex going stale. Both are guarded below: the scan walks
 * every runbook, and `KNOWN_REFERENCED` fails the suite if the scan stops
 * finding what we know is there. */

const REPO = path.resolve(__dirname, '../../..');
const BUNDLER = path.join(REPO, 'apps/ingestion/scripts/bundle-pipeline-scripts.ts');
const SCRIPTS_DIR = path.join(REPO, 'apps/ingestion/src/scripts');

/** Scripts we know are documented with a container path. If the scan stops
 *  finding one of these, the scan itself has broken — a silently-green ratchet
 *  is worse than none, because it is trusted. */
const KNOWN_REFERENCED = ['sync-data-sources', 'retention-sweep', 'jobthai-fields', 'job108-backfill'];

function bundledTargets(): string[] {
  const src = readFileSync(BUNDLER, 'utf8');
  const block = /const TARGETS = \[(.*?)\n\];/s.exec(src);
  if (block === null) throw new Error('TARGETS array not found in bundle-pipeline-scripts.ts');
  return [...block[1]!.matchAll(/'([^']+\.ts)'/g)].map((m) => m[1]!);
}

/** Every runbook a human might follow: repo-root markdown, everything under
 *  docs/, and the shell scripts that run on the production host. The bundler
 *  itself is excluded — its comments name scripts as documentation of the list
 *  they are already in, which would make the check circular. */
function runbookFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      // docs/superpowers holds dated specs and plans, not runbooks. A command
      // that appears only in a historical plan is not documented for an
      // operator, and resting coverage on one would make the ratchet depend on
      // a document nobody maintains.
      if (name === 'node_modules' || name === '.git' || name === 'superpowers') continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.md') || name.endsWith('.sh')) out.push(full);
    }
  };
  for (const name of readdirSync(REPO)) {
    if (name.endsWith('.md')) out.push(path.join(REPO, name));
  }
  for (const dir of ['docs', 'scripts']) {
    const full = path.join(REPO, dir);
    if (existsSync(full)) walk(full);
  }
  return out;
}

/** script name → the runbooks that tell an operator to run it. */
function referencesByScript(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of runbookFiles()) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\/app\/dist\/scripts\/([A-Za-z0-9._-]+)\.js/g)) {
      const name = m[1]!;
      const rel = path.relative(REPO, file);
      const list = found.get(name);
      if (list === undefined) found.set(name, [rel]);
      else if (!list.includes(rel)) list.push(rel);
    }
  }
  return found;
}

describe('bundled script coverage', () => {
  const targets = bundledTargets();
  const referenced = referencesByScript();

  it('finds the TARGETS list', () => {
    expect(targets.length).toBeGreaterThan(10);
  });

  it('every TARGETS entry has a source file', () => {
    const missing = targets.filter((t) => !existsSync(path.join(SCRIPTS_DIR, t)));
    expect(missing, `TARGETS names scripts that do not exist: ${missing.join(', ')}`).toEqual([]);
  });

  it('the scan still finds the scripts we know are documented', () => {
    // Anti-vacuity: without this, a change to the documented command format
    // would leave every assertion below trivially true and the ratchet dead.
    const missing = KNOWN_REFERENCED.filter((n) => !referenced.has(n));
    expect(
      missing,
      `the runbook scan found no /app/dist/scripts/<name>.js reference for: ${missing.join(', ')}. ` +
        'Either the documented command format changed (fix the regex) or the runbook lost the step.',
    ).toEqual([]);
  });

  it('every script a runbook tells an operator to run is bundled', () => {
    const unbundled = [...referenced.entries()]
      .filter(([name]) => !targets.includes(`${name}.ts`))
      .map(([name, files]) => `${name}.js (named in ${files.join(', ')})`);
    expect(
      unbundled,
      'These are documented as production commands but esbuild does not bundle them, so they do not exist ' +
        `in the image: ${unbundled.join('; ')}. Add them to TARGETS in ` +
        'apps/ingestion/scripts/bundle-pipeline-scripts.ts.',
    ).toEqual([]);
  });

  it("deploy.sh's data_sources reconciliation is bundled", () => {
    // Runs between `migrate deploy` and the symlink swap. Dropping it from
    // TARGETS fails every deploy at that step — loud, but mid-deploy, so
    // catching it here is cheaper.
    expect(referenced.get('sync-data-sources')).toContain('scripts/deploy.sh');
    expect(targets).toContain('sync-data-sources.ts');
  });
});
