import { describe, expect, it, vi } from 'vitest';
import { RunLog, isThaiNationalId, maskPii, type RunLogLine } from '../src/connectors/run-log';

function collector() {
  const written: RunLogLine[][] = [];
  const writer = vi.fn(async (lines: RunLogLine[]) => {
    written.push(lines);
  });
  return { written, writer, all: () => written.flat() };
}

describe('maskPii', () => {
  // 1-1018-01000-00-1 is not a real person; the check digit is computed.
  const id = '1101801000001';
  const validId = (() => {
    const d = id.slice(0, 12);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i);
    return d + String((11 - (sum % 11)) % 10);
  })();

  it('validates the Thai national-ID checksum', () => {
    expect(isThaiNationalId(validId)).toBe(true);
    const wrong = validId.slice(0, 12) + String((Number(validId[12]) + 1) % 10);
    expect(isThaiNationalId(wrong)).toBe(false);
  });

  it('masks national IDs (plain and dashed), emails and phone numbers', () => {
    const dashed = `${validId[0]}-${validId.slice(1, 5)}-${validId.slice(5, 10)}-${validId.slice(10, 12)}-${validId[12]}`;
    const out = maskPii(`id ${validId} / ${dashed} mail a.b@example.ac.th tel 081-234-5678`);
    expect(out).toBe(
      'id [REDACTED_ID] / [REDACTED_ID] mail [REDACTED_EMAIL] tel [REDACTED_PHONE]',
    );
  });

  it('leaves counts, years and non-checksum 13-digit numbers alone', () => {
    const wrong = validId.slice(0, 12) + String((Number(validId[12]) + 1) % 10);
    expect(maskPii(`Fetched 12,345 rows for 2568 (${wrong})`)).toBe(
      `Fetched 12,345 rows for 2568 (${wrong})`,
    );
  });
});

describe('RunLog', () => {
  it('batches lines with increasing seq and writes on flush', async () => {
    const c = collector();
    const log = new RunLog('run-1', c.writer, { flushIntervalMs: 60_000 });
    log.add('INFO', 'one');
    log.add('WARN', 'two', { n: 2 });
    expect(c.writer).not.toHaveBeenCalled();
    await log.flush();
    expect(c.writer).toHaveBeenCalledTimes(1);
    expect(c.all().map((l) => [l.seq, l.level, l.message, l.ingestionRunId])).toEqual([
      [1, 'INFO', 'one', 'run-1'],
      [2, 'WARN', 'two', 'run-1'],
    ]);
    expect(c.all()[1]?.meta).toEqual({ n: 2 });
  });

  it('flushes on its own after the interval', async () => {
    vi.useFakeTimers();
    try {
      const c = collector();
      const log = new RunLog('run-1', c.writer, { flushIntervalMs: 2_000 });
      log.add('INFO', 'tick');
      await vi.advanceTimersByTimeAsync(2_000);
      expect(c.all()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps connector lines, writes one truncation marker, but keeps forced lines', async () => {
    const c = collector();
    const log = new RunLog('run-1', c.writer, { maxLines: 3, flushIntervalMs: 60_000 });
    for (let i = 0; i < 10; i++) log.add('INFO', `line ${i}`);
    log.add('ERROR', '[runner] failed', undefined, { force: true });
    await log.close();
    const msgs = c.all().map((l) => l.message);
    expect(msgs).toHaveLength(5);
    expect(msgs.slice(0, 3)).toEqual(['line 0', 'line 1', 'line 2']);
    expect(msgs[3]).toMatch(/^Log truncated/);
    expect(msgs[4]).toBe('[runner] failed');
    expect(c.all().map((l) => l.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('masks PII in message and meta before storing', async () => {
    const c = collector();
    const log = new RunLog('run-1', c.writer);
    log.add('ERROR', 'bad row for x@y.com', { email: 'x@y.com', count: 3 });
    await log.close();
    expect(c.all()[0]?.message).toBe('bad row for [REDACTED_EMAIL]');
    expect(c.all()[0]?.meta).toEqual({ email: '[REDACTED_EMAIL]', count: 3 });
  });

  it('truncates very long messages', async () => {
    const c = collector();
    const log = new RunLog('run-1', c.writer);
    log.add('INFO', 'x'.repeat(10_000));
    await log.close();
    expect(c.all()[0]?.message.length).toBeLessThan(4_100);
    expect(c.all()[0]?.message).toMatch(/chars truncated]$/);
  });

  it('never rejects when the writer fails, and ignores lines after close', async () => {
    const writer = vi.fn(async () => {
      throw new Error('db down');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = new RunLog('run-1', writer);
    log.add('INFO', 'a');
    await expect(log.flush()).resolves.toBeUndefined();
    log.add('INFO', 'b');
    await expect(log.close()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    log.add('INFO', 'after close');
    await log.flush();
    expect(writer).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
