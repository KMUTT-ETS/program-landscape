// ────────────────────────────────────────────────────────────────────────────
// Oracle client helper — KKU-internal Oracle data warehouses.
//
// Used by:
//   - kku-registry connector (POWERBI views on the registrar warehouse)
//   - kku-hr connector       (planned)
//   - kku-finance connector  (planned)
//
// Runs in `oracledb` thin mode (default in v6+) — no Oracle Instant
// Client native lib, no Dockerfile changes. Thin mode requires server
// >= 12.1; if the registrar turns out to be 11g and connect fails, we
// switch to thick mode (one apt-get line) and document the fallback.
//
// Connection scope:
//   - One connection per query batch via withConnection().
//   - No pool — these queries run daily, single-threaded, short-lived.
//   - Aggregation happens server-side; the connection sees pre-rolled
//     result sets, not row-level PII. PDPA posture is enforced by the
//     SQL we write, not by anything in this file.
// ────────────────────────────────────────────────────────────────────────────

import oracledb from 'oracledb';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

export interface OracleConfig {
  host: string;
  port: number;
  service: string;
  user: string;
  password: string;
}

export function connectString(cfg: OracleConfig): string {
  // Easy Connect Plus: host:port/service-name
  return `${cfg.host}:${cfg.port}/${cfg.service}`;
}

export async function withConnection<T>(
  cfg: OracleConfig,
  fn: (conn: oracledb.Connection) => Promise<T>,
): Promise<T> {
  const connection = await oracledb.getConnection({
    user: cfg.user,
    password: cfg.password,
    connectString: connectString(cfg),
  });
  try {
    return await fn(connection);
  } finally {
    try {
      await connection.close();
    } catch {
      // Close errors aren't actionable here.
    }
  }
}

// ── OracleSession — one login per script invocation ─────────────────────────
//
// `withConnection` performs a full TCP + logon handshake per call. That's
// fine for a connector doing 1-2 batches a day, but the per-program linker
// scripts were calling it inside a ~300-program loop — ~300 logons in
// minutes, which the registrar's logon-rate policy read as a connection
// storm and answered by LOCKING our account (2026-07). Loops must open ONE
// session up front and run every query through it.
//
// Failure posture:
//   - Connection lost mid-loop → reconnect once, retry the callback once.
//   - Any other error → propagate; the connection is kept for the next call.
//   - Connect-time failures are NEVER retried here — hammering a failing
//     login is exactly the behaviour that escalates into an account lock.
//     The caller decides whether the whole run should abort.

const CONNECTION_LOSS_PATTERN =
  /ORA-(03113|03114|03135|12170|12537|12541|12514|12571)|NJS-(003|500|501|510)|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT/;

export function isConnectionLossError(err: unknown): boolean {
  if (err == null) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return CONNECTION_LOSS_PATTERN.test(msg);
}

export class OracleSession {
  private conn: oracledb.Connection | null = null;
  private closed = false;

  constructor(
    private readonly cfg: OracleConfig,
    private readonly connect: () => Promise<oracledb.Connection> = () =>
      oracledb.getConnection({
        user: cfg.user,
        password: cfg.password,
        connectString: connectString(cfg),
      }),
  ) {}

  private async getConn(): Promise<oracledb.Connection> {
    if (this.closed) throw new Error('OracleSession is closed');
    if (!this.conn) this.conn = await this.connect();
    return this.conn;
  }

  private async discardConn(): Promise<void> {
    const dead = this.conn;
    this.conn = null;
    if (dead) {
      try {
        await dead.close();
      } catch {
        // Already broken — nothing actionable.
      }
    }
  }

  async run<T>(fn: (conn: oracledb.Connection) => Promise<T>): Promise<T> {
    const conn = await this.getConn();
    try {
      return await fn(conn);
    } catch (err) {
      if (!isConnectionLossError(err)) throw err;
      // One reconnect + one retry; a second loss propagates.
      await this.discardConn();
      const fresh = await this.getConn();
      return fn(fresh);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.discardConn();
  }
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  conn: oracledb.Connection,
  sql: string,
  binds: oracledb.BindParameters = {},
): Promise<T[]> {
  const result = await conn.execute<T>(sql, binds);
  return (result.rows ?? []) as T[];
}

export function configFromEnv(prefix: string = 'KKU_REGISTRY_DB'): OracleConfig {
  const required = ['HOST', 'PORT', 'SERVICE', 'USER', 'PASSWORD'];
  const missing = required.filter((k) => !process.env[`${prefix}_${k}`]);
  if (missing.length > 0) {
    throw new Error(
      `Oracle config missing env vars: ${missing.map((k) => `${prefix}_${k}`).join(', ')}. ` +
        `Set them in .env or export to the shell before running.`,
    );
  }
  return {
    host: process.env[`${prefix}_HOST`]!,
    port: Number(process.env[`${prefix}_PORT`]),
    service: process.env[`${prefix}_SERVICE`]!,
    user: process.env[`${prefix}_USER`]!,
    password: process.env[`${prefix}_PASSWORD`]!,
  };
}
