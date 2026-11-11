// packages/db/src/landscape-atlas/scales.ts
import { healthZone, type HealthZone } from '@kku/shared';
import type { PlotTick, Tone } from './types';

const HEALTH_ZONE_TONE: Record<HealthZone, Tone> = {
  danger: 'negative',
  attention: 'warning',
  healthy: 'positive',
};

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** Linear position of `v` in [min, max], as 0–100. */
export function linearPos(v: number, min: number, max: number): number {
  if (!(max > min)) return 50;
  return clamp01((v - min) / (max - min)) * 100;
}

/** Log position of `v` in [min, max], as 0–100. Non-positive values sit at 0. */
export function logPos(v: number, min: number, max: number): number {
  if (!(v > 0) || !(min > 0) || !(max > min)) return 0;
  return clamp01((Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 100;
}

/** 1-2-5 ticks inside [min, max] for a log axis. */
export function logTicks(min: number, max: number, format: (v: number) => string): PlotTick[] {
  if (!(min > 0) || !(max > min)) return [];
  const out: PlotTick[] = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) {
      const v = Number((m * 10 ** e).toPrecision(12));
      if (v >= min && v <= max) out.push({ at: logPos(v, min, max), label: format(v) });
    }
  }
  return out;
}

/** Health-score band as a tone; null (no score) is neutral. */
export function healthTone(score: number | null): Tone {
  const zone = healthZone(score);
  return zone === null ? 'neutral' : HEALTH_ZONE_TONE[zone];
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Mean of the values that are present; null when none are. */
export function meanOf(values: ReadonlyArray<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** A share (0–1) as a percentage label. */
export function pctLabel(share: number): string {
  return `${(share * 100).toFixed(share < 0.01 ? 2 : 1)}%`;
}

/** Thai baht, short: ฿850k, ฿1.2M, ฿14M. */
export function thbShort(v: number): string {
  if (v >= 1_000_000) return `฿${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  return `฿${Math.round(v / 1000)}k`;
}
