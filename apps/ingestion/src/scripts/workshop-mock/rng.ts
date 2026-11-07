import { createHash } from 'node:crypto';

/** Seeded, deterministic PRNG (mulberry32). Never use Math.random in this generator. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [lo, hi], both included. */
  int(lo: number, hi: number): number;
  /** Uniform float in [lo, hi). */
  uniform(lo: number, hi: number): number;
  choice<T>(items: readonly T[]): T;
  /** A shuffled copy (Fisher-Yates); the input is not changed. */
  shuffle<T>(items: readonly T[]): T[];
  /** An independent generator whose stream depends only on this seed and the label. */
  child(label: string): Rng;
}

function seedFrom(text: string): number {
  return createHash('sha256').update(text, 'utf-8').digest().readUInt32BE(0);
}

export function makeRng(seed: string | number): Rng {
  const key = String(seed);
  let a = seedFrom(key);
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    uniform: (lo, hi) => lo + next() * (hi - lo),
    choice: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('choice from an empty list');
      return items[Math.floor(next() * items.length)] as T;
    },
    shuffle: <T>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    },
    child: (label) => makeRng(`${key}/${label}`),
  };
  return rng;
}
