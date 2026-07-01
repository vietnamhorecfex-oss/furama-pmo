# 10 — Deployment (Vercel + Neon)

The app is a single full-stack **Next.js 14** project in `web/`, backed by **PostgreSQL**.
Recommended production stack: **Vercel** (hosting + serverless functions) + **Neon** (serverless
Postgres). This runbook assumes the Phase 0–7 refactor (no NestJS backend, no Docker/Redis).

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

## 1. Provision Neon

1. Create a Neon project + database (e.g. `furama`).
2. Copy **two** connection strings from the Neon dashboard:
   - **Pooled** (host contains `-pooler`) → runtime `DATABASE_URL`. Append
     `?sslmode=require&pgbouncer=true&connection_limit=1` (serverless-safe: PgBouncer + one connection
     per function invocation).
   - **Direct** (no `-pooler`) → `DIRECT_URL`, used only by `prisma migrate`. Append `?sslmode=require`.
3. The Prisma datasource already declares both (`url` = pooled, `directUrl` = direct).

## 2. Apply the schema + seed (once, from your machine)

With `DATABASE_URL`/`DIRECT_URL` pointed at Neon in your local `.env`:

```bash
npm install
npm run db:migrate         # prisma migrate deploy against DIRECT_URL
npm run db:seed            # tsx db/scripts/seed.ts → 628 tasks, idempotent
```

(For a brand-new DB use `prisma migrate deploy`; `db:migrate` = `migrate dev` is for iterating locally.)

## 3. Configure Vercel

1. Import the GitHub repo into Vercel.
2. Set **Environment Variables** (Production + Preview) — mirror `.env.example`:
   - `DATABASE_URL` (pooled Neon), `DIRECT_URL` (direct Neon)
   - `JWT_ACCESS_SECRET` (strong ≥32-char random), `JWT_ACCESS_TTL`, `REFRESH_TTL_DAYS`
   - `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`
   - `COOKIE_SECURE=true` (HTTPS), `WEB_ORIGIN=https://<your-domain>`
   - `RATE_LIMIT_*` (optional; defaults apply)
   - `ANTHROPIC_API_KEY` (optional — AI chat degrades gracefully if absent), `AI_MODEL_REASONING`
   - `NODE_ENV=production` (Vercel sets this automatically)
3. Deploy. Vercel runs `npm install` (→ prisma generate) then `next build`.

## 4. Serverless notes

- **Connection pooling is mandatory.** Each serverless invocation opens its own Prisma connection;
  without the Neon pooler + `connection_limit=1` you will exhaust Postgres connections under load.
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
