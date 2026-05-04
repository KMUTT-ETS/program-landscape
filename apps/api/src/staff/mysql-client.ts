// Thin wrapper around `mysql2/promise` for the Processed HR Data mart
// at 202.28.117.84:3306. Mirrors the lifecycle pattern of the Oracle +
// MSSQL helpers (apps/api/src/education/oracle-client.ts,
// apps/ingestion/src/lib/mssql-client.ts):
//   - Single connection per query batch via withConnection().
//   - No long-lived pool — Staff dashboard refreshes are infrequent.
//   - Credentials sourced from .env (KKU_HR_PROCESSED_DB_*).

import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';

export interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export async function withConnection<T>(
  cfg: MysqlConfig,
  fn: (conn: Connection) => Promise<T>,
): Promise<T> {
  const connection = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    // mysql2 accepts `ssl: 'Amazon RDS' | object | undefined`. We only
    // need the boolean toggle today; flip to a CA-pinned object when KKU
    // exposes a TLS-terminating proxy.
    ssl: cfg.ssl ? {} : undefined,
    // The processed-HR server defaults the session to latin1 even
    // though the columns are stored as utf8 (legacy mysql utf8 =
    // utf8mb3, sufficient for Thai which lives in the BMP). Fetched
    // Thai text comes back as '?' without this override. utf8mb4 isn't
    // installed on this old server build, so we use 'utf8' explicitly.
    dateStrings: true,
  });
  try {
    await connection.query("SET NAMES 'utf8'");
    return await fn(connection);
  } finally {
    try {
      await connection.end();
    } catch {
      // Close errors aren't actionable here.
    }
  }
}

export async function query<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  conn: Connection,
  sql: string,
  binds: unknown[] = [],
): Promise<T[]> {
  const [rows] = await conn.query<RowDataPacket[]>(sql, binds);
  return rows as T[];
}

export function configFromEnv(prefix = 'KKU_HR_PROCESSED_DB'): MysqlConfig {
  const required = ['HOST', 'PORT', 'DATABASE', 'USER', 'PASSWORD'];
  const missing = required.filter((k) => !process.env[`${prefix}_${k}`]);
  if (missing.length > 0) {
    throw new Error(
      `MySQL config missing env vars: ${missing
        .map((k) => `${prefix}_${k}`)
        .join(', ')}. Set them in .env or export to the shell.`,
    );
  }
  return {
    host: process.env[`${prefix}_HOST`]!,
    port: Number(process.env[`${prefix}_PORT`]),
    database: process.env[`${prefix}_DATABASE`]!,
    user: process.env[`${prefix}_USER`]!,
    password: process.env[`${prefix}_PASSWORD`]!,
    ssl: parseBool(process.env[`${prefix}_SSL`], false),
  };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return /^(true|1|yes|on)$/i.test(value);
}
