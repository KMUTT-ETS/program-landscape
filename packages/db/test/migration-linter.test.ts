import { describe, expect, it } from 'vitest';
import { lintSql } from '../../../scripts/migration-linter';

describe('migration-linter', () => {
  describe('CLEAN — passes additive migrations', () => {
    it('CREATE TABLE / ADD COLUMN / CREATE INDEX', () => {
      const sql = `
        CREATE TABLE "foo" ("id" TEXT PRIMARY KEY);
        ALTER TABLE "bar" ADD COLUMN "x" TEXT;
        CREATE UNIQUE INDEX "bar_x_key" ON "bar"("x");
      `;
      const r = lintSql('test.sql', sql);
      expect(r.violations).toEqual([]);
    });

    it('SET NOT NULL with a DEFAULT in the same window', () => {
      const sql = `
        ALTER TABLE "bar" ADD COLUMN "x" TEXT;
        UPDATE "bar" SET "x" = 'unknown' WHERE "x" IS NULL;
        ALTER TABLE "bar" ALTER COLUMN "x" SET DEFAULT 'unknown';
        ALTER TABLE "bar" ALTER COLUMN "x" SET NOT NULL;
      `;
      const r = lintSql('test.sql', sql);
      expect(r.violations).toEqual([]);
    });
  });

  describe('FLAGS destructive DDL', () => {
    it('flags DROP TABLE', () => {
      const r = lintSql('drop-table.sql', 'DROP TABLE "foo";');
      expect(r.violations).toHaveLength(1);
      expect(r.violations[0]?.rule).toBe('drop-table');
    });

    it('flags DROP COLUMN', () => {
      const r = lintSql('drop-col.sql', 'ALTER TABLE "foo" DROP COLUMN "old_col";');
      expect(r.violations[0]?.rule).toBe('drop-column');
    });

    it('flags RENAME COLUMN', () => {
      const r = lintSql('rename.sql', 'ALTER TABLE "foo" RENAME COLUMN "old" TO "new";');
      expect(r.violations[0]?.rule).toBe('rename-column');
    });

    it('flags RENAME TO (table or type)', () => {
      const tbl = lintSql('a.sql', 'ALTER TABLE "foo" RENAME TO "foo_old";');
      const typ = lintSql('b.sql', 'ALTER TYPE "Status" RENAME TO "Status_old";');
      expect(tbl.violations[0]?.rule).toBe('rename-table');
      expect(typ.violations[0]?.rule).toBe('rename-table');
    });

    it('flags ALTER COLUMN ... TYPE', () => {
      const r = lintSql('alter.sql', 'ALTER TABLE "foo" ALTER COLUMN "x" TYPE INTEGER;');
      expect(r.violations[0]?.rule).toBe('alter-column-type');
    });

    it('flags SET NOT NULL with no DEFAULT in the window', () => {
      const r = lintSql('nn.sql', 'ALTER TABLE "foo" ALTER COLUMN "x" SET NOT NULL;');
      expect(r.violations[0]?.rule).toBe('set-not-null-no-default');
    });

    it('flags TRUNCATE', () => {
      const r = lintSql('t.sql', 'TRUNCATE TABLE "foo";');
      expect(r.violations[0]?.rule).toBe('truncate');
    });

    it('flags DROP TYPE', () => {
      const r = lintSql('dt.sql', 'DROP TYPE "MyEnum";');
      expect(r.violations[0]?.rule).toBe('drop-type');
    });

    it('skips comment-only lines', () => {
      const r = lintSql('c.sql', '-- DROP TABLE "foo"; (in a comment, not actually run)');
      expect(r.violations).toEqual([]);
    });
  });

  describe('ALLOW annotation', () => {
    it('marks the file as allowed when the annotation is present', () => {
      const sql = `-- migration-linter: allow-destructive (reason: backfill in same migration)
        ALTER TABLE "foo" DROP COLUMN "old";`;
      const r = lintSql('a.sql', sql);
      expect(r.violations).toHaveLength(1); // still detected
      expect(r.allowed).toBe(true);
      expect(r.allowReason).toBe('backfill in same migration');
    });

    it('does NOT swallow violations when no reason is given', () => {
      // Annotation requires `reason: ...` payload. Without it, the
      // regex doesn't match and `allowed` is false.
      const sql = `-- migration-linter: allow-destructive
        DROP TABLE "foo";`;
      const r = lintSql('a.sql', sql);
      expect(r.allowed).toBe(false);
      expect(r.violations[0]?.rule).toBe('drop-table');
    });
  });
});
