// programs:overlap CLI argument parsing — kept out of the script so it can be
// tested without running main().
import type { ProgramLevel } from '@kku/db';
import { LEVELS } from './run';

export const OVERLAP_USAGE =
  'Usage: pnpm programs:overlap [--level=<BACHELOR|MASTER|DOCTORAL|HIGHER_GRAD_DIPLOMA>] [--apply] [--no-ai] [--calibrate]';
const BOOLEAN_FLAGS = new Set(['--apply', '--no-ai', '--calibrate']);
const VALUED_FLAGS = new Set(['--level']);

export interface OverlapCliArgs {
  level: ProgramLevel | undefined;
  apply: boolean;
  noAi: boolean;
  calibrate: boolean;
}

/** Accepts `--level=X` and `--level X`; anything unknown is a usage error. */
export function parseOverlapArgs(argv: readonly string[]): OverlapCliArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (VALUED_FLAGS.has(name)) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`${name} needs a value\n${OVERLAP_USAGE}`);
      values.set(name, value);
    } else if (BOOLEAN_FLAGS.has(arg)) {
      flags.add(arg);
    } else {
      throw new Error(`unknown argument "${arg}"\n${OVERLAP_USAGE}`);
    }
  }
  let level: ProgramLevel | undefined;
  const raw = values.get('--level')?.toUpperCase();
  if (raw !== undefined) {
    level = LEVELS.find((l) => l === raw);
    if (!level) throw new Error(`unknown --level=${raw}; expected one of ${LEVELS.join(', ')}\n${OVERLAP_USAGE}`);
  }
  return { level, apply: flags.has('--apply'), noAi: flags.has('--no-ai'), calibrate: flags.has('--calibrate') };
}
