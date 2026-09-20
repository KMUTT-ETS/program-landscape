import { describe, expect, it } from 'vitest';

import {
  JOB108_CALIBRATE_DEFAULT_SAMPLE,
  JOB108_CALIBRATE_MAX_SAMPLE,
  parseCalibrateArgs,
} from '../../src/job108/calibrate-args';

describe('parseCalibrateArgs', () => {
  it('no flags → default sample size', () => {
    const r = parseCalibrateArgs([]);
    expect(r).toEqual({ ok: true, args: { sample: JOB108_CALIBRATE_DEFAULT_SAMPLE } });
  });

  it('--sample=50 → honoured', () => {
    const r = parseCalibrateArgs(['--sample=50']);
    expect(r).toEqual({ ok: true, args: { sample: 50 } });
  });

  it('--sample=150 (the cap itself) → honoured', () => {
    const r = parseCalibrateArgs([`--sample=${JOB108_CALIBRATE_MAX_SAMPLE}`]);
    expect(r).toEqual({ ok: true, args: { sample: JOB108_CALIBRATE_MAX_SAMPLE } });
  });

  it('--sample=500 → refused for exceeding the cap', () => {
    const r = parseCalibrateArgs(['--sample=500']);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/exceeds the hard cap/);
    expect(!r.ok && r.error).toMatch(/150/);
  });

  it('--sample=0 → refused', () => {
    const r = parseCalibrateArgs(['--sample=0']);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/positive integer/);
  });

  it('--sample=-10 → refused', () => {
    const r = parseCalibrateArgs(['--sample=-10']);
    expect(r.ok).toBe(false);
  });

  it('--sample=abc → refused', () => {
    const r = parseCalibrateArgs(['--sample=abc']);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/positive integer/);
  });

  it('unknown flag → refused, not silently ignored', () => {
    const r = parseCalibrateArgs(['--samples=50']);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Unrecognised flag/);
    expect(!r.ok && r.error).toMatch(/--samples=50/);
  });

  it('a bare --apply-style flag with no value → refused', () => {
    const r = parseCalibrateArgs(['--verbose']);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Unrecognised flag/);
  });
});
