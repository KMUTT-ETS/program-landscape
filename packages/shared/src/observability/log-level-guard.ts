// Refuse to boot the api / ingestion processes in production with a
// debug-or-finer log level. Debug logs in production:
//   1. blow disk on json-file rotation faster than rotation can keep up,
//   2. routinely capture object dumps that the redaction list isn't
//      tuned for (since redaction expects "user gave us this body, log
//      that" — debug-level dumps tend to log internal structures we
//      forgot to add to the redaction set).
//
// Each app's bootstrap calls assertLogLevelSafe() before constructing
// the LoggerModule. Throws synchronously on misconfiguration — the
// process never starts with a too-noisy logger.

const DISALLOWED_IN_PROD = new Set(['trace', 'debug', 'silly']);

export function assertLogLevelSafe(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const lvl = (process.env.LOG_LEVEL ?? '').trim().toLowerCase();
  if (!lvl) return; // empty → app falls back to its own default ('info')
  if (DISALLOWED_IN_PROD.has(lvl)) {
    throw new Error(
      `LOG_LEVEL='${lvl}' is not permitted in production. ` +
        `Disallowed: ${[...DISALLOWED_IN_PROD].join(', ')}. ` +
        `Set LOG_LEVEL=info (default) or 'warn'/'error' to launch.`,
    );
  }
}
