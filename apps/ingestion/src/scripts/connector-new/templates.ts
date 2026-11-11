import type { ImportColumn, ImportDataset } from '@kku/db';

/** "class-offerings" → "ClassOfferings", "demo-classes" → "DemoClasses". */
export function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/** Slug → env-name segment: upper-case, `-` → `_`. */
export function envSegment(slug: string): string {
  return slug.toUpperCase().replace(/-/g, '_');
}

const quote = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A guide sentence made safe inside a block comment. */
function commentSafe(text: string): string {
  return text
    .replace(/\*\//g, '*\\/')
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim();
}

function tsType(col: ImportColumn): string {
  switch (col.type) {
    case 'integer':
    case 'decimal':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return col.enumValues && col.enumValues.length > 0
        ? col.enumValues.map(quote).join(' | ')
        : 'string';
    case 'date':
    case 'text':
      return 'string';
  }
}

export function rowTypeName(dataset: ImportDataset): string {
  return `${pascalCase(dataset.slug)}Row`;
}

function rowType(dataset: ImportDataset): string {
  const lines = dataset.columns.map((c) => {
    const doc = commentSafe(c.guide) || (c.required ? 'Required.' : 'Optional.');
    return `  /** ${doc} */\n  ${quote(c.header)}${c.required ? '' : '?'}: ${tsType(c)};`;
  });
  return (
    `/** One row of the "${commentSafe(dataset.title)}" dataset, keyed by its template headers. */\n` +
    `export type ${rowTypeName(dataset)} = {\n${lines.join('\n')}\n};\n`
  );
}

export function connectorSource(opts: {
  name: string;
  displayName: string;
  datasets: readonly ImportDataset[];
}): string {
  const cls = `${pascalCase(opts.name)}Connector`;
  const slugs = opts.datasets.map((d) => quote(d.slug)).join(', ');
  const types = opts.datasets.map(rowType).join('\n');
  const rowTypes = opts.datasets.map(rowTypeName).join(', ');
  return `import type { ConnectorContext } from '@kku/shared';

import type { ApiClient } from '../../../base/api-client';
import { DatasetApiConnector, type DatasetRows } from '../../../base/dataset-api-connector';

${types}
/**
 * Fills ${opts.datasets.map((d) => d.slug).join(', ')} from ${opts.displayName}.
 * Set CONNECTOR_${envSegment(`api-${opts.name}`)}_BASE_URL and _TOKEN in .env.
 * Row types in use: ${rowTypes}.
 */
export class ${cls} extends DatasetApiConnector {
  readonly slug = ${quote(`api-${opts.name}`)};
  readonly displayName = ${quote(opts.displayName)};
  readonly datasets = [${slugs}] as const;

  protected async fetchAll(_ctx: ConnectorContext, _api: ApiClient): Promise<readonly unknown[]> {
    // Hints: page with api.paginate(...) or call api.getJson(path, ZodSchema);
    // validate every response with Zod; never log the records you fetch.
    throw new Error('TODO: fetch the records from the institution API with the ApiClient');
  }

  protected toRows(_records: readonly unknown[]): DatasetRows {
    // Hints: build one object per row keyed by the template header text;
    // convert Buddhist Era years to Common Era; if the API returns one record
    // per student, aggregate to the dataset's grain here; never log records.
    throw new Error('TODO: map the fetched records onto the dataset rows');
  }
}
`;
}

export function testSource(opts: { name: string; datasets: readonly ImportDataset[] }): string {
  const cls = `${pascalCase(opts.name)}Connector`;
  const checks = opts.datasets
    .map((d) => {
      const required = d.columns.filter((c) => c.required).map((c) => quote(c.header));
      return `    const first${pascalCase(d.slug)} = rows[${quote(d.slug)}]?.[0];
    expect(first${pascalCase(d.slug)}).toBeDefined();
    expect(Object.keys(first${pascalCase(d.slug)} ?? {})).toEqual(
      expect.arrayContaining([${required.join(', ')}]),
    );`;
    })
    .join('\n');
  return `import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { DatasetRows } from '../../src/connectors/base/dataset-api-connector';
import { ${cls} } from '../../src/connectors/sources/institution/${opts.name}/connector';

/** Exposes the protected toRows so the mapping can be tested without HTTP. */
class Probe extends ${cls} {
  rows(records: readonly unknown[]): DatasetRows {
    return this.toRows(records);
  }
}

// Remove .skip once fetchAll/toRows are written, and put a few sample API
// records (invented or anonymised, never real personal data) in the fixture.
describe.skip('${cls}.toRows', () => {
  it('maps the fixture records onto the dataset rows', () => {
    const records: unknown = JSON.parse(
      readFileSync(path.join(__dirname, '${opts.name}.fixture.json'), 'utf8'),
    );
    const rows = new Probe().rows(Array.isArray(records) ? records : []);
${checks}
  });
});
`;
}

export function registryLines(name: string): { importLine: string; entryLine: string } {
  const cls = `${pascalCase(name)}Connector`;
  return {
    importLine: `import { ${cls} } from './${name}/connector';`,
    entryLine: `  datasetApiEntry('api-${name}', () => new ${cls}()),`,
  };
}

export function catalogLines(name: string, displayName: string): string {
  return `  {
    slug: 'api-${name}',
    name: ${quote(displayName)},
    kind: 'API',
    inputFormat: 'JSON',
    mocked: false,
    scheduleEnabled: false,
    ownerContact: 'Institution administrator',
  },`;
}
