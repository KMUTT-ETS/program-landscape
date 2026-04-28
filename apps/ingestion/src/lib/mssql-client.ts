// ────────────────────────────────────────────────────────────────────────────
// Microsoft SQL Server client helper — KKU HR + future SQL-Server sources.
//
// Used by:
//   - kku-hr connector (HCMEmployee on 10.101.104.192)
//
// Driver: `mssql` package (uses `tedious` underneath — pure JS, no native
// libs, no Dockerfile changes). Same lifecycle pattern as the
// Oracle helper (apps/ingestion/src/lib/oracle-client.ts):
//   - One ConnectionPool per query batch via withConnection().
//   - No long-lived pool — these queries run weekly, single-threaded.
//   - Aggregation happens server-side; the connection sees pre-rolled
//     result sets, not row-level PII (where applicable).
//
// SQL Server's "encrypt" + "trustServerCertificate" defaults changed in
// recent driver versions — for KKU's 10.101.104.192 we set encrypt=false
// because the server isn't configured for TLS, and trustServerCertificate
// is irrelevant in that case but kept available as a future flip.
// ────────────────────────────────────────────────────────────────────────────

import sql, { type ConnectionPool } from 'mssql';

export interface MssqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export async function withConnection<T>(
  cfg: MssqlConfig,
  fn: (pool: ConnectionPool) => Promise<T>,
): Promise<T> {
  const pool = await sql.connect({
    server: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: {
      encrypt: cfg.encrypt,
      trustServerCertificate: cfg.trustServerCertificate,
    },
    pool: {
      max: 1,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
    requestTimeout: 30_000,
    connectionTimeout: 15_000,
  });
  try {
    return await fn(pool);
  } finally {
    try {
      await pool.close();
    } catch {
      // Close errors aren't actionable here.
    }
  }
}

export async function query<T = Record<string, unknown>>(
  pool: ConnectionPool,
  sqlText: string,
  binds: Record<string, unknown> = {},
): Promise<T[]> {
  const request = pool.request();
  for (const [key, value] of Object.entries(binds)) {
    request.input(key, value);
  }
  const result = await request.query<T>(sqlText);
  return (result.recordset ?? []) as T[];
}

export function configFromEnv(prefix: string = 'KKU_HR_DB'): MssqlConfig {
  const required = ['HOST', 'PORT', 'DATABASE', 'USER', 'PASSWORD'];
  const missing = required.filter((k) => !process.env[`${prefix}_${k}`]);
  if (missing.length > 0) {
    throw new Error(
      `MSSQL config missing env vars: ${missing
        .map((k) => `${prefix}_${k}`)
        .join(', ')}. ` +
        `Set them in .env or export to the shell before running.`,
    );
  }
  return {
    host: process.env[`${prefix}_HOST`]!,
    port: Number(process.env[`${prefix}_PORT`]),
    database: process.env[`${prefix}_DATABASE`]!,
    user: process.env[`${prefix}_USER`]!,
    password: process.env[`${prefix}_PASSWORD`]!,
    encrypt: parseBool(process.env[`${prefix}_ENCRYPT`], false),
    trustServerCertificate: parseBool(
      process.env[`${prefix}_TRUST_SERVER_CERT`],
      true,
    ),
  };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return /^(true|1|yes|on)$/i.test(value);
}
