// OracleSession — one login per script invocation instead of one per
// query batch. Born out of the registrar-side account lock (2026-07):
// per-program linker loops opened ~300 standalone connections per run,
// which the registrar's logon-rate policy read as a connection storm.
//
// Contract under test:
//   1. The session connects lazily and REUSES one connection across
//      many run() calls (this is the whole point).
//   2. On a connection-loss error mid-run it reconnects ONCE and
//      retries the callback; a second loss propagates.
//   3. Non-connection errors propagate immediately without reconnect.
//   4. Connect-time failures are never retried (fail fast — retrying a
//      failing login is exactly what escalates into an account lock).
//   5. close() is idempotent and a closed session can't be reused.

import { describe, expect, it, vi } from 'vitest';
import type oracledb from 'oracledb';
import { OracleSession, isConnectionLossError } from '../src/lib/oracle-client';

type FakeConn = {
  execute: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function fakeConn(): FakeConn {
  return {
    execute: vi.fn(async () => ({ rows: [] })),
    close: vi.fn(async () => undefined),
  };
}

const CFG = {
  host: 'test-host',
  port: 1521,
  service: 'TESTSVC',
  user: 'test_user',
  password: 'test_pw',
};

function sessionWith(connect: () => Promise<FakeConn>): OracleSession {
  return new OracleSession(CFG, connect as unknown as () => Promise<oracledb.Connection>);
}

describe('OracleSession', () => {
  it('reuses a single connection across many run() calls', async () => {
    const conn = fakeConn();
    const connect = vi.fn(async () => conn);
    const session = sessionWith(connect);

    for (let i = 0; i < 25; i++) {
      await session.run(async (c) => (c as unknown as FakeConn).execute('SELECT 1'));
    }

    expect(connect).toHaveBeenCalledTimes(1);
    expect(conn.execute).toHaveBeenCalledTimes(25);
    await session.close();
    expect(conn.close).toHaveBeenCalledTimes(1);
  });

  it('does not connect until the first run()', async () => {
    const connect = vi.fn(async () => fakeConn());
    const session = sessionWith(connect);
    expect(connect).not.toHaveBeenCalled();
    await session.close(); // closing an unopened session is a no-op
    expect(connect).not.toHaveBeenCalled();
  });

  it('reconnects once on connection loss and retries the callback', async () => {
    const dead = fakeConn();
    const alive = fakeConn();
    const conns = [dead, alive];
    const connect = vi.fn(async () => conns.shift()!);
    const session = sessionWith(connect);

    let calls = 0;
    const result = await session.run(async () => {
      calls += 1;
      if (calls === 1) throw new Error('ORA-03113: end-of-file on communication channel');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(connect).toHaveBeenCalledTimes(2);
    expect(dead.close).toHaveBeenCalledTimes(1); // dead conn discarded
  });

  it('propagates a second consecutive connection loss without a third connect', async () => {
    const connect = vi.fn(async () => fakeConn());
    const session = sessionWith(connect);

    await expect(
      session.run(async () => {
        throw new Error('ORA-03135: connection lost contact');
      }),
    ).rejects.toThrow('ORA-03135');
    expect(connect).toHaveBeenCalledTimes(2); // initial + one reconnect, no more
  });

  it('propagates non-connection errors without reconnecting', async () => {
    const conn = fakeConn();
    const connect = vi.fn(async () => conn);
    const session = sessionWith(connect);

    await expect(
      session.run(async () => {
        throw new Error('ORA-00942: table or view does not exist');
      }),
    ).rejects.toThrow('ORA-00942');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(conn.close).not.toHaveBeenCalled(); // connection kept for next run

    // Session still usable afterwards on the SAME connection.
    await session.run(async () => 'fine');
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('does not retry connect-time failures (fail fast, no login hammering)', async () => {
    const connect = vi.fn(async () => {
      throw new Error('ORA-01017: invalid username/password; logon denied');
    });
    const session = sessionWith(connect);

    await expect(session.run(async () => 'unreachable')).rejects.toThrow('ORA-01017');
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('close() is idempotent and blocks further use', async () => {
    const conn = fakeConn();
    const connect = vi.fn(async () => conn);
    const session = sessionWith(connect);

    await session.run(async () => 'x');
    await session.close();
    await session.close();
    expect(conn.close).toHaveBeenCalledTimes(1);

    await expect(session.run(async () => 'y')).rejects.toThrow(/closed/i);
  });
});

describe('isConnectionLossError', () => {
  it.each([
    'ORA-03113: end-of-file on communication channel',
    'ORA-03135: connection lost contact',
    'ORA-12170: TNS:Connect timeout occurred',
    'ORA-12537: TNS:connection closed',
    'ORA-12541: TNS:no listener',
    'NJS-003: invalid or closed connection',
    'NJS-500: connection to the Oracle Database was broken',
    'read ECONNRESET',
    'write EPIPE',
  ])('recognises "%s"', (msg) => {
    expect(isConnectionLossError(new Error(msg))).toBe(true);
  });

  it.each([
    'ORA-00942: table or view does not exist',
    'ORA-01017: invalid username/password; logon denied',
    'ORA-28000: the account is locked',
    'plain application error',
  ])('does NOT match "%s"', (msg) => {
    expect(isConnectionLossError(new Error(msg))).toBe(false);
  });

  it('handles non-Error values', () => {
    expect(isConnectionLossError('ORA-03113 as a string')).toBe(true);
    expect(isConnectionLossError(null)).toBe(false);
    expect(isConnectionLossError(undefined)).toBe(false);
  });
});
