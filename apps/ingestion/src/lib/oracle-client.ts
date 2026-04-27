// ────────────────────────────────────────────────────────────────────────────
// Oracle client helper — KKU-internal Oracle data warehouses.
//
// Used by:
//   - kku-registry connector (POWERBI views on regora19scan.kku.ac.th)
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
      `Oracle config missing env vars: ${missing
        .map((k) => `${prefix}_${k}`)
        .join(', ')}. ` +
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
