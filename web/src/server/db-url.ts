/**
 * Compose PostgreSQL connection URLs from individual `POSTGRES_*` env vars, so the DB can be
 * configured with discrete variables instead of one monolithic DATABASE_URL.
 *
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
 *   POSTGRES_SCHEMA   (default 'public')
 *   POSTGRES_SSLMODE  (e.g. 'require' in prod; unset locally)
 *   POSTGRES_POOL_HOST, POSTGRES_POOL_PORT   (optional pooler / PgBouncer for serverless runtime)
 *
 * Two URLs are produced:
 *   - POOLED  (runtime): via the pooler if POSTGRES_POOL_HOST is set, else the direct endpoint.
 *   - DIRECT  (migrations): always the real Postgres endpoint.
 *
 * Back-compat: if POSTGRES_HOST is not set but DATABASE_URL / DIRECT_URL are, those are used
 * verbatim — so an existing single-URL setup keeps working during migration.
 *
 * NOTE: `scripts/db-env.mjs` contains a plain-JS copy of this logic for the Prisma CLI (which
 * reads the URL from the schema's env(), not this module). Keep the two in sync.
 */

function buildUrl(host: string, port: string, extra?: Record<string, string>): string {
  const user = process.env.POSTGRES_USER ?? 'postgres';
  const pass = process.env.POSTGRES_PASSWORD ?? '';
  const db = process.env.POSTGRES_DB ?? 'furama_pmo';
  const schema = process.env.POSTGRES_SCHEMA ?? 'public';
  const ssl = process.env.POSTGRES_SSLMODE;
  const auth = pass
    ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}`
    : encodeURIComponent(user);
  const params = new URLSearchParams({ schema });
  if (ssl) params.set('sslmode', ssl);
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
  return `postgresql://${auth}@${host}:${port}/${encodeURIComponent(db)}?${params.toString()}`;
}

/** Direct (non-pooled) Postgres URL — used by migrations and by seeding. */
export function buildDirectUrl(): string {
  if (!process.env.POSTGRES_HOST && process.env.DIRECT_URL) return process.env.DIRECT_URL;
  if (!process.env.POSTGRES_HOST && process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const port = process.env.POSTGRES_PORT ?? '5432';
  return buildUrl(host, port);
}

/** Pooled URL for the serverless runtime (falls back to direct when no pooler is configured). */
export function buildPooledUrl(): string {
  // Seeding / migrations set PRISMA_DIRECT=1 to bypass the pooler (PgBouncer breaks $transaction).
  if (process.env.PRISMA_DIRECT === '1') return buildDirectUrl();
  if (!process.env.POSTGRES_HOST && process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const poolHost = process.env.POSTGRES_POOL_HOST;
  if (!poolHost) return buildDirectUrl();
  const poolPort = process.env.POSTGRES_POOL_PORT ?? '6432';
  return buildUrl(poolHost, poolPort, { pgbouncer: 'true', connection_limit: '1' });
}
