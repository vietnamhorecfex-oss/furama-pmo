# CHANGELOG — deviations from the handoff spec

Per `CLAUDE.md` golden rule #1, every deviation from the spec is recorded here with a reason.

## 2026-06-28 — M0 scaffolding

### Fixed: `prisma/schema.prisma` did not parse
The handoff schema used syntax Prisma rejects. Two fixes, no semantic change:
1. **Block comments → line comments.** Section dividers used `/* ... */`, which Prisma does not support. Converted all to `// ...`.
2. **Inline enums → multi-line.** Enums were written as `enum X { A B C }` on one line; Prisma requires each value on its own line. Reformatted all 8 enums. Values unchanged.

Result: `prisma validate` passes, `prisma generate` succeeds.

> The original copies under the Google Drive spec folder still contain these issues; only the working repo is fixed.

### Monorepo: Prisma deps hoisted to root
`@prisma/client` + `prisma` are declared in the **root** `package.json` (as well as `backend/`) so that `prisma generate` can resolve the client from the schema location (`prisma/` at repo root) in a pnpm workspace. Without this, generate triggers a failing auto-install. `db:generate` runs from root.

### Infra ports remapped (5433 / 6380)
The dev machine already runs a native Postgres on host `5432` and a native Redis on `6379`. To avoid clashing with them, the compose services publish on host ports **5433** (postgres) and **6380** (redis); `.env` `DATABASE_URL`/`REDIS_URL` updated to match. Container-internal ports are unchanged. CI (GitHub Actions service container) still uses 5432 since it runs in a clean environment.

### Env auto-load in dev
`ConfigModule` uses `envFilePath: ['../.env', '.env']` so `pnpm dev` (run from `backend/`) loads the repo-root `.env` without manual sourcing.

### Toolchain
Local machine had no Node/pnpm/Docker. Installed `node` + `pnpm` via Homebrew, and **Colima + docker CLI + docker-compose** (headless Docker, no Docker Desktop GUI). Start the daemon with `colima start` before `docker compose up`.

## Gate M0 — verified DONE
`docker compose up` (postgres+redis on 5433/6380) · `prisma migrate dev` created all 17 tables · `pnpm typecheck/test/build` green · `GET /health` → 200 · `GET /ready` → 200 (DB up).
