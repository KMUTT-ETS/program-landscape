import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getImportDataset, listImportDatasets } from '@kku/db';

import { generateConnectorFiles, runScaffolder } from '../src/scripts/connector-new/generate';

const INDEX_REL = path.join('apps', 'ingestion', 'src', 'connectors', 'sources', 'institution');
const CATALOG_REL = path.join('packages', 'shared', 'src', 'ingestion');
const REAL_ROOT = path.join(__dirname, '..', '..', '..');

function fileAt(files: { path: string; content: string }[], suffix: string): string {
  const hit = files.find((f) => f.path.replace(/\\/g, '/').endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending ${suffix}`);
  return hit.content;
}

describe('generateConnectorFiles', () => {
  it('class-offerings row type marks required headers non-optional and types enums as unions', () => {
    const files = generateConnectorFiles({
      name: 'demo',
      datasets: ['class-offerings'],
      displayName: 'Demo',
    });
    const src = fileAt(files, 'demo/connector.ts');
    const cols = getImportDataset('class-offerings').columns;
    const required = cols.find((c) => c.required && c.type === 'text');
    const optional = cols.find((c) => !c.required && c.type === 'integer');
    expect(required).toBeDefined();
    expect(optional).toBeDefined();
    expect(src).toContain(`'${required?.header}': string;`);
    expect(src).toContain(`'${optional?.header}'?: number;`);
    expect(src).toContain('type ClassOfferingsRow');
    expect(src).toContain('extends DatasetApiConnector');
    expect(src).toContain("slug = 'api-demo'");
    expect(src).toContain("throw new NonRetryableError('NOT_IMPLEMENTED', 'TODO");
    expect(src).toContain("import { NonRetryableError } from '../../../base/base-connector';");
    const enumCol = cols.find((c) => c.type === 'enum');
    if (enumCol?.enumValues) {
      expect(src).toContain(enumCol.enumValues.map((v) => `'${v}'`).join(' | '));
    }
  });

  it('generated test is skipped so pnpm check stays green', () => {
    const files = generateConnectorFiles({
      name: 'demo',
      datasets: ['class-offerings'],
      displayName: 'Demo',
    });
    const test = fileAt(files, 'test/institution/demo.test.ts');
    expect(test).toContain('describe.skip');
    expect(test).toContain('Remove .skip once fetchAll/toRows are written');
    expect(fileAt(files, 'test/institution/demo.fixture.json').trim()).toBe('[]');
  });

  it('two datasets generate two row types and list both in datasets', () => {
    const src = fileAt(
      generateConnectorFiles({
        name: 'grants',
        datasets: ['external-grants', 'external-grant-team'],
        displayName: 'Grants',
      }),
      'grants/connector.ts',
    );
    expect(src).toContain('type ExternalGrantsRow');
    expect(src).toContain('type ExternalGrantTeamRow');
    expect(src).toContain("datasets = ['external-grants', 'external-grant-team']");
  });

  it('escapes comment terminators in guide text', () => {
    const src = fileAt(
      generateConnectorFiles({ name: 'demo', datasets: ['class-offerings'], displayName: 'D' }),
      'demo/connector.ts',
    );
    // Every "*/" in the file must close a comment this generator opened.
    const opens = (src.match(/\/\*/g) ?? []).length;
    const closes = (src.match(/\*\//g) ?? []).length;
    expect(closes).toBe(opens);
  });
});

describe('runScaffolder', () => {
  let root: string;
  const out: string[] = [];
  const log = (line: string): void => void out.push(line);

  beforeEach(() => {
    out.length = 0;
    root = mkdtempSync(path.join(tmpdir(), 'connector-new-'));
    mkdirSync(path.join(root, INDEX_REL), { recursive: true });
    mkdirSync(path.join(root, CATALOG_REL), { recursive: true });
    for (const rel of [
      path.join(INDEX_REL, 'index.ts'),
      path.join(CATALOG_REL, 'institution-catalog.ts'),
    ]) {
      writeFileSync(path.join(root, rel), readFileSync(path.join(REAL_ROOT, rel), 'utf8'));
    }
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('rejects an unknown dataset slug and lists valid ones', () => {
    const r = runScaffolder(['--name', 'x', '--dataset', 'nope'], { root, log });
    expect(r.exitCode).toBe(2);
    expect(out.join('\n')).toContain('class-offerings');
    expect(out.join('\n')).not.toContain('    at ');
  });

  it('--list prints every dataset slug with its title and writes nothing', () => {
    const r = runScaffolder(['--list'], { root, log });
    expect(r.exitCode).toBe(0);
    const datasets = listImportDatasets();
    expect(out).toHaveLength(datasets.length);
    for (const d of datasets) {
      expect(out.some((line) => line.startsWith(d.slug) && line.endsWith(d.title))).toBe(true);
    }
    expect(existsSync(path.join(root, 'apps/ingestion/src/connectors/sources/institution/x'))).toBe(
      false,
    );
  });

  it('the unknown-dataset message points at --list', () => {
    runScaffolder(['--name', 'x', '--dataset', 'nope'], { root, log });
    expect(out.join('\n')).toContain('pnpm connector:new --list');
  });

  it('notes, without refusing, when another connector already fills the dataset', () => {
    expect(
      runScaffolder(['--name', 'campus-a', '--dataset', 'class-offerings'], { root, log }).exitCode,
    ).toBe(0);
    out.length = 0;
    const second = runScaffolder(
      ['--name', 'campus-b', '--dataset', 'class-offerings,faculties', '--dry-run'],
      { root, log },
    );
    expect(second.exitCode).toBe(0);
    expect(out.join('\n')).toContain('Note: api-campus-a already fills class-offerings.');
    expect(out.join('\n')).not.toContain('already fills faculties');
    out.length = 0;
    runScaffolder(['--name', 'campus-c', '--dataset', 'enrollment-metrics', '--dry-run'], {
      root,
      log,
    });
    expect(out.join('\n')).not.toContain('Note:');
  });

  it('rejects a bad name', () => {
    expect(
      runScaffolder(['--name', 'Bad_Name', '--dataset', 'class-offerings'], { root, log }).exitCode,
    ).toBe(2);
  });

  it('inserts registry and catalogue entries above the markers and refuses a second run', () => {
    const args = ['--name', 'demo-classes', '--dataset', 'class-offerings'];
    expect(runScaffolder(args, { root, log }).exitCode).toBe(0);

    const index = readFileSync(path.join(root, INDEX_REL, 'index.ts'), 'utf8');
    const marker = index.indexOf('// connector:new entries');
    expect(marker).toBeGreaterThan(0);
    expect(index.indexOf("datasetApiEntry('api-demo-classes'")).toBeLessThan(marker);
    expect(index).toContain('DemoClassesConnector');
    expect(index).toContain('import { datasetApiEntry } from');

    const catalog = readFileSync(path.join(root, CATALOG_REL, 'institution-catalog.ts'), 'utf8');
    expect(catalog.indexOf("slug: 'api-demo-classes'")).toBeLessThan(
      catalog.indexOf('// connector:new entries'),
    );
    expect(catalog).toContain("kind: 'API'");
    expect(catalog).toContain('mocked: false');
    expect(out.join('\n')).toContain('CONNECTOR_API_DEMO_CLASSES_BASE_URL');
    expect(out.join('\n')).toContain('pnpm connector:verify api-demo-classes');

    out.length = 0;
    const again = runScaffolder(args, { root, log });
    expect(again.exitCode).toBe(2);
    expect(out.join('\n')).toContain('already exists');
  });

  it('--dry-run writes nothing', () => {
    const r = runScaffolder(['--name', 'demo', '--dataset', 'class-offerings', '--dry-run'], {
      root,
      log,
    });
    expect(r.exitCode).toBe(0);
    const index = readFileSync(path.join(root, INDEX_REL, 'index.ts'), 'utf8');
    expect(index).not.toContain('api-demo');
  });

  it('rejects a name that starts with a digit', () => {
    expect(
      runScaffolder(['--name', '2nd-term', '--dataset', 'class-offerings'], { root, log }).exitCode,
    ).toBe(2);
  });

  it('writes nothing when a marker is missing', () => {
    const indexPath = path.join(root, INDEX_REL, 'index.ts');
    writeFileSync(
      indexPath,
      readFileSync(indexPath, 'utf8').replace('// connector:new entries', ''),
    );
    const r = runScaffolder(['--name', 'demo', '--dataset', 'class-offerings'], { root, log });
    expect(r.exitCode).toBe(2);
    expect(out.join('\n')).toContain('Marker');
    expect(existsSync(path.join(root, INDEX_REL, 'demo'))).toBe(false);
    expect(
      existsSync(path.join(root, 'apps', 'ingestion', 'test', 'institution', 'demo.test.ts')),
    ).toBe(false);
    const catalog = readFileSync(path.join(root, CATALOG_REL, 'institution-catalog.ts'), 'utf8');
    expect(catalog).not.toContain('api-demo');
  });

  it('refuses, writing nothing, when the test file already exists (also in --dry-run)', () => {
    const testDir = path.join(root, 'apps', 'ingestion', 'test', 'institution');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(path.join(testDir, 'demo.test.ts'), '// mine\n');
    for (const extra of [[], ['--dry-run']]) {
      out.length = 0;
      const r = runScaffolder(['--name', 'demo', '--dataset', 'class-offerings', ...extra], {
        root,
        log,
      });
      expect(r.exitCode).toBe(2);
      expect(out.join('\n')).toContain('demo.test.ts');
    }
    expect(readFileSync(path.join(testDir, 'demo.test.ts'), 'utf8')).toBe('// mine\n');
    expect(existsSync(path.join(root, INDEX_REL, 'demo'))).toBe(false);
    expect(readFileSync(path.join(root, INDEX_REL, 'index.ts'), 'utf8')).not.toContain('api-demo');
  });

  it('a second connector adds one helper import and two entries above the marker', () => {
    expect(
      runScaffolder(['--name', 'one', '--dataset', 'class-offerings'], { root, log }).exitCode,
    ).toBe(0);
    expect(
      runScaffolder(['--name', 'two', '--dataset', 'class-offerings'], { root, log }).exitCode,
    ).toBe(0);
    const index = readFileSync(path.join(root, INDEX_REL, 'index.ts'), 'utf8');
    expect(index.match(/import \{ datasetApiEntry \}/g)).toHaveLength(1);
    const marker = index.indexOf('// connector:new entries');
    for (const n of ['one', 'two']) {
      expect(index.indexOf(`datasetApiEntry('api-${n}'`)).toBeGreaterThan(0);
      expect(index.indexOf(`datasetApiEntry('api-${n}'`)).toBeLessThan(marker);
    }
  });

  it('escapes */ and quotes in a display name', () => {
    const src = fileAt(
      generateConnectorFiles({
        name: 'demo',
        datasets: ['class-offerings'],
        displayName: "Bob's */ API",
      }),
      'demo/connector.ts',
    );
    expect(src).toContain("readonly displayName = 'Bob\\'s */ API';");
    const opens = (src.match(/\/\*/g) ?? []).length;
    const closes = (src.match(/\*\//g) ?? []).length;
    // The only extra "*/" is inside the string literal.
    expect(closes).toBe(opens + 1);
    expect(src).toContain("Bob's *\\/ API");
  });
});
