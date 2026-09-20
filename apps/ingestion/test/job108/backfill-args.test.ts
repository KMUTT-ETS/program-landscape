import { describe, expect, it } from 'vitest';

import { parseBackfillArgs } from '../../src/job108/backfill-args';

describe('parseBackfillArgs', () => {
  it('no flags → dry run, no limit, no retry-failed', () => {
    const r = parseBackfillArgs([]);
    expect(r).toEqual({ ok: true, args: { apply: false, limit: null, retryFailed: false } });
  });

  it('--apply → apply', () => {
    const r = parseBackfillArgs(['--apply']);
    expect(r.ok).toBe(true);
    expect(r.ok && r.args.apply).toBe(true);
  });

  it('--limit=10 → limit 10', () => {
    const r = parseBackfillArgs(['--limit=10']);
    expect(r.ok).toBe(true);
    expect(r.ok && r.args.limit).toBe(10);
  });

  it('--limit=abc → rejected', () => {
    const r = parseBackfillArgs(['--limit=abc']);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/positive integer/);
  });

  it('--limit=0 → rejected', () => {
    const r = parseBackfillArgs(['--limit=0']);
    expect(r.ok).toBe(false);
  });

  it('--limit=-5 → rejected', () => {
    const r = parseBackfillArgs(['--limit=-5']);
    expect(r.ok).toBe(false);
  });

  it('--aply (typo) → rejected, not silently dry-run', () => {
    const r = parseBackfillArgs(['--aply']);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Unrecognised flag/);
    expect(!r.ok && r.error).toMatch(/--aply/);
  });

  it('--retry-failed → sets the flag', () => {
    const r = parseBackfillArgs(['--retry-failed']);
    expect(r.ok).toBe(true);
    expect(r.ok && r.args.retryFailed).toBe(true);
    expect(r.ok && r.args.apply).toBe(false);
  });

  it('flags combine: --apply --limit=10 --retry-failed', () => {
    const r = parseBackfillArgs(['--apply', '--limit=10', '--retry-failed']);
    expect(r).toEqual({ ok: true, args: { apply: true, limit: 10, retryFailed: true } });
  });

  it('order does not matter', () => {
    const r = parseBackfillArgs(['--retry-failed', '--limit=25', '--apply']);
    expect(r).toEqual({ ok: true, args: { apply: true, limit: 25, retryFailed: true } });
  });

  it('a typo among otherwise-valid flags still rejects the whole invocation', () => {
    const r = parseBackfillArgs(['--apply', '--limit=10', '--retryfailed']);
    expect(r.ok).toBe(false);
  });
});
