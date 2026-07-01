# 10 — Deployment (Vercel + self-managed PostgreSQL)

The app is a single full-stack **Next.js 14** project in `web/`, backed by **PostgreSQL**.
Production stack: **Vercel** (hosting + serverless functions) + **your own PostgreSQL** (managed
service or self-hosted — not Neon). This runbook assumes the Phase 0–7 refactor (no NestJS backend,
no Docker/Redis).

> **Serverless + Postgres = you need a connection pooler.** Each Vercel function invocation opens its
> own DB connection; without pooling you will exhaust Postgres `max_connections` under load. Run
> **PgBouncer** (transaction mode) — or your host's built-in pooler — in front of Postgres, and point
> `DATABASE_URL` at the pooler. `DIRECT_URL` points at the real Postgres port for migrations.

## 0. Repository shape (what Vercel builds)

- npm workspaces monorepo: `shared/` (zod DTOs) + `web/` (the app). No `backend/`.
- Prisma schema lives at the repo **root** (`prisma/schema.prisma`); the client is generated into the
  hoisted `node_modules/@prisma/client` by the root `postinstall` (`prisma generate`).
- Root `vercel.json` configures the build:
  - `installCommand: npm install` → installs all workspaces, runs `postinstall` (prisma generate).
  - `buildCommand: npm run build -w @furama/web` → `next build`.
  - `outputDirectory: web/.next`.
  - `framework: nextjs`.
- If Vercel's UI asks for a **Root Directory**, leave it at the repository root (the config above builds
  the `web` workspace from root). Alternatively you may set Root Directory = `web` and instead use
  `buildCommand: prisma generate --schema ../prisma/schema.prisma && next build` — pick whichever your
  Vercel project accepts; the root-config form is the default here.

## 1. Provision PostgreSQL + a pooler

1. Create a PostgreSQL database (e.g. `furama`) on your managed service or server. Postgres 16.
2. Put **PgBouncer** in transaction mode in front of it (many managed hosts — Supabase, Railway,
   DigitalOcean, RDS+RDS Proxy, etc. — offer a built-in pooler; otherwise run PgBouncer yourself).
3. You now have **two** endpoints:
   - **Pooled** (PgBouncer, often port `6432`) → runtime `DATABASE_URL`. Append
     `?sslmode=require&pgbouncer=true&connection_limit=1`.
   - **Direct** (Postgres, port `5432`) → `DIRECT_URL`, used only by `prisma migrate` (migrations need a
     real connection; PgBouncer transaction mode breaks them). Append `?sslmode=require`.
4. The Prisma datasource already declares both (`url` = pooled, `directUrl` = direct). If you truly
   cannot run a pooler, point both at `5432` with `?connection_limit=1` and keep traffic low.

## 2. Apply the schema + seed (once, from your machine)

With `DATABASE_URL`/`DIRECT_URL` pointed at your production Postgres in your local `.env`:

```bash
npm install
npm run db:migrate         # prisma migrate deploy against DIRECT_URL
npm run db:seed            # tsx db/scripts/seed.ts → 628 tasks, idempotent
```

(For a brand-new DB use `prisma migrate deploy`; `db:migrate` = `migrate dev` is for iterating locally.)

## 3. Configure Vercel

1. Import the GitHub repo into Vercel.
2. Set **Environment Variables** (Production + Preview) — mirror `.env.example`:
   - Postgres (discrete vars): `POSTGRES_HOST`, `POSTGRES_PORT` (direct, 5432), `POSTGRES_USER`,
     `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_SCHEMA`, `POSTGRES_SSLMODE=require`
   - Pooler (runtime): `POSTGRES_POOL_HOST`, `POSTGRES_POOL_PORT` (PgBouncer, e.g. 6432). The app
     composes the pooled URL for queries and the direct URL for migrations automatically.
   - `JWT_ACCESS_SECRET` (strong ≥32-char random), `JWT_ACCESS_TTL`, `REFRESH_TTL_DAYS`
   - `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`
   - `COOKIE_SECURE=true` (HTTPS), `WEB_ORIGIN=https://<your-domain>`
   - `RATE_LIMIT_*` (optional; defaults apply)
   - `ANTHROPIC_API_KEY` (optional — AI chat degrades gracefully if absent), `AI_MODEL_REASONING`
   - `NODE_ENV=production` (Vercel sets this automatically)
3. Deploy. Vercel runs `npm install` (→ prisma generate) then `next build`.

## 4. Serverless notes

- **Connection pooling is mandatory.** Each serverless invocation opens its own Prisma connection;
  without PgBouncer + `connection_limit=1` you will exhaust Postgres `max_connections` under load.
- **Prisma client singleton** (`web/src/server/prisma.ts`) reuses one client per warm function instance.
- **Function duration:** the AI chat route sets `export const maxDuration = 60` (Vercel Hobby cap). If
  you deploy on Hobby, that is the ceiling; Pro allows up to 300 s if you raise it.
- **No cron/WebSocket dependency:** realtime is client polling (`refetchInterval`), which works on
  serverless with no extra infra.

## 5. Post-deploy smoke

- `GET /api/health` → `{status:"ok"}`; `GET /api/ready` → `{status:"ready"}` (checks DB).
- Log in with the seeded admin (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).
- Open a project → dashboard, tasks, board, budget, gates, activity all load; reload stays authed.

## 6. Known performance debt (safe, deferred)

These are correctness-complete but not yet optimized (documented in `CHANGELOG.md`):

- **Dashboard** issues several aggregate queries; budget summary runs in parallel via `Promise.all`.
  Fine for the seeded project size; revisit with materialized counters if projects grow large.
- **Packed-seed import** processes rows in a sequential loop (idempotent upserts). Runs at seed time,
  not per-request — acceptable.
- **Milestone `generateFromPhases`** hydrates criteria with N×2 lookups. Low cardinality; acceptable.
