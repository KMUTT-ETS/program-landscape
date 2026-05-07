// ────────────────────────────────────────────────────────────────────────────
// Postgres client helper — used by source DBs that ship as Postgres
// (not the project's own warehouse, which is owned by Prisma).
//
// Used by:
//   - kku-publications connector (full Scopus collection of KKU works,
//     internal mirror at 10.130.2.151)
//
// Lifecycle pattern mirrors the Oracle / MSSQL / MySQL helpers:
//   - Single Client per query batch via withConnection().
//   - No long-lived pool — these queries run quarterly, single-threaded.
//   - SSL is opt-in via *_SSL=true; on-network internal mirrors typically
//     don't have TLS configured.
// ────────────────────────────────────────────────────────────────────────────

import pg, { type Client, type QueryResultRow } from 'pg';

const { Client: PgClient } = pg;

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  // Some on-prem mirrors use self-signed certs. When ssl=true and this
  // is also true, we skip cert verification. Default false (strict).
  sslRejectUnauthorized: boolean;
}

export async function withConnection<T>(
  cfg: PostgresConfig,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new PgClient({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl
      ? { rejectUnauthorized: cfg.sslRejectUnauthorized }
      : false,
    // Same envelope as the mssql helper — Q1 cross-table joins on a
    // 200k+ paper table need headroom. Postgres 9.5 with sparse
    // analytical indexes makes some aggregates slow; honour the
    // *_QUERY_TIMEOUT_MS env override when set (default 240s).
    statement_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS ?? 240_000),
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS ?? 240_000),
    connectionTimeoutMillis: 30_000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch {
      // Close errors aren't actionable here.
    }
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  client: Client,
  sql: string,
  binds: unknown[] = [],
): Promise<T[]> {
  const result = await client.query<T>(sql, binds);
  return result.rows;
}

export function configFromEnv(prefix: string): PostgresConfig {
  const required = ['HOST', 'PORT', 'DATABASE', 'USER', 'PASSWORD'];
  const missing = required.filter((k) => !process.env[`${prefix}_${k}`]);
  if (missing.length > 0) {
    throw new Error(
      `Postgres config missing env vars: ${missing
        .map((k) => `${prefix}_${k}`)
        .join(', ')}. Set them in .env or export to the shell before running.`,
    );
  }
  return {
    host: process.env[`${prefix}_HOST`]!,
    port: Number(process.env[`${prefix}_PORT`]),
    database: process.env[`${prefix}_DATABASE`]!,
    user: process.env[`${prefix}_USER`]!,
    password: process.env[`${prefix}_PASSWORD`]!,
    ssl: parseBool(process.env[`${prefix}_SSL`], false),
    sslRejectUnauthorized: parseBool(
      process.env[`${prefix}_SSL_REJECT_UNAUTHORIZED`],
      false,
    ),
  };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return /^(true|1|yes|on)$/i.test(value);
}
