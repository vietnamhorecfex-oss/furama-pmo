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

## 2026-06-28 — M1 auth + RBAC

### Cycle: AuthModule ↔ RbacModule (resolved with forwardRef)
`AuthModule` exports `TokensService`; `RbacModule`'s `JwtAuthGuard` needs it. `AuthModule.AuthController` in turn uses `JwtAuthGuard` for `/auth/me`. Both modules use `forwardRef(() => ...)` to break the cycle. Not a workaround — it reflects the genuine bidirectional relationship between auth and rbac.

### Refresh token format
The raw refresh cookie value is `${tokenId}.${secret}`. The DB stores only `sha256(secret)`, so leaking the `RefreshToken` table does not expose usable tokens. Family-level revocation uses `familyId` (UUID); each successful login starts a new family.

## Gate M1 — verified DONE
`pnpm typecheck` clean · `pnpm test` 80 passed (3 health + 73 RBAC matrix + 4 tokens integration). Live smoke test: register→login→/me→refresh (rotation)→reuse OLD (401 + family revoke)→NEW refresh now dead (401)→bad login generic 401. DB: both refresh rows revoked after the reuse attempt; audit rows for `user.registered` + `user.login` present.

## Gate M0 — verified DONE
`docker compose up` (postgres+redis on 5433/6380) · `prisma migrate dev` created all 17 tables · `pnpm typecheck/test/build` green · `GET /health` → 200 · `GET /ready` → 200 (DB up).
