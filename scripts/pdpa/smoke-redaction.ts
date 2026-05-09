// Smoke test for PDPA log redaction. Pipe a synthetic record carrying
// a 13-digit Thai citizen ID + secret + token through pino with the
// production redaction config; assert no raw ID survives in stdout.
//
// Run from repo root:
//   pnpm tsx scripts/pdpa/smoke-redaction.ts
//
// Exits 0 when redaction works; 1 if any raw 13-digit ID is found in the
// emitted log line. Used by the acceptance gate of the PDPA report.

import pino, { stdTimeFunctions } from 'pino';
import { REDACT_PATHS, scrubLogObject } from '@kku/shared';

const PROBE_ID = '1234567890123';
const PROBE_PWD = 'super-secret-do-not-leak';
const PROBE_TOKEN = 'tok_abc123def456';

const captured: string[] = [];
const stream = {
  write(line: string): void {
    captured.push(line);
    process.stdout.write(line);
  },
};

const logger = pino(
  {
    level: 'info',
    timestamp: stdTimeFunctions.isoTime,
    redact: { paths: [...REDACT_PATHS], remove: true },
    formatters: {
      log(obj) {
        return scrubLogObject(obj);
      },
    },
  },
  stream,
);

logger.info(
  {
    user: { id: 'u-1', citizenId: PROBE_ID, password: PROBE_PWD },
    message: `fetched ${PROBE_ID} from upstream`,
    headers: { authorization: `Bearer ${PROBE_TOKEN}`, cookie: 'a=b' },
    body: { secret: PROBE_PWD, token: PROBE_TOKEN, nationalId: PROBE_ID },
  },
  'pdpa smoke',
);

const allOutput = captured.join('');

const failures: string[] = [];
if (allOutput.includes(PROBE_ID)) failures.push(`raw 13-digit ID "${PROBE_ID}" present`);
if (allOutput.includes(PROBE_PWD)) failures.push(`raw password "${PROBE_PWD}" present`);
if (allOutput.includes(PROBE_TOKEN)) failures.push(`raw token "${PROBE_TOKEN}" present`);
if (/\b\d{13}\b/.test(allOutput)) failures.push('any other 13-digit run present');

process.stdout.write('\n');
if (failures.length === 0) {
  process.stdout.write('PASS — pino redaction kept all PII out of the log line.\n');
  process.exit(0);
} else {
  process.stderr.write(`FAIL — pino leaked PII:\n  - ${failures.join('\n  - ')}\n`);
  process.exit(1);
}
