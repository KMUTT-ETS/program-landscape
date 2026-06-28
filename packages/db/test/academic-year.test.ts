import { describe, it, expect } from 'vitest';
import {
  deriveAcademicYear,
  defaultNextStartDate,
  academicYearContextSync,
  invalidateAcademicYearCache,
  entryYearComplete,
  entryYearInProgress,
} from '../src/academic-year';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('deriveAcademicYear', () => {
  it('seeded 2026-06-16, now 2026-06-28 → AY 2569 complete, 2570 in progress, stale', () => {
    const ctx = deriveAcademicYear(d('2026-06-16'), d('2026-06-28'));
    expect(ctx.currentAcademicYearBE).toBe(2569);
    expect(ctx.latestCompleteEntryYearBE).toBe(2569);
    expect(ctx.inProgressEntryYearBE).toBe(2570);
    expect(ctx.isStale).toBe(true);
  });

  it('next-start 2027-06-16, now 2026-06-28 → AY 2569, not stale', () => {
    const ctx = deriveAcademicYear(d('2027-06-16'), d('2026-06-28'));
    expect(ctx.currentAcademicYearBE).toBe(2569);
    expect(ctx.latestCompleteEntryYearBE).toBe(2569);
    expect(ctx.isStale).toBe(false);
  });

  it('day before start is not yet rolled over', () => {
    const ctx = deriveAcademicYear(d('2026-06-16'), d('2026-06-15'));
    expect(ctx.currentAcademicYearBE).toBe(2568);
    expect(ctx.isStale).toBe(false);
  });

  it('exactly on start date counts as started', () => {
    const ctx = deriveAcademicYear(d('2026-06-16'), d('2026-06-16'));
    expect(ctx.currentAcademicYearBE).toBe(2569);
    expect(ctx.isStale).toBe(true);
  });

  it('entryYearComplete / entryYearInProgress agree with latestComplete', () => {
    const ctx = deriveAcademicYear(d('2026-06-16'), d('2026-06-28'));
    expect(entryYearComplete(2569, ctx)).toBe(true);
    expect(entryYearComplete(2570, ctx)).toBe(false);
    expect(entryYearInProgress(2570, ctx)).toBe(true);
    expect(entryYearInProgress(2569, ctx)).toBe(false);
  });
});

describe('defaultNextStartDate', () => {
  it('after June 16 → next year June 16 (so derive is not stale)', () => {
    expect(defaultNextStartDate(d('2026-06-28')).toISOString()).toBe('2027-06-16T00:00:00.000Z');
  });
  it('before June 16 → this year June 16', () => {
    expect(defaultNextStartDate(d('2026-03-01')).toISOString()).toBe('2026-06-16T00:00:00.000Z');
  });
  it('default derive yields correct current AY and is never stale', () => {
    const ctx = deriveAcademicYear(defaultNextStartDate(d('2026-06-28')), d('2026-06-28'));
    expect(ctx.currentAcademicYearBE).toBe(2569);
    expect(ctx.isStale).toBe(false);
  });
});

describe('academicYearContextSync (cold cache → default)', () => {
  it('with no warmed cache, uses the default June-16 boundary', () => {
    invalidateAcademicYearCache();
    const ctx = academicYearContextSync(d('2026-06-28'));
    expect(ctx.currentAcademicYearBE).toBe(2569);
    expect(ctx.latestCompleteEntryYearBE).toBe(2569);
  });
});
