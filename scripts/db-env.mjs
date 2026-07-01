#!/usr/bin/env node
/**
 * Compose DATABASE_URL + DIRECT_URL from individual POSTGRES_* env vars, then run a command
 * (prisma / tsx / …) with those set. Lets the whole project be configured with discrete DB
 * variables instead of a monolithic DATABASE_URL — the Prisma CLI still reads the URL from the
 * schema's env(), so we materialize it here just-in-time.
 *
 *   node scripts/db-env.mjs [--direct] <command> [args...]
 *
 * --direct : also export PRISMA_DIRECT=1 (bypass the pooler; used for seeding & migrations).
 *
 * NOTE: this is a plain-JS copy of web/src/server/db-url.ts — keep the two in sync.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Load .env for local dev. On hosted platforms (Vercel) the vars are already in process.env,
// and dotenv may not be installed in a production install — so this is best-effort.
try {
  const { config: loadEnv } = await import('dotenv');
  loadEnv({ path: resolve(process.cwd(), '.env') });
} catch {
  /* no dotenv / no .env — rely on the ambient environment */
}

function buildUrl(host, port, extra) {
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

function buildDirectUrl() {
  if (!process.env.POSTGRES_HOST && process.env.DIRECT_URL) return process.env.DIRECT_URL;
  if (!process.env.POSTGRES_HOST && process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const port = process.env.POSTGRES_PORT ?? '5432';
  return buildUrl(host, port);
}

function buildPooledUrl() {
  if (!process.env.POSTGRES_HOST && process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const poolHost = process.env.POSTGRES_POOL_HOST;
  if (!poolHost) return buildDirectUrl();
  const poolPort = process.env.POSTGRES_POOL_PORT ?? '6432';
  return buildUrl(poolHost, poolPort, { pgbouncer: 'true', connection_limit: '1' });
}

const argv = process.argv.slice(2);
const direct = argv[0] === '--direct';
const cmd = direct ? argv.slice(1) : argv;
if (cmd.length === 0) {
  console.error('usage: node scripts/db-env.mjs [--direct] <command> [args...]');
  process.exit(2);
}

const directUrl = buildDirectUrl();
const env = {
  ...process.env,
  DIRECT_URL: directUrl,
  DATABASE_URL: direct ? directUrl : buildPooledUrl(),
  ...(direct ? { PRISMA_DIRECT: '1' } : {}),
};

const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env, shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
