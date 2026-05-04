// Thin wrapper around `oracledb` for the Education dashboard refresh.
// Mirrors the helper in apps/ingestion/src/lib/oracle-client.ts so the
// api can read POWERBI views directly when an analyst clicks the
// "Refresh" button. No connection pool — refreshes are infrequent and
// short-lived.

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

export async function query<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  conn: oracledb.Connection,
  sql: string,
  binds: oracledb.BindParameters = {},
): Promise<T[]> {
  const result = await conn.execute<T>(sql, binds);
  return (result.rows ?? []) as T[];
}

export function configFromEnv(prefix = 'KKU_REGISTRY_DB'): OracleConfig {
  const required = ['HOST', 'PORT', 'SERVICE', 'USER', 'PASSWORD'];
  const missing = required.filter((k) => !process.env[`${prefix}_${k}`]);
  if (missing.length > 0) {
    throw new Error(
      `Oracle config missing env vars: ${missing
        .map((k) => `${prefix}_${k}`)
        .join(', ')}. Set them in .env or export to the shell.`,
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
