// pnpm connector:new --name <kebab-name> --dataset <slug>[,<slug>...] [--display-name "<text>"] [--dry-run]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { getImportDataset, listImportDatasets, type ImportDataset } from '@kku/db';

import {
  catalogLines,
  connectorSource,
  envSegment,
  pascalCase,
  registryLines,
  testSource,
} from './templates';

const MARKER = '// connector:new entries';
// A leading letter: the name becomes a class name (PascalCase), and a class
// cannot start with a digit.
const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export interface ConnectorOptions {
  name: string;
  datasets: readonly string[];
  displayName: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

/** The new files for a connector, repo-relative (POSIX separators). Pure. */
export function generateConnectorFiles(opts: ConnectorOptions): GeneratedFile[] {
  const datasets: ImportDataset[] = opts.datasets.map((s) => getImportDataset(s));
  return [
    {
      path: `apps/ingestion/src/connectors/sources/institution/${opts.name}/connector.ts`,
      content: connectorSource({ name: opts.name, displayName: opts.displayName, datasets }),
    },
    {
      path: `apps/ingestion/test/institution/${opts.name}.test.ts`,
      content: testSource({ name: opts.name, datasets }),
    },
    {
      path: `apps/ingestion/test/institution/${opts.name}.fixture.json`,
      content: '[]\n',
    },
  ];
}

export interface ScaffolderEnv {
  /** Repository root. */
  root: string;
  log: (line: string) => void;
}

const toNative = (rel: string): string => rel.split('/').join(path.sep);

function insertAbove(file: string, lines: string, importLine?: string): void {
  let text = readFileSync(file, 'utf8');
  if (!text.includes(MARKER)) throw new Error(`Marker "${MARKER}" missing from ${file}`);
  text = text.replace(
    new RegExp(`^([ \\t]*)${MARKER.replace(/[/]/g, '\\/')}`, 'm'),
    (_m, indent: string) => `${lines}\n${indent}${MARKER}`,
  );
  if (importLine) {
    // After the last top-level import so the file keeps its shape.
    const all = [...text.matchAll(/^import .*;$/gm)];
    const last = all[all.length - 1];
    const at = last ? (last.index ?? 0) + last[0].length : 0;
    text = `${text.slice(0, at)}${last ? '\n' : ''}${importLine}${last ? '' : '\n'}${text.slice(at)}`;
  }
  writeFileSync(file, text);
}

/** Runs the CLI against `env.root`. Never throws for user errors. */
export function runScaffolder(argv: readonly string[], env: ScaffolderEnv): { exitCode: number } {
  const { log, root } = env;
  const fail = (message: string): { exitCode: number } => {
    log(message);
    return { exitCode: 2 };
  };

  let values: { name?: string; dataset?: string; 'display-name'?: string; 'dry-run'?: boolean };
  try {
    values = parseArgs({
      args: [...argv],
      options: {
        name: { type: 'string' },
        dataset: { type: 'string' },
        'display-name': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
      },
    }).values;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  const usage =
    'Usage: pnpm connector:new --name <kebab-name> --dataset <slug>[,<slug>...] [--display-name "<text>"] [--dry-run]';
  if (!values.name || !values.dataset) return fail(usage);
  if (!NAME_PATTERN.test(values.name)) {
    return fail(
      `Bad --name "${values.name}": use lower-case words joined by "-" (e.g. myuni-classes).`,
    );
  }

  const valid = listImportDatasets().map((d) => d.slug);
  const requested = values.dataset
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = requested.filter((s) => !valid.includes(s));
  if (requested.length === 0 || unknown.length > 0) {
    return fail(
      `Unknown dataset ${unknown.map((s) => `"${s}"`).join(', ') || '(none given)'}. Valid datasets: ${valid.join(', ')}.`,
    );
  }

  const name = values.name;
  const displayName =
    values['display-name'] ?? `${pascalCase(name).replace(/([a-z])([A-Z])/g, '$1 $2')} API`;
  const files = generateConnectorFiles({ name, datasets: requested, displayName });

  const connectorDir = path.join(
    root,
    toNative('apps/ingestion/src/connectors/sources/institution'),
    name,
  );
  const indexFile = path.join(
    root,
    toNative('apps/ingestion/src/connectors/sources/institution/index.ts'),
  );
  const catalogFile = path.join(
    root,
    toNative('packages/shared/src/ingestion/institution-catalog.ts'),
  );
  const slug = `api-${name}`;

  // Everything that could stop the run is checked before anything is written
  // (dry run included), so a refusal never leaves a half-made connector.
  for (const file of [indexFile, catalogFile]) {
    if (!existsSync(file))
      return fail(`Cannot find ${path.relative(root, file)}; run from the repository root.`);
    if (!readFileSync(file, 'utf8').includes(MARKER)) {
      return fail(
        `Marker "${MARKER}" is missing from ${path.relative(root, file)}; nothing was written.`,
      );
    }
  }
  if (
    existsSync(connectorDir) ||
    readFileSync(indexFile, 'utf8').includes(`'${slug}'`) ||
    readFileSync(catalogFile, 'utf8').includes(`'${slug}'`)
  ) {
    return fail(`A connector named "${name}" already exists (${slug}). Choose another --name.`);
  }
  const taken = files.filter((f) => existsSync(path.join(root, toNative(f.path))));
  if (taken.length > 0) {
    return fail(
      `Refusing to overwrite: ${taken.map((f) => f.path).join(', ')} already exist. Nothing was written.`,
    );
  }

  if (values['dry-run']) {
    log('Dry run: would create');
    for (const f of files) log(`  ${f.path}`);
    log('and add entries to the institution registry and catalogue.');
    return { exitCode: 0 };
  }

  for (const f of files) {
    const target = path.join(root, toNative(f.path));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, f.content);
    log(`Created ${f.path}`);
  }
  const reg = registryLines(name);
  const needsHelper = !/import\s*\{[^}]*\bdatasetApiEntry\b[^}]*\}\s*from/.test(
    readFileSync(indexFile, 'utf8'),
  );
  const helperImport = "import { datasetApiEntry } from '../../base/dataset-api-connector';";
  insertAbove(
    indexFile,
    reg.entryLine,
    needsHelper ? `${helperImport}\n${reg.importLine}` : reg.importLine,
  );
  insertAbove(catalogFile, catalogLines(name, displayName));
  log('Registered the connector and its data-source catalogue entry.');

  const seg = envSegment(slug);
  log('');
  log('Next steps:');
  log(`  1. Set CONNECTOR_${seg}_BASE_URL and CONNECTOR_${seg}_TOKEN in .env.`);
  log(
    `  2. Fill in fetchAll and toRows in apps/ingestion/src/connectors/sources/institution/${name}/connector.ts.`,
  );
  log('  3. Run pnpm data-sources:sync --apply, then restart the ingestion worker.');
  log('  4. Press "Run now" on /admin/data-sources.');
  return { exitCode: 0 };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..', '..', '..', '..', '..');
  const { exitCode } = runScaffolder(process.argv.slice(2), {
    root,
    log: (l) => console.log(l),
  });
  process.exit(exitCode);
}
