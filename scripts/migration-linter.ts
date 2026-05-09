// scripts/migration-linter.ts
//
// Migration linter — fails CI when a Prisma migration contains
// destructive DDL without an explicit allow-annotation. Enforces the
// forward-only migration policy at PR time so a destructive change
// can't merge without a paired data-migration story + reviewer
// sign-off.
//
// Run:
//   pnpm tsx scripts/migration-linter.ts                      # all migrations
//   pnpm tsx scripts/migration-linter.ts <path/to/migration.sql>  # one file
//
// Allow-annotation: a comment containing
//   -- migration-linter: allow-destructive (reason: <text>)
// disables the linter for that migration. The reason is required —
// the linter rejects an annotation with no `reason: ...` payload.
//
// Exits:
//   0  no violations
//   1  ≥1 violation found
//   2  invocation error (bad path, no migrations, etc.)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

// ── Pure linter (no I/O — easy to unit-test) ─────────────────────────

export type RuleId =
  | 'drop-table'
  | 'drop-column'
  | 'rename-column'
  | 'rename-table'
  | 'alter-column-type'
  | 'set-not-null-no-default'
  | 'truncate'
  | 'drop-type';

export interface LintViolation {
  rule: RuleId;
  line: number;
  text: string;
  message: string;
}

interface Rule {
  id: RuleId;
  pattern: RegExp;
  message: string;
}

const RULES: readonly Rule[] = [
  {
    id: 'drop-table',
    pattern: /\bDROP\s+TABLE\b/i,
    message: 'DROP TABLE — destroys all rows. Forward-only policy: deprecate the model in code first, drop in a separate cleanup commit ≥2 weeks later.',
  },
  {
    id: 'drop-column',
    // `ALTER TABLE ... DROP COLUMN` (Postgres + standard SQL).
    pattern: /\bDROP\s+COLUMN\b/i,
    message: 'DROP COLUMN — destroys per-row data. Stop reading the column in code first; drop in a follow-up.',
  },
  {
    id: 'rename-column',
    // `ALTER TABLE ... RENAME COLUMN x TO y`. Renames break ALL existing
    // callers atomically — there's no overlap window.
    pattern: /\bRENAME\s+COLUMN\b/i,
    message: 'RENAME COLUMN — atomically breaks every caller. Use add-new + dual-write + drop-old instead.',
  },
  {
    id: 'rename-table',
    // `ALTER TABLE x RENAME TO y` and `ALTER TYPE x RENAME TO y`.
    pattern: /\bRENAME\s+TO\b/i,
    message: 'RENAME TO — atomically breaks every caller. Use a view alias or add-new + dual-write + drop-old.',
  },
  {
    id: 'alter-column-type',
    // `ALTER COLUMN ... TYPE` is DATA-BEARING — Postgres rewrites every row.
    pattern: /\bALTER\s+COLUMN\s+"?\w+"?\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    message: 'ALTER COLUMN ... TYPE — rewrites every row + may be lossy. Pair with a data-migration plan.',
  },
  {
    id: 'set-not-null-no-default',
    // ALTER COLUMN ... SET NOT NULL — needs a default OR a backfill.
    // We catch the bare form; presence of DEFAULT in the same line OK.
    pattern: /\bALTER\s+COLUMN\s+"?\w+"?\s+SET\s+NOT\s+NULL\b/i,
    message: 'ALTER COLUMN ... SET NOT NULL — fails if any existing row is NULL. Provide a DEFAULT or run a backfill UPDATE first.',
  },
  {
    id: 'truncate',
    pattern: /\bTRUNCATE\b/i,
    message: 'TRUNCATE — destroys all rows in the table. Almost never the right answer in a migration.',
  },
  {
    id: 'drop-type',
    pattern: /\bDROP\s+TYPE\b/i,
    message: 'DROP TYPE — destroys an enum/composite type. Make sure no row + no schema column references it.',
  },
];

const ALLOW_RE = /--\s*migration-linter:\s*allow-destructive\s*\(\s*reason:\s*([^)]+)\)/i;

export interface LintFileResult {
  file: string;
  violations: LintViolation[];
  allowed: boolean;
  allowReason: string | null;
}

export function lintSql(file: string, sql: string): LintFileResult {
  const allowMatch = sql.match(ALLOW_RE);
  const allowed = !!allowMatch;
  const allowReason = allowMatch ? allowMatch[1].trim() : null;

  const violations: LintViolation[] = [];
  const lines = sql.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment-only lines.
    if (/^\s*--/.test(line)) continue;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        // Special case: SET NOT NULL with a DEFAULT in the same statement
        // is fine — we look ahead for `SET DEFAULT` in the next 3 lines
        // (handles multi-line ALTER TABLE statements).
        if (rule.id === 'set-not-null-no-default') {
          const window = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
          if (/SET\s+DEFAULT|DEFAULT\s+\S+/i.test(window)) continue;
        }
        // For `alter-column-type`, the `set-not-null-no-default`
        // pattern would also match — skip the duplicate hit.
        if (rule.id === 'set-not-null-no-default' && /\bSET\s+DATA\s+TYPE\b/i.test(line)) continue;
        violations.push({
          rule: rule.id,
          line: i + 1,
          text: line.trim(),
          message: rule.message,
        });
      }
    }
  }
  return { file, violations, allowed, allowReason };
}

// ── CLI ──────────────────────────────────────────────────────────────

function findMigrationFiles(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findMigrationFiles(full));
    else if (entry === 'migration.sql') out.push(full);
  }
  return out.sort();
}

function reportFile(r: LintFileResult): boolean {
  if (r.violations.length === 0) return false;
  if (r.allowed) {
    process.stdout.write(
      `\x1b[33m✓ ${r.file}\x1b[0m — ${r.violations.length} destructive item(s); allowed (reason: ${r.allowReason})\n`,
    );
    return false;
  }
  process.stdout.write(`\x1b[31m✗ ${r.file}\x1b[0m\n`);
  for (const v of r.violations) {
    process.stdout.write(
      `  line ${v.line}: \x1b[1m${v.rule}\x1b[0m\n` +
        `    ${v.text}\n` +
        `    ${v.message}\n`,
    );
  }
  process.stdout.write(
    `  ↳ to allow: add a comment to the migration:\n` +
      `      -- migration-linter: allow-destructive (reason: <why>)\n`,
  );
  return true;
}

function main(): void {
  const argFile = process.argv[2];
  const repoRoot = path.resolve(__dirname, '..');
  const files = argFile
    ? [path.resolve(argFile)]
    : findMigrationFiles(path.join(repoRoot, 'packages/db/prisma/migrations'));

  if (files.length === 0) {
    process.stderr.write('migration-linter: no migrations found\n');
    process.exit(2);
  }

  let badFiles = 0;
  for (const f of files) {
    const sql = readFileSync(f, 'utf8');
    const r = lintSql(f, sql);
    if (reportFile(r)) badFiles += 1;
  }
  process.stdout.write(
    `\nmigration-linter: ${files.length} file(s) scanned, ${badFiles} unannotated destructive migration(s).\n`,
  );
  process.exit(badFiles > 0 ? 1 : 0);
}

// `tsx` runs the file directly; in Node ESM the typical "if main"
// pattern is fileURLToPath + import.meta.url. Keep CommonJS-friendly:
if (require.main === module) main();
