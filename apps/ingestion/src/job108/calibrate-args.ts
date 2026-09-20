// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing for `pnpm job108:calibrate` (apps/ingestion/src/scripts/
// job108-calibrate.ts), split into its own module for the same reason
// `job108/backfill-args.ts` is separate from the script it serves: the
// script file calls `main()` at module load, so importing it directly for a
// unit test would run the real thing (and spend real money). This module is
// pure and side-effect free.
//
// The only flag is --sample=N, and it is capped HARD at 150 — this script
// spends one real model call per sampled posting, and the task that
// commissioned it has a non-negotiable USD budget. Refusing an over-cap
// value outright (rather than clamping it silently) means a typo like
// `--sample=1500` fails loudly instead of quietly spending 10x the budget.
// ─────────────────────────────────────────────────────────────────────────────

export const JOB108_CALIBRATE_DEFAULT_SAMPLE = 100;
export const JOB108_CALIBRATE_MAX_SAMPLE = 150;

export interface Job108CalibrateArgs {
  sample: number;
}

export type ParsedJob108CalibrateArgs =
  | { ok: true; args: Job108CalibrateArgs }
  | { ok: false; error: string };

const ACCEPTED_FLAGS = `--sample=N (N a positive integer, default ${JOB108_CALIBRATE_DEFAULT_SAMPLE}, hard cap ${JOB108_CALIBRATE_MAX_SAMPLE})`;

export function parseCalibrateArgs(argv: string[]): ParsedJob108CalibrateArgs {
  let sample = JOB108_CALIBRATE_DEFAULT_SAMPLE;

  for (const arg of argv) {
    if (arg.startsWith('--sample=')) {
      const raw = arg.slice('--sample='.length);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        return {
          ok: false,
          error: `--sample must be a positive integer, got "${raw}". Accepted flags: ${ACCEPTED_FLAGS}`,
        };
      }
      if (n > JOB108_CALIBRATE_MAX_SAMPLE) {
        return {
          ok: false,
          error:
            `--sample=${n} exceeds the hard cap of ${JOB108_CALIBRATE_MAX_SAMPLE} model calls. ` +
            `This is a real-money run against a live model — the cap is not adjustable from the ` +
            `command line. Accepted flags: ${ACCEPTED_FLAGS}`,
        };
      }
      sample = n;
    } else {
      return { ok: false, error: `Unrecognised flag "${arg}". Accepted flags: ${ACCEPTED_FLAGS}` };
    }
  }

  return { ok: true, args: { sample } };
}
