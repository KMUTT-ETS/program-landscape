import { Prisma, prisma } from '@kku/db';

// ─────────────────────────────────────────────────────────────────────────────
// Per-run log capture for ConnectorRunner.
//
// Every connector already writes through `ctx.log` (ConnectorContext.log).
// The runner wraps that logger with a RunLog, which keeps the console output
// as before and additionally buffers each line for the `ingestion_run_logs`
// table, read by the "Log" modal on /admin/data-sources/<slug>.
//
// Rules:
//   - Writes are batched (every FLUSH_INTERVAL_MS, and on close) so a chatty
//     connector does not issue one INSERT per line.
//   - A failed write is swallowed (reported to the console once). Logging must
//     never fail or slow down the run it describes.
//   - Connector lines are capped at MAX_LOG_LINES per run; past that a single
//     "truncated" line is written and the rest dropped. Runner step markers
//     (`force: true`) bypass the cap so the run's outcome is always recorded.
//   - Messages and meta are masked for Thai national IDs, emails and phone
//     numbers before they are stored (PDPA — see docs/pdpa.md).
// ─────────────────────────────────────────────────────────────────────────────

export type RunLogLevel = 'INFO' | 'WARN' | 'ERROR';

export const MAX_LOG_LINES = 5_000;
export const MAX_MESSAGE_CHARS = 4_000;
export const MAX_META_CHARS = 8_000;
export const FLUSH_INTERVAL_MS = 2_000;

export interface RunLogLine {
  ingestionRunId: string;
  seq: number;
  ts: Date;
  level: RunLogLevel;
  message: string;
  meta: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

export type RunLogWriter = (lines: RunLogLine[]) => Promise<unknown>;

const defaultWriter: RunLogWriter = (lines) => prisma.ingestionRunLog.createMany({ data: lines });

// ── PII masking ─────────────────────────────────────────────────────────────

/** Thai national ID checksum: digit 13 = (11 − Σ dᵢ·(13−i) mod 11) mod 10. */
export function isThaiNationalId(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

const ID_RE = /(?<![\d])(\d)[- ]?(\d{4})[- ]?(\d{5})[- ]?(\d{2})[- ]?(\d)(?![\d])/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Thai mobile/landline: 0 + 8 or 9 more digits, optionally split by - or space.
const PHONE_RE = /(?<![\d])0\d{1,2}[- ]?\d{3}[- ]?\d{3,4}(?![\d])/g;

export function maskPii(text: string): string {
  return text
    .replace(ID_RE, (m, a: string, b: string, c: string, d: string, e: string) =>
      isThaiNationalId(a + b + c + d + e) ? '[REDACTED_ID]' : m,
    )
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(PHONE_RE, '[REDACTED_PHONE]');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [${text.length - max} chars truncated]`;
}

function prepareMeta(
  meta: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (meta === undefined) return Prisma.JsonNull;
  let json: string;
  try {
    json = JSON.stringify(meta, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return { unserializable: true };
  }
  const masked = maskPii(json);
  if (masked.length > MAX_META_CHARS) {
    return { truncated: true, preview: masked.slice(0, MAX_META_CHARS) };
  }
  return JSON.parse(masked) as Prisma.InputJsonValue;
}

// ── RunLog ──────────────────────────────────────────────────────────────────

export class RunLog {
  private seq = 0;
  private connectorLines = 0;
  private truncated = false;
  private buffer: RunLogLine[] = [];
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();
  private writeFailed = false;
  private closed = false;

  constructor(
    private readonly runId: string,
    private readonly writer: RunLogWriter = defaultWriter,
    private readonly opts: { maxLines?: number; flushIntervalMs?: number } = {},
  ) {}

  add(
    level: RunLogLevel,
    message: string,
    meta?: Record<string, unknown>,
    options: { force?: boolean } = {},
  ): void {
    if (this.closed) return;
    if (!options.force) {
      const max = this.opts.maxLines ?? MAX_LOG_LINES;
      if (this.connectorLines >= max) {
        if (!this.truncated) {
          this.truncated = true;
          this.push('WARN', `Log truncated: more than ${max} lines; further connector lines were dropped.`);
        }
        return;
      }
      this.connectorLines++;
    }
    this.push(level, message, meta);
  }

  private push(level: RunLogLevel, message: string, meta?: Record<string, unknown>): void {
    this.buffer.push({
      ingestionRunId: this.runId,
      seq: ++this.seq,
      ts: new Date(),
      level,
      message: truncate(maskPii(message), MAX_MESSAGE_CHARS),
      meta: prepareMeta(meta),
    });
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.opts.flushIntervalMs ?? FLUSH_INTERVAL_MS);
      this.timer.unref?.();
    }
  }

  /** Writes buffered lines. Never rejects. Calls are serialised so seq order holds. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.buffer;
    this.buffer = [];
    if (batch.length === 0) return this.chain;
    this.chain = this.chain.then(async () => {
      try {
        await this.writer(batch);
      } catch (err) {
        if (!this.writeFailed) {
          this.writeFailed = true;
          console.warn(
            `[run-log] could not store log lines for run ${this.runId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    });
    return this.chain;
  }

  /** Final flush; later add() calls are ignored. */
  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
  }
}
