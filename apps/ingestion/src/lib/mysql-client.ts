// MySQL client helper for the ingestion app — used by:
//   - unicon-ds2003 connector (DS2003 / Education qualifications)
//   - unicon-ds2004 connector (DS2004 / Academic staff per program)
//   - future processed-HR mart connector
//
// Lifecycle pattern mirrors the Oracle + MSSQL helpers
// (oracle-client.ts, mssql-client.ts):
//   - Single connection per query batch via withConnection().
//   - No long-lived pool — refreshes are infrequent.
//   - Charset forced to legacy `utf8` (mysql utf8mb3) because some
//     KKU MySQL servers default the session to `latin1` and don't
//     have utf8mb4 installed.

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
    ssl: cfg.ssl ? {} : undefined,
    dateStrings: true,
    connectTimeout: 30_000,
  });
  try {
    // SET NAMES utf8 must run before any query that touches Thai text.
    // utf8mb4 isn't installed on every KKU MySQL server.
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

export function configFromEnv(prefix: string): MysqlConfig {
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
