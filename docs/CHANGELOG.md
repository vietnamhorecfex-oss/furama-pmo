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

## 2026-06-29 — M2 projects + members + config

### AuthModule promoted to @Global
After RbacModule (also global) started providing `JwtAuthGuard` to feature modules, those modules couldn't resolve `TokensService` (declared in `AuthModule`) when Nest instantiated the guard in their context. Marking `AuthModule` `@Global` makes `TokensService` reachable everywhere a guard is used, without each module needing to import `AuthModule` explicitly. The original `forwardRef` between Auth and Rbac stays.

### Cascade rename for StatusDef / PriorityDef
The current Prisma schema keeps `Task.status` and `Task.priority` as fixed enums (decision recorded in `docs/02-data-model.md §3`). So a "rename" of a StatusDef/PriorityDef changes the def row but does NOT migrate Task rows — the cascade UPDATE path is in place inside a transaction, commented out, ready to enable if v1.x relaxes Task to a free-text key.

### Audit JSON typing
Prisma's `InputJsonValue` rejects `Record<string, unknown>`. Use `as Prisma.InputJsonValue` at the audit-payload boundary; the underlying value is a known object literal.

## 2026-06-29 — M3 tasks + seed import

### Seed script avoids Nest DI
tsx/esbuild does not emit decorator metadata reliably for `reflect-metadata`. That made `Test.createTestingModule({ providers: [...] })` resolve constructor args as `undefined` inside the seed script. The script now instantiates `PrismaService`, `AuditService`, `RbacService`, and `ImportExportService` manually with `new`. Honest and simple for a one-shot script; the runtime app still uses Nest DI normally.

### Task.dependencies (not Task.dependsOn)
The Prisma model names the side from this-task-depends-on rows `dependencies` (relation name `TaskDeps`). Use `include: { dependencies: ... }` when joining, not `dependsOn`.

### Invariant order: Kanban reset before IN_PROGRESS promotion
First implementation had `0<percent<100 + NOT_STARTED → IN_PROGRESS` fire before the Kanban reset, so dragging a 40%-in-progress card back to the NOT_STARTED column promoted it right back to IN_PROGRESS. Caught by the invariant unit test. Fixed: when `kanbanMove=true` and `next.status=NOT_STARTED` and the caller did not also send a `percent`, reset percent to 0 first, then evaluate the other rules.

## Gate M3 — verified DONE
`pnpm typecheck` clean · `pnpm test` **106 passed** (added 6 invariant + 4 tasks + 4 import-export integration). `pnpm db:seed` imports the real 628-task `tasks.seed.json` end-to-end: **628 inserted on the first run, 628 updated on the second** (zero clones); creates 3 workstreams (PMO/MARKETING/OPERATIONS) and 32 phases, with all 1884 assignments (3 per task: IN_CHARGE / SUPPORT / APPROVER) wired. Live smoke: paginated list + filter (`priority=CRITICAL&q=opening` → 84 matches), `/tasks/:id`, progress update with invariants (IN_PROGRESS 30 → COMPLETED forces 100; inconsistent BLOCKED+100 → 400), CSV export header + 628 rows.

## Gate M2 — verified DONE
`pnpm typecheck` clean · `pnpm test` **91 passed** (3 health + 73 RBAC matrix + 4 tokens integration + 3 projects + 4 members + 4 config). Live smoke: create project (auto-OWNER) → create 2 phases → duplicate phase (409) → reorder phases (verified by order swap) → body with extra field (400 VALIDATION) → register second user, add as MEMBER (201) → MEMBER tries MANAGE_MEMBERS (403). Audit rows present for every mutation.

## Gate M1 — verified DONE
`pnpm typecheck` clean · `pnpm test` 80 passed (3 health + 73 RBAC matrix + 4 tokens integration). Live smoke test: register→login→/me→refresh (rotation)→reuse OLD (401 + family revoke)→NEW refresh now dead (401)→bad login generic 401. DB: both refresh rows revoked after the reuse attempt; audit rows for `user.registered` + `user.login` present.

## Gate M0 — verified DONE
`docker compose up` (postgres+redis on 5433/6380) · `prisma migrate dev` created all 17 tables · `pnpm typecheck/test/build` green · `GET /health` → 200 · `GET /ready` → 200 (DB up).
