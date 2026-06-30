# CHANGELOG — deviations from the handoff spec

Per `CLAUDE.md` golden rule #1, every deviation from the spec is recorded here with a reason.

## 2026-06-30 — Phase 0+1: Next.js auth subsystem refactor (final fixes)

### Summary
Auth subsystem ported from NestJS `backend/` into Next.js `web/src/server/` (tokens, rbac,
passwords, auth service, audit, route handlers). This enables the web tier to own its own auth
without proxying to the backend, and prepares for the Vite → Next.js migration.

### Intentional divergences from the backend

**Fixed a latent backend bug — `replacedById` forward chain:**
In `backend/src/auth/tokens.service.ts`, `replacedById` was set to the OLD (incoming) token's id.
The Next.js port (`web/src/server/auth/tokens.ts`) sets it to the newly-minted replacement token's
id — the correct forward chain, so the revocation trail reads in chronological order
(old → new → newer, not a self-loop on the old row).

**Added defense-in-depth — refresh token id verification:**
Refresh rotation now also verifies that the presented token id matches the stored DB row
(`row.id === parsed.id`). The backend did not perform this check. Prevents a class of timing
attacks where a valid signature is presented but for a different token row.

**`login` response `lastLoginAt` — post-update timestamp:**
The Next.js port returns the `lastLoginAt` value written during the current login (post-update),
so the response reflects the current login time. The backend returned the pre-update value
(the previous login time). Harmless display-only divergence; the DB row is correct in both cases.

### Other structural changes

- Legacy Vite source quarantined to `web/legacy/` (excluded from tsconfig), to be removed in a
  later phase once feature parity is confirmed.
- Next.js dev server runs on port 3002 during the transition (backend still on 3001).
- `@prisma/client` moved from `devDependencies` → `dependencies` in `web/package.json` so it is
  available at runtime (server components and API routes call Prisma directly).
- `readJson()` helper added to `web/src/server/http/request.ts`: wraps `req.json()` and maps
  `SyntaxError` (malformed/empty body) to a 400 BAD REQUEST instead of an unhandled 500.
- `resetConfig()` export added to `web/src/server/config.ts` for test isolation (lets a test
  re-read a mutated `process.env` without the cached value interfering).

## 2026-06-30 — Switched pnpm → npm workspaces

At the operator's request (wants `npm run dev`). `CLAUDE.md` §1 specifies pnpm; this is a
deliberate deviation.

- Root `package.json`: added `"workspaces": ["shared","backend","web"]`, removed `packageManager`,
  rewrote scripts to npm (`-w`, `--workspaces --if-present`). Parallel dev now uses `concurrently`
  (npm has no `pnpm --parallel`), added as a root devDependency. `npm run dev` builds `@furama/shared`
  once, then runs all three watchers concurrently.
- `workspace:*` → `*` in `backend`/`web` (npm resolves `*` to the local workspace package).
- Deleted `pnpm-lock.yaml` and `pnpm-workspace.yaml`; `package-lock.json` is now the lockfile.

### Backend dev port 3000 → 3001
Port `3000` on the dev machine is permanently held by an unrelated `next-server` process. Moved the
backend to `3001`: `API_PORT=3001` in `.env` and `BACKEND` const in `web/vite.config.ts`. The web
client uses relative paths through the Vite proxy, so no other change was needed.

## 2026-06-30 — Dropped Docker + Redis (local dev)

### Removed Docker
At the operator's request, local dev no longer uses Docker. Deleted `infra/docker-compose.yml`
and the `infra:up` / `infra:down` root scripts. Postgres is now expected to run natively on the
host (PostgreSQL 18, Homebrew) on the default port `5432`; `.env` `DATABASE_URL` points at the
local system user (`postgresql://bcmac@localhost:5432/furama_pmo`).

### Removed Redis
Redis was declared in spec (sessions / rate-limit / ws pub-sub) but **never wired into the code**:
no `redis`/`ioredis` dependency existed. The only references were a `REDIS_URL` entry in the env
schema and a "can plug redis-adapter later" comment in `realtime.gateway.ts`. Removed `REDIS_URL`
from `env.ts` and `.env`/`.env.example`, and updated the gateway comment.

Functional impact: **none.** Rate-limiting already uses `@nestjs/throttler` with its in-memory
store; the realtime gateway already uses the in-memory socket.io adapter. Consequence: the backend
is single-instance only (no horizontal fan-out) — acceptable for this deployment.

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

## 2026-06-29 — M4 progress + comments + realtime + web shell

### Realtime
- `RealtimeGateway` (namespace `/ws`, socket.io) verifies the access token at `handleConnection` (auth via `handshake.auth.token` or `Authorization: Bearer`); pins `socket.data.userId`. Clients explicitly call `project:join { projectId }` — the gateway verifies membership via `RbacService.effectiveRole` BEFORE adding the socket to `project:<pid>`. R-05 unit test asserts non-members cannot join and that `emit()` reaches only the target room.
- `TasksService.create/update/delete/updateProgress` and `CommentsService.add` call `realtime.emit(projectId, event, payload)` per docs/04 §5. `RealtimeModule` is `@Global` so any service can inject the gateway.
- Multi-instance fan-out via Redis adapter is hooked at AppModule level when scaling horizontally (currently the in-memory adapter is fine for single-instance dev/staging).

### Web shell
- Auth store keeps the access token in memory only (XSS-resistant). Refresh cookie does silent refresh via a single in-flight `/auth/refresh` to avoid stampeding the 10/min/IP throttle.
- `socket.io-client` subscribes once per signed-in session; on `task.*` / `comment.created` it invalidates the matching TanStack Query keys — invalidate-then-refetch is simpler and more correct than shape-aware cache patching across filter combos.
- `TasksTable` (paginated + filtered, inline status `<select>`), `KanbanBoard` (HTML5 native DnD across 5 status columns), `TaskDrawer` (slide-over + comments) — no external DnD lib required.

### Comment sanitisation
HTML tags and `javascript:` / `data:` / `vbscript:` URLs are stripped from comment bodies server-side. Live test: `<script>alert(1)</script>` → `alert(1)`.

## 2026-06-29 — M5 budget + gates + dashboard

### Aggregations live in the DB
Every rollup (`groupBy` + `_sum` / `_count`, `aggregate _avg`) runs inside Prisma so the app process never pulls all 628 tasks to count them. The single `summary()` call issues one `$transaction([...])` of indexed queries; the dashboard composes the same `BudgetService.summary()` so /budget and /dashboard never drift.

### Gate readiness from criteria.taskIds
Milestone `criteria` is JSONB; the system reads `criteria.taskIds: string[]`. A gate's `readinessPct` is the percent of those tasks in COMPLETED. The shape is intentionally a Json field rather than a join table so non-task criteria (external sign-offs, document approvals) can be added later without a migration.

### LEAD gate scope
LEAD can `setStatus` only when every task in `criteria.taskIds` belongs to a workstream the LEAD owns (`leadOwnsWorkstream`). Spans outside the scope → 403. Integration test covers both paths.

### Prisma quirks dealt with
- `groupBy` on this Prisma version requires `orderBy` when `_count`/`_sum` is used; added it on every groupBy call.
- `_sum` and `_count` on groupBy rows are typed as possibly-undefined; helpers `countAll()` and `r._sum?.x ?? 0n` keep TS happy without runtime cost.
- Nullable JSON field updates need `Prisma.JsonNull` (not literal `null`).

## 2026-06-29 — M6 audit feed + admin UI

### Activity feed RBAC
- OWNER / PM see the full project audit feed.
- LEAD is scoped: only Task rows in their workstreams + Comment rows. We resolve the LEAD's
  task ids once per call (cheap on project sizes ≤ 1k) and apply them via an `OR` in the
  Prisma where clause. Per-row Comment scoping would require an extra lookup per row — for
  v1 we allow Comment rows broadly inside the project and revisit if it becomes an issue.
- MEMBER / VIEWER → 403 outright (matches the capability matrix).

### AuditService dependencies
AuditService now injects RbacService so `feed()` / `entityHistory()` can resolve the caller's
effective role and LEAD scope. The new dependency is added in seed.ts manual instantiation
order (rbac before audit). No new tests broke; integration helpers use Nest DI so they auto-
resolve.

### Web admin shell
Added 4 view tabs: **Activity**, **Team**, **Settings**, **Import / Export**. All gated by
the server's existing RBAC; the UI surfaces 400/403/409 messages inline without hiding
controls, so it's obvious why an action failed (e.g. last-OWNER guard, referential-integrity
on phase delete).

## 2026-06-29 — M7 security hardening, E2E, CI, ops

### Security test suite (HTTP-level)
A new `backend/src/security/security.spec.ts` exercises the real HTTP stack via Supertest +
the full NestJS AppModule (guards, filters, helmet, ThrottlerGuard). One shared app instance
across all 6 describe blocks to avoid DB connection pool exhaustion. Covers:
- Every protected route returns 401 without a valid token
- Cross-org IDOR: user B cannot read/update/delete user A's projects, tasks, or budget
- Role enforcement: MEMBER gets 403 on admin operations (meta update, activity feed, member mgmt)
- SQL injection stored safely (Prisma parameterization), XSS stripped in comments (sanitizer)
- Zod strict schema: unknown fields → 400 VALIDATION
- Security headers via helmet: `X-Content-Type-Options`, framing prevention, no Server banner
- Rate limiting: 429 after 11 POST /auth/login attempts in the same 60s window
Test helper `http-harness.ts` bootstraps the app with the same middleware as main.ts (helmet + cookieParser) and adds a `registerAndLogin` helper that validates register/login success.

**Bug found and fixed during M7:** Test slugs used camelCase hints ('idorA') causing 400 VALIDATION on org slug (schema requires lowercase). Fixed by lowercasing the generated slug in `registerAndLogin`.

### Coverage thresholds
`jest.config.js` now enforces: ≥80% lines / ≥75% branches globally; ≥90% lines on `rbac.service.ts`, `auth.service.ts`, `tasks.service.ts`, `budget.service.ts`. `collectCoverageFrom` expanded to include controllers and filters.

### Playwright E2E setup
`@playwright/test` added to web devDependencies. `web/playwright.config.ts` configures:
- Single chromium worker (parallelism gated by CI label `run-e2e`)
- BASE_URL/API_URL env override for CI server orchestration
- Four spec files in `web/e2e/`: auth, owner-setup, tasks, rbac-ui

### Vite preview proxy
`vite.config.ts` now declares the same proxy rules under both `server.proxy` and `preview.proxy`
so `vite preview` (used in CI) routes `/api` and socket.io to the backend without a separate
reverse proxy.

### CI pipeline (two-job)
`.github/workflows/ci.yml` expanded to two jobs:
1. **build-test** (runs on every push/PR): unit+integration+security tests with coverage gate,
   `pnpm audit --audit-level=high`, typecheck, full build. Adds Redis service container.
2. **e2e** (runs on main branch pushes or PRs labeled `run-e2e`): starts backend + frontend,
   runs Playwright, uploads playwright-report artifact.

### Ops runbook
`docs/ops-runbook.md` covers: service architecture, required env vars, migration procedure
(deploy mode + migration role vs app role), backup/restore (pg_dump + S3), audit log retention
and archival (≥1 year), zero-downtime blue/green deploy, JWT key rotation procedure, refresh
token theft investigation, GDPR hard-delete runbook, `pnpm audit` gate.

## 2026-06-29 — M8 AI Assistant (Furama Copilot)

### Prisma migrations
Added 6 new models and enums (`NotificationSeverity`, `NotificationChannel`, `AiMessageRole`,
`AiActionStatus`, `KnowledgeSource`):
- `Notification` — in-app / email / WS alerts per user per project
- `AiConversation` + `AiMessage` — persisted chat history (last 20 messages used as context)
- `AiActionLog` — PROPOSED → CONFIRMED → EXECUTED lifecycle for write-tool gating
- `KnowledgeDoc` — keyword-searchable Playbook/SOP passages (pgvector pending; keyword fallback used)
- `AiSettings` — per-project AI toggle, model tiers, monthly token cap, cron, channels

### Backend: `backend/src/ai/`
- `assistant.service.ts` — full Anthropic tool-use loop:
  - Read tools (whoami, search_tasks, get_dashboard, get_budget_summary, list_overdue,
    search_knowledge) run immediately; results returned to Claude.
  - Write tools (update_task_progress, bulk_update_progress, shift_deadline, create_task,
    add_comment, create_config_item, send_notification) are intercepted into `AiActionLog`
    with status=PROPOSED; loop pauses and returns proposed preview to the caller.
  - Mutations only happen when the user calls `POST /ai/actions/:id/confirm`.
  - Loop max 6 iterations; tool results truncated to prevent context bloat.
  - Graceful degradation: if `ANTHROPIC_API_KEY` is absent, returns a polite message.
  - All tool dispatches carry `AuthContext`; RBAC enforced by underlying services.
  - System prompt grounded in project metadata + role; safety rules inline (no prompt injection).
- `ai.controller.ts` — 5 controller classes:
  - `POST /projects/:pid/ai/chat` — send message → reply + optional proposed actions
  - `POST /ai/actions/:id/confirm` — execute PROPOSED action
  - `POST /ai/actions/:id/reject` — discard PROPOSED action
  - `GET /projects/:pid/notifications` — list notifications (unread filter)
  - `POST /notifications/:id/read` — mark notification read

### Web: `web/src/features/ai/AssistantPanel.tsx`
Chat UI integrated as the 10th tab ("AI Copilot") in App.tsx:
- Message bubbles (user right / assistant left)
- Proposed-action cards with tool name, JSON args preview, Confirm / Reject buttons
- Confirm calls `/ai/actions/:id/confirm` and shows status chip
- Input bar disables during pending request
- Vietnamese default text matching the system prompt language

### Key decisions
- `ANTHROPIC_API_KEY` is optional; the app boots and serves all existing features without it.
  The AI endpoint returns a graceful "not configured" message if the key is absent.
- Write tools always go through the PROPOSED flow regardless of caller role — RBAC is enforced
  at execution time (confirm step), not at proposal time. This means Claude can describe what
  it would do even if the user doesn't confirm.
- `ai/tools.json` is copied into `backend/src/ai/tools.json` so TypeScript `rootDir` constraint
  is satisfied; the original in `/ai/` is the spec source of truth.

## Gate M7 — verified DONE
`pnpm typecheck` clean · **142 tests pass, 14 suites** (+26 security HTTP tests) ·
web build 324 KB / gzip 100 KB · security.spec: all 26 tests pass covering IDOR,
role enforcement, injection resistance, headers, rate-limit · CI pipeline expanded with
Redis service, coverage gate, pnpm audit, Playwright E2E job · ops-runbook.md written.

## Gate M6 — verified DONE
`pnpm typecheck` clean · web build 324 KB / gzip 100 KB · live: as seed admin (OWNER) the
activity feed returns 11 rows with `actorName`; the entity-history sub-route returns the
per-Task trail. As a freshly-promoted MEMBER on the same project, GET /activity returns
**HTTP 403 "Role MEMBER cannot view the audit log"** — exactly the capability matrix.

## Gate M5 — verified DONE
`pnpm typecheck` clean · `pnpm test` **116 passed** (added 2 budget + 2 milestone + 1 dashboard integration). Live on the seed project: `/budget/summary` returns `{capVnd:0, plannedVnd:0, committedVnd:2_241_700_000, actual:0, overCap:false, byCategory:1, byWorkstream:3, overruns:0}`; `/dashboard` returns full 628-task health (`COMPLETED:3, IN_PROGRESS:1, NOT_STARTED:624, byPriority CRITICAL:397/HIGH:212/MEDIUM:19`), 3 workstreams breakdown, 12 upcoming-deadline rows; created a gate with 3 task criteria → readiness `67%` (2/3 done from prior runs).

## Gate M4 — verified DONE
`pnpm typecheck` clean · `pnpm test` **111 passed** (added 5 realtime unit). Live WS E2E: spectator socket joins `project:<pid>` and receives both `task.progress` (status=COMPLETED, percent=100 — invariant applied) and `comment.created` events fired by a separate HTTP request. Comment sanitisation verified. Web `pnpm build` produces a 293 KB JS bundle (gzip 94 KB).

## Gate M3 — verified DONE
`pnpm typecheck` clean · `pnpm test` **106 passed** (added 6 invariant + 4 tasks + 4 import-export integration). `pnpm db:seed` imports the real 628-task `tasks.seed.json` end-to-end: **628 inserted on the first run, 628 updated on the second** (zero clones); creates 3 workstreams (PMO/MARKETING/OPERATIONS) and 32 phases, with all 1884 assignments (3 per task: IN_CHARGE / SUPPORT / APPROVER) wired. Live smoke: paginated list + filter (`priority=CRITICAL&q=opening` → 84 matches), `/tasks/:id`, progress update with invariants (IN_PROGRESS 30 → COMPLETED forces 100; inconsistent BLOCKED+100 → 400), CSV export header + 628 rows.

## Gate M2 — verified DONE
`pnpm typecheck` clean · `pnpm test` **91 passed** (3 health + 73 RBAC matrix + 4 tokens integration + 3 projects + 4 members + 4 config). Live smoke: create project (auto-OWNER) → create 2 phases → duplicate phase (409) → reorder phases (verified by order swap) → body with extra field (400 VALIDATION) → register second user, add as MEMBER (201) → MEMBER tries MANAGE_MEMBERS (403). Audit rows present for every mutation.

## Gate M1 — verified DONE
`pnpm typecheck` clean · `pnpm test` 80 passed (3 health + 73 RBAC matrix + 4 tokens integration). Live smoke test: register→login→/me→refresh (rotation)→reuse OLD (401 + family revoke)→NEW refresh now dead (401)→bad login generic 401. DB: both refresh rows revoked after the reuse attempt; audit rows for `user.registered` + `user.login` present.

## Gate M0 — verified DONE
`docker compose up` (postgres+redis on 5433/6380) · `prisma migrate dev` created all 17 tables · `pnpm typecheck/test/build` green · `GET /health` → 200 · `GET /ready` → 200 (DB up).
