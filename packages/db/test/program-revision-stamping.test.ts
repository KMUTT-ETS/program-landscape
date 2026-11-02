import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Every writer of a revision-scoped table must stamp programRevisionId.
//
// There is no compiler enforcement — the column is nullable, so an unstamped
// write compiles and silently produces a row that claims to be the
// pre-feature baseline, indistinguishable from genuinely old data.
//
// Precedent for needing this: a pipeline phase list kept by hand in five
// files lost one copy for its entire lifetime, so that phase never ran from
// the admin UI. Centralisation plus a guard test is the fix that stuck.
//
// Why this parses the write call rather than grepping the file: a plain
// `src.includes('programRevisionId')` passes even when only ONE branch of an
// upsert stamps. That is not hypothetical — deleting the stamp from the
// create branch of program-pedagogy/run.ts leaves a file-level grep green,
// while producing exactly the silent-baseline row this guard exists to
// prevent. So each payload branch is checked on its own.
// ─────────────────────────────────────────────────────────────────────────────

const REPO = path.join(__dirname, '..', '..', '..');

/** Each writer: the file, and the prisma delegate it writes. */
const WRITERS: Array<{ file: string; delegate: string }> = [
  { file: 'packages/db/src/program-strategic-narrative-run.ts', delegate: 'programStrategicNarrative' },
  { file: 'packages/db/src/program-research-expertise-run.ts', delegate: 'programResearchExpertise' },
  { file: 'packages/db/src/program-curriculum-revision-run.ts', delegate: 'programCurriculumRevision' },
  { file: 'packages/db/src/program-digest-materialize.ts', delegate: 'programSkill' },
  { file: 'apps/ingestion/src/program-ai-readiness/run.ts', delegate: 'programAiReadinessAssessment' },
  { file: 'apps/ingestion/src/program-pedagogy/run.ts', delegate: 'programPedagogyAssessment' },
  { file: 'apps/ingestion/src/program-peers/review.ts', delegate: 'programPeerReview' },
  { file: 'apps/ingestion/src/program-peers/select.ts', delegate: 'programPeerSelection' },
  { file: 'apps/ingestion/src/program-courses-extract/run.ts', delegate: 'programCourse' },
  { file: 'apps/ingestion/src/scripts/materialise-program-courses.ts', delegate: 'programCourse' },
  { file: 'apps/ingestion/src/program-faculty/run.ts', delegate: 'programFaculty' },
  { file: 'apps/ingestion/src/program-overlap/prep.ts', delegate: 'programLearningOutcome' },
  // The three curriculum-extraction writers. `ai_extractions` is shared with
  // kinds that are NOT revision-scoped and deliberately stay unstamped —
  // PROPOSED_SKILL (a downstream artifact of a digest, written by
  // program-digest-materialize.ts), PROGRAM_COURSES_EXTRACT, the IMD rankings
  // kind, and the three kinds in ai-jobs/handlers.ts. Those files are either
  // registered here under a different delegate or not at all, so this guard
  // checks only the aiExtraction writes in the three files below.
  { file: 'apps/ingestion/src/program-digest/run.ts', delegate: 'aiExtraction' },
  { file: 'apps/ingestion/src/program-faculty/run.ts', delegate: 'aiExtraction' },
  { file: 'apps/ingestion/src/program-skills/run.ts', delegate: 'aiExtraction' },
];

/** Prisma model name → the delegate the client exposes it as. */
const toDelegate = (model: string): string => model.charAt(0).toLowerCase() + model.slice(1);

/** Write operations whose argument carries a row payload. */
const WRITE_OPS = ['upsert', 'createMany', 'updateMany', 'create', 'update'] as const;

/** Payload-bearing keys per operation. `where` is deliberately excluded. */
const PAYLOAD_KEYS: Record<string, readonly string[]> = {
  upsert: ['create', 'update'],
  create: ['data'],
  update: ['data'],
  createMany: ['data'],
  updateMany: ['data'],
};

/**
 * Slice the balanced bracket group starting at `open` (which must index the
 * opening bracket). Returns the text including both brackets.
 *
 * Deliberately naive about strings and comments: these payload objects are
 * plain literals, and a stray brace inside one would show up as a parse
 * failure in the tests below rather than as a silent pass.
 */
function balanced(src: string, open: number): string | null {
  const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
  const close = pairs[src[open]];
  if (!close) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * Values of the depth-1 keys of an object-literal text. Nested keys of the
 * same name (a `create:` inside a nested relation write) are not returned,
 * which is what keeps the branch check honest.
 */
function topLevelEntries(objText: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  for (let i = 0; i < objText.length; i++) {
    const c = objText[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (depth === 1) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(objText.slice(i));
      // Only treat it as a key when the previous non-space char opened the
      // object or ended the previous entry — avoids matching `a ? b : c`.
      const prev = objText.slice(0, i).trimEnd().slice(-1);
      if (m && (prev === '{' || prev === ',')) {
        const valStart = i + m[0].length;
        let d = 0;
        let j = valStart;
        for (; j < objText.length; j++) {
          const v = objText[j];
          if (v === '{' || v === '(' || v === '[') d++;
          else if (v === '}' || v === ')' || v === ']') {
            if (d === 0) break;
            d--;
          } else if (v === ',' && d === 0) break;
        }
        out.set(m[1], objText.slice(valStart, j).trim());
        i = j - 1;
      }
    }
  }
  return out;
}

interface Branch {
  /** e.g. "upsert(...).create" — used verbatim in the failure message. */
  label: string;
  value: string;
  /** False when the payload is a bare identifier built elsewhere. */
  inline: boolean;
}

/**
 * Object literals fed into `ident` — `ident.push({...})` and
 * `const ident = xs.map((x) => ({...}))`. Used for `createMany({ data: rows })`,
 * where the payload is assembled away from the call.
 *
 * Returning [] means "could not find where this is built", which callers treat
 * as a failure rather than a pass. An earlier version of this test instead fell
 * back to a file-level search for programId near programRevisionId; that was
 * vacuous, because the `Array<{ programId: string; programRevisionId: string |
 * null }>` type annotation satisfied it even with every row literal unstamped.
 */
function buildersFor(src: string, ident: string): string[] {
  const out: string[] = [];
  if (!/^[A-Za-z_$][\w$]*$/.test(ident)) return out;

  for (const m of src.matchAll(new RegExp(`\\b${ident}\\s*\\.push\\s*\\(`, 'g'))) {
    const args = balanced(src, m.index + m[0].length - 1);
    if (!args) continue;
    const o = args.indexOf('{');
    if (o === -1) continue;
    const lit = balanced(args, o);
    if (lit) out.push(lit);
  }

  // `const ident = xs.map((x) => ({ ... }))`. The type-annotation form
  // (`const ident: Array<{...}> = []`) has no arrow and yields nothing.
  for (const m of src.matchAll(new RegExp(`\\b${ident}\\s*(?::[^=\\n]*)?=\\s*`, 'g'))) {
    const tail = src.slice(m.index + m[0].length);
    const arrow = tail.indexOf('=> ({');
    if (arrow === -1 || arrow > 2000) continue;
    const lit = balanced(tail, tail.indexOf('{', arrow + 3));
    if (lit) out.push(lit);
  }
  return out;
}

/**
 * Every payload branch passed to a write on `delegate` in `src`. Both the
 * module client (`prisma.`) and an interactive-transaction client (`tx.`) count:
 * phase 2b and the materialiser write inside `$transaction(async (tx) => …)`.
 */
function payloadBranches(src: string, delegate: string): Branch[] {
  const found: Branch[] = [];
  for (const op of WRITE_OPS) {
    const re = new RegExp(`\\b(?:prisma|tx)\\.${delegate}\\.${op}\\s*\\(`, 'g');
    for (const m of src.matchAll(re)) {
      const paren = m.index + m[0].length - 1;
      const argText = balanced(src, paren);
      if (!argText) continue;
      const objOpen = argText.indexOf('{');
      if (objOpen === -1) continue;
      const objText = balanced(argText, objOpen);
      if (!objText) continue;
      const entries = topLevelEntries(objText);
      for (const key of PAYLOAD_KEYS[op] ?? []) {
        const value = entries.get(key);
        if (value === undefined) continue;
        // A `.map(row => ({...}))` still builds the row inline, so its object
        // literal is in scope here and is checked like any other.
        found.push({ label: `${op}(...).${key}`, value, inline: /[{[]/.test(value) });
      }
    }
  }
  return found;
}

describe('revision provenance stamping', () => {
  for (const w of WRITERS) {
    it(`${w.file} stamps programRevisionId`, () => {
      const full = path.join(REPO, w.file);
      expect(existsSync(full), `${w.file} not found — was it moved or renamed?`).toBe(true);
      const src = readFileSync(full, 'utf8');

      expect(src, `${w.file} must resolve the id via activeRevisionIdFor, not inline its own query`)
        .toContain('activeRevisionIdFor');

      const branches = payloadBranches(src, w.delegate);
      expect(
        branches.length,
        `no prisma.${w.delegate} write payload found in ${w.file} — the write was ` +
          `refactored (moved out of this file, or renamed). Point WRITERS at its ` +
          `new home, or this guard is watching nothing.`,
      ).toBeGreaterThan(0);

      for (const b of branches) {
        if (b.inline) {
          expect(
            b.value,
            `${w.file}: the ${b.label} branch of prisma.${w.delegate} does not set ` +
              `programRevisionId. Every branch must stamp it — an upsert that stamps ` +
              `only on create leaves re-runs carrying a stale or null revision, which ` +
              `is indistinguishable from pre-feature data.`,
          ).toMatch(/\bprogramRevisionId\b/);
        } else {
          // Payload built elsewhere, e.g. createMany({ data: rows }). Follow
          // the identifier to the literals that build it and check each.
          const builders = buildersFor(src, b.value);
          expect(
            builders.length,
            `${w.file}: prisma.${w.delegate} ${b.label} is passed "${b.value}", but this ` +
              `test cannot find where "${b.value}" is built (it looks for ` +
              `${b.value}.push({...}) and ${b.value} = ....map(x => ({...}))). The rows ` +
              `moved, so the stamp is now unchecked — extend buildersFor() to follow them.`,
          ).toBeGreaterThan(0);

          builders.forEach((lit, i) => {
            expect(
              lit,
              `${w.file}: row literal #${i + 1} built into "${b.value}" (written by ` +
                `prisma.${w.delegate} ${b.label}) does not set programRevisionId. Stamp ` +
                `the rows where they are built — the value resolved once per run via ` +
                `activeRevisionIdFor() should be spread into every row.`,
            ).toMatch(/\bprogramRevisionId\b/);
          });
        }
      }
    });
  }

  it('every revision-scoped model in the schema has a writer registered here', () => {
    // The reverse drift: a new revision-scoped table whose writer nobody
    // added to WRITERS above. Without this, the list rots silently.
    const schema = readFileSync(path.join(REPO, 'packages/db/prisma/schema.prisma'), 'utf8');
    const scoped = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /\bprogramRevisionId\b/.test(body))
      .map(([, name]) => name);

    // Assert the per-model gap FIRST: when a new revision-scoped table lands,
    // this is the failure that names the thing to fix. The count assertion
    // below is only a backstop, and its message is far less actionable.
    const delegates = new Set(WRITERS.map((w) => w.delegate));
    const missing = scoped.map(toDelegate).filter((d) => !delegates.has(d));
    expect(
      missing,
      `revision-scoped models with no registered writer: ${missing.join(', ')}. ` +
        `Add the file that writes each one to WRITERS in this test, and make sure ` +
        `that file stamps programRevisionId from activeRevisionIdFor().`,
    ).toEqual([]);

    // Catches the opposite mistake: a model gains programRevisionId and someone
    // maps it onto an already-registered delegate (e.g. a second ProgramCourse-
    // shaped table), which the `missing` check above would wave through.
    expect(
      scoped.length,
      `expected 12 revision-scoped models, found ${scoped.length} (${scoped.join(', ')}). ` +
        `If you deliberately added or removed one, update WRITERS and this number together.`,
    ).toBe(12);
  });
});
