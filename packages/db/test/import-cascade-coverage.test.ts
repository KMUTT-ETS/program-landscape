import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CASCADE_CHILDREN,
  CASCADE_CHILDREN_UNREACHABLE,
} from '../src/import/datasets/programmes';

// Every foreign key into `programs` that cascades is a table start-over would
// silently empty. The blocker list has to name all of them, and a hand-kept
// list drifts: phase 2 added three datasets and left it at the eight it had.
//
// So the schema is the authority. A new Cascade child fails this test until
// someone decides, in writing, whether losing it matters.

const SCHEMA = path.join(__dirname, '..', 'prisma', 'schema.prisma');

/** Models with an `onDelete: Cascade` relation into Program. */
function cascadeChildrenOfProgram(): string[] {
  const source = readFileSync(SCHEMA, 'utf8');
  const models = [...source.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const found = new Set<string>();

  for (const match of models) {
    const name = match[1];
    const body = match[2];
    if (!name || !body) continue;
    // Any relation whose scalar field names a Program row. Covers programId
    // and the two-ended case (ProgramOverlapPair's programAId/programBId).
    const relations = /@relation\([^)]*fields: \[(\w+)\][^)]*references: \[id\][^)]*onDelete:\s*(\w+)/g;
    let relation: RegExpExecArray | null;
    while ((relation = relations.exec(body)) !== null) {
      const field = relation[1] ?? '';
      const onDelete = relation[2];
      if (onDelete !== 'Cascade') continue;
      if (!/^program[A-Z]?Id$/.test(field)) continue;
      found.add(name);
    }
  }
  return [...found].sort();
}

describe('the programmes start-over guard covers every cascade', () => {
  it('finds the cascade children in the schema at all', () => {
    // Guards the regex itself: if it stops matching, every other assertion
    // here passes vacuously and the guard silently stops being checked.
    const children = cascadeChildrenOfProgram();
    expect(children.length).toBeGreaterThan(20);
    expect(children).toContain('EnrollmentMetric');
    expect(children).toContain('ProgramDocument');
  });

  it('accounts for every one of them', () => {
    const declared = new Set([
      ...CASCADE_CHILDREN.map((c) => c.model),
      ...CASCADE_CHILDREN_UNREACHABLE.map((c) => c.model),
    ]);
    const missing = cascadeChildrenOfProgram().filter((m) => !declared.has(m));
    expect(missing, 'cascade children with no entry in programmes.ts').toEqual([]);
  });

  it('names nothing that is not a cascade child', () => {
    // The mirror direction. An entry for a table that cannot be destroyed
    // blocks start-over for no reason, which is how a guard gets switched off.
    const inSchema = new Set(cascadeChildrenOfProgram());
    const stale = [...CASCADE_CHILDREN, ...CASCADE_CHILDREN_UNREACHABLE]
      .map((c) => c.model)
      .filter((m) => !inSchema.has(m));
    expect(stale, 'entries naming something that no longer cascades').toEqual([]);
  });

  it('gives every blocker a label an operator can act on', () => {
    for (const child of CASCADE_CHILDREN) {
      // A plural noun phrase, so it reads after a count: "3 risk assessments".
      // Not the model name — nobody recognises ProgramPedagogyAssessment.
      expect(child.label.length, child.model).toBeGreaterThan(4);
      expect(child.label, child.model).not.toBe(child.model);
      const irregularPlurals = ['curricula'];
      expect(
        /s$/.test(child.label) || irregularPlurals.includes(child.label),
        `${child.model}: "${child.label}" does not read as a plural after a count`,
      ).toBe(true);
    }
  });

  it('gives every unreachable entry a stated reason', () => {
    for (const child of CASCADE_CHILDREN_UNREACHABLE) {
      expect(child.reason.length, child.model).toBeGreaterThan(20);
    }
  });
});
