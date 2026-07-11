# CHANGELOG — deviations from the handoff spec

Per `CLAUDE.md` golden rule #1, every deviation from the spec is recorded here with a reason.

## 2026-07-11 — Security & correctness bug-fix pass (severe + medium)

A full-project review surfaced a cluster of security/correctness bugs; all severe and medium
findings fixed. `npm run typecheck` clean · `npm test` **193 passed (28 files)**.

**Auth / tenant isolation**
- **Account-lockout via cross-org registration.** `email` is unique only per-org but `loginUser`
  looks up by email alone (`findMany !== 1`), so registering a victim's email under a new org
  slug made it un-loginable forever. `registerUser` now enforces **global** email uniqueness
  (`web/src/server/auth/service.ts`). Residual (open self-registration into an existing org) is a
  product decision — see "Open" below.
- **Rate limiting** added to `/auth/login|register|refresh` (was configured but never enforced).
  New `web/src/server/http/rate-limit.ts` (in-memory sliding window; login/register = AUTH limit,
  refresh = the looser WRITE limit since it needs a valid cookie and offices share IPs).
- **`GET /api/v1/users` RBAC.** Was authN-only → any VIEWER could harvest the org name/email
  directory. Now requires OWNER/PM in ≥1 project.
- **Refresh-family revocation now audited** (`auth.refresh.reuse_detected`, `auth.logout`). The
  benign concurrent-refresh race no longer revokes the whole family (it dropped users from every
  tab); it now rejects only the losing request and rolls back its orphan mint.

**AI Copilot**
- **conversationId IDOR** — `chat()` now verifies the conversation belongs to the caller AND
  project before reading/appending (was cross-user chat-history disclosure + poisoning).
- **Tool args validated with the real zod DTOs** (were cast). Fixes: `create_task` always crashed
  (`BigInt(undefined)` on actualVnd); `update_task_progress` could store `percent=150`;
  `send_notification` could target any user (now must be a project member). `confirmAction` is now
  atomic (conditional `updateMany`) so a double-click can't execute the write twice. Context now
  loads the newest 20 messages (was oldest); `search_tasks assignee:"me"` now resolves.

**Tasks**
- **Cross-project FK guard** — `createTask`/`updateTask` reject a phase/workstream/budget-category
  from another project (was silent budget-rollup corruption / raw 500). Moving a task to a new
  workstream is re-checked against the target so a LEAD can't push tasks out of their scope.
- **Kanban / status-dropdown transitions** — added a `kanbanMove` flag so dragging a card to
  "Not started" or reopening a done card actually sticks (the status/percent invariant used to
  bounce it back with a silent 200).

**Import/export**
- Import no longer zeroes the project budget cap when a file has no budget column; status/percent
  reconciled through the shared invariants; `createdById` no longer overwritten on re-import; the
  import route sets `maxDuration`. CSV export escapes formula-injection (`= + - @`). Project/CSV
  exports now write an audit row and project their member select.

**Frontend**
- **Logout/login now clears the TanStack Query cache** — the next user on a shared browser no
  longer sees the previous user's cached projects/tasks/budget/notifications.
- i18n language read moved to a post-mount effect (was a guaranteed hydration mismatch for EN).
- Calendar "today" and month bucketing use local dates (were UTC — wrong day / dropped tasks).
- "Overdue" is now date-only across client + dashboard + digest + AI (a task due today is not
  overdue until the next day; was flagged late from ~07:00 VN on the due date).
- Settings config tabs remount per dimension (form values no longer bleed across tabs). The
  Activity tab is gated by a new `VIEW_AUDIT` UI cap; the task-drawer History hides on 403 instead
  of showing a misleading "no history".

**Open (needs a product decision, not fixed):** public self-registration can still create an
account in an *existing* org (and thus an OWNER-of-its-own-project). Recommend making registration
invite-only or first-user-only. Also unaddressed by design: `eslint` is not installed so
`npm run lint` cannot run; and the per-row import is not wrapped in a single transaction (a
mid-import failure still leaves a partial state — mitigated by `maxDuration`, not eliminated).

## 2026-07-02 — Gemini fix: disable thinking so answers aren't truncated

Live testing with a real `GEMINI_API_KEY` showed `/ai/reminders` returning markdown cut off
mid-sentence: Gemini 2.5 counts *thinking* tokens against `maxOutputTokens`, while our callers
size `max_tokens` (512–1024) for visible text only (Anthropic semantics). Fix in
`web/src/server/ai/gemini.ts`: `generationConfig.thinkingConfig.thinkingBudget` defaults to `0`
(thinking off); `GEMINI_THINKING_BUDGET` overrides it (number = budget, non-number such as
`auto` = keep the model default). Documented in `.env.example`; 3 new adapter tests.

Same session, two adjacent findings from live browser testing:

- **`list_overdue` paging bug.** The chat tool fetched page 1 of `listTasks` (50 rows by
  `createdAt`) and filtered overdue in memory — in the 628-task seed project it reported 2
  overdue instead of 20. Now queries the DB directly (`deadline < now`, not COMPLETED,
  optional workstream) and returns `{ total, tasks }` (top 50 by priority/deadline, with PIC)
  so the model can state the true count. Integration test reproduces the >50-tasks case.
- **Reminder digest sizing.** `max_tokens` 1024 → 2048 and the reminder prompt now asks for
  ~8 highlights per group with repeated items rolled up, so the answer fits the budget
  instead of enumerating all 60 attention items and truncating.

## 2026-07-02 — AI digest (reminders + recap) + Gemini provider option

Additions beyond the original spec (M8 AI assistant), requested by the owner:

- **AI digest.** `web/src/server/ai/digest.ts` — `taskReminders` (overdue / due-≤3-days /
  blocked buckets) and `projectSummary` (executive recap over `dashboardOverview`). Read-only,
  `VIEW_PROJECT`-gated, exposed at `GET /projects/:pid/ai/reminders|summary`, rendered by
  `DigestPanel` above the chat on the AI tab. Both degrade to a deterministic Vietnamese
  markdown fallback when no AI key is configured (`generatedByAI: false`), so the feature
  works without any LLM. 5 tests (buckets, exclusions, LLM path via injected client, RBAC deny).
- **Gemini as an alternative LLM provider.** `web/src/server/ai/gemini.ts` implements the
  existing `AnthropicLike` seam over Gemini REST `generateContent` (system→systemInstruction,
  `tool_use`⇄`functionCall`, `tool_result`→`functionResponse`, function schemas sanitized to
  Gemini's OpenAPI subset — Gemini rejects empty-object schemas, so no-arg tools omit
  `parameters`). Provider selection in `getAiClient()`: `GEMINI_API_KEY` (model from
  `GEMINI_MODEL`, default `gemini-2.5-flash`) → `ANTHROPIC_API_KEY` → null (rule-based
  fallback). The assistant tool-use loop is unchanged. `create_config_item.extra` in
  `tools.json` now declares its kind-specific properties explicitly (required for Gemini,
  clearer for Claude too). Adapter is fetch-injectable; 7 offline unit tests.
- **Seed content translated to Vietnamese** (same day, committed separately): human-readable
  columns of `db/seed/tasks.seed.json` (title/description/deliverable/kpi/category/risk/
  audience/phase → milestones). Codes, dates, acronyms, brands, and role labels kept verbatim;
  original English seed preserved at `db/seed/tasks.seed.en.json`; one-off
  `db/scripts/reseed-vi.ts` wipes and re-imports a project then regenerates milestones.

## 2026-07-01 — Phase 7: deploy config (Vercel + self-managed PostgreSQL) + hardening

Target chosen: **Vercel serverless + self-managed PostgreSQL** (not Neon). A connection pooler
(PgBouncer, transaction mode) in front of Postgres is required for serverless.

- **Serverless DB.** Prisma datasource gained `directUrl = env("DIRECT_URL")` — runtime uses the
  POOLED connection (→ PgBouncer), migrations use the DIRECT Postgres endpoint.
  `web/src/server/prisma.ts` uses a singleton client (safe for warm serverless instances).
- **Discrete DB env vars (no monolithic DATABASE_URL).** The DB is configured with individual
  `POSTGRES_HOST/PORT/USER/PASSWORD/DB/SCHEMA/SSLMODE` (+ optional `POSTGRES_POOL_HOST/PORT` for the
  serverless pooler). `web/src/server/db-url.ts` composes the pooled URL for the runtime client
  (passed via `PrismaClient({ datasources: { db: { url } } })`); `scripts/db-env.mjs` composes
  `DATABASE_URL`/`DIRECT_URL` just-in-time for the Prisma CLI (`postinstall`, `db:generate`,
  `db:migrate*`, `db:seed` all route through it; `--direct` sets `PRISMA_DIRECT=1` so seeding &
  migrations bypass the pooler). Back-compat: if `POSTGRES_HOST` is unset but `DATABASE_URL`/
  `DIRECT_URL` exist, those are used verbatim. Verified: `db:generate`, 170 tests, `next build`, and
  `db:seed` (628 tasks) all green through the composed path.
- **Build wiring.** Root `postinstall: prisma generate` guarantees the client exists after any
  `npm install` (local + Vercel). Root `vercel.json` added: `installCommand npm install`,
  `buildCommand npm run build -w @furama/web`, `outputDirectory web/.next`, `framework nextjs`.
- **`.env.example` rewritten** for Next.js + self-managed Postgres (added `DIRECT_URL`,
  `ANTHROPIC_API_KEY`, `AI_MODEL_REASONING`, prod cookie/JWT + PgBouncer notes; removed Vite-era
  `API_PORT`/`WEB_ORIGIN:5173`).
- **Deploy runbook** added at `docs/10-deployment.md` (Postgres + PgBouncer provisioning, migrate+seed,
  Vercel env, serverless notes, smoke checklist).
- **M7 tenant-isolation fix.** `listProjects` now filters `orgId: ctx.orgId` in addition to membership
  (defense-in-depth: a stray cross-org membership row can no longer leak another tenant's project).
  Added a regression test proving a cross-org membership does not surface the other org's project.
- **Perf debt (accepted, documented).** Dashboard multi-query (budget parallelized via `Promise.all`),
  sequential packed-seed import, and milestone N×2 hydrate are correctness-complete and run off the
  hot path; left as-is with notes in `docs/10-deployment.md §6`. No behavior change.

## 2026-07-01 — Phase 6: parity, backend removal, seed rewrite

Verified full endpoint parity, then deleted the NestJS `backend/` app entirely. The Next.js server
layer is now the sole implementation.

### Parity gap found + closed
- **Activity/audit READ endpoints were never ported** (`GET /projects/:pid/activity`,
  `GET /projects/:pid/activity/history/:entityType/:entityId`). The migrated UI (ActivityFeed,
  task-history in the drawer) already called them, so they were 404ing. Ported `feed` + `entityHistory`
  (+ LEAD-scope helper, DTO mapper) to `web/src/server/audit/activity.ts` and added the two routes,
  with the exact RBAC preserved (OWNER/PM full; LEAD scoped to own-workstream Task/Comment rows;
  MEMBER/VIEWER denied). 10 new tests. A full backend↔web endpoint diff then showed 100% parity
  (74 backend endpoints, all covered; the only diffs were cosmetic param names, e.g. comments
  `:taskId`↔`:id`, and health/ready which exist under `/api/*`).

### Backend deletion + fallout
- **`backend/` deleted.** Removed from the npm `workspaces`; the root `dev` script no longer starts a
  backend process (`concurrently` now runs shared-watch + web only).
- **`@anthropic-ai/sdk` moved to `web` deps.** It was a `backend` dependency that `web/src/server/ai`
  relied on via hoisting; deleting backend removed it and broke the web build. Now declared in
  `web/package.json` (`^0.106.0`). (Latent coupling exposed by the deletion — fixed.)
- **Seed script rewritten.** `db/scripts/seed.ts` imported four NestJS services from `backend/src`.
  Rewritten to use the web server layer (`prisma`, `dbHealthy`, `importPackedSeed`) run via `tsx`.
  Root `db:seed` is now `tsx db/scripts/seed.ts` (was `-w @furama/backend`); `tsx` + `dotenv` added to
  root devDeps. Verified: still loads exactly **628 tasks**, idempotently (Golden Rule #4).
- **`api/openapi.yaml` unchanged** — the route handlers still mirror it 1:1; it remains the API contract.
- **CLAUDE.md** got a migration banner atop; sections 1–2 (original NestJS/pnpm stack) kept for spec
  history but flagged as superseded.

## 2026-07-01 — Phase 5: App Router UI (route tree + feature migration + polling)

Migrated the legacy Vite tab-workspace (`web/legacy/`) into the Next.js App Router. The single-page
`App.tsx` with a `useState<View>` tab switcher became a real route tree:
`/projects` (list) → `/projects/[projectId]/layout.tsx` (workspace shell) → 11 sibling sub-routes
(`dashboard, tasks, board, calendar, budget, gates, activity, team, settings, io, ai`). All 11 feature
components + their hooks moved nearly verbatim (`git mv` + `'use client'` + import fixes); markup,
Tailwind, i18n keys, query keys and API paths unchanged. `web/legacy/` deleted.

### Deviations from the legacy UI / spec
- **Navigation model: tabs → routes.** Tab state (`useState<View>` + `renderView`) replaced by App
  Router `<Link>` navigation and `usePathname` active-state. The 11 views are now addressable URLs
  (was the original "route đầy đủ" requirement).
- **Task drawer: local state → `?task=` search param.** The drawer opened via `openTaskId` state and an
  `onOpen` callback; it now opens via a `?task=<id>` search param read by `TaskDrawerHost` in the
  project layout. `onOpen(id)` pushes the param; `onClose` does `router.push(pathname)` to drop it.
  More faithful to "route đầy đủ" and makes a focused task shareable/deep-linkable.
- **WebSocket DROPPED, replaced by polling.** `lib/ws.ts` (socket.io client + cache-invalidation
  patcher) removed; `socket.io-client` is no longer a dependency. The query keys WS used to invalidate
  (`['tasks',…]`, `['task',…]`, `['comments',…]`) plus dashboard + budget-summary now carry
  `refetchInterval: POLL_MS` (`POLL_MS = 20_000`, in `query-client.ts`). The notification bell keeps
  its existing 30s poll. Realtime is now near-real-time (≤20s) — acceptable per the Phase-0 decision
  ("Polling qua TanStack Query").
- **Canonical api-client = axios.** The current fetch-based `api<T>()` was replaced by the legacy
  axios client (`src/lib/api-client.ts`: request-interceptor bearer attach, single-inflight
  `refreshAccessTokenOnce`, one-retry-on-401). `axios` added to `web` deps. This let all ~13 feature
  hooks migrate unchanged (they call `api.get/post/patch(url,{params}).data`).
- **Session-on-reload fixed.** In-memory zustand loses `accessToken`/`user` on hard reload. The project
  layout + project-list page now call `bootstrapSession()` (in `api-client.ts`) when `user` is null.
  It **explicitly** `POST /auth/refresh` first (cookie-based, no bearer) to mint a fresh access token,
  then `GET /auth/me` with that token and `setSession(token, data.user)` (the endpoint returns
  `{user, memberships}`). The explicit refresh is required because the response interceptor deliberately
  skips its silent-refresh-on-401 for `/auth/*` URLs (loop guard), so a bare `GET /auth/me` on a cold
  load would 401 and bounce the user to `/login`. On failure → redirect `/login`. Fixes the known
  "reload mất session" gap flagged in the Phase-0 projects-page stub. (Caught by the Phase-5 wiring
  review before merge.)
- **`useWorkstreams` moved in Task 5.3 (plan scheduled 5.5).** `TasksTable` imports it; moving it with
  the task views (rather than with the team views) was required to keep the build green.

## 2026-07-01 — Phase 4: AI assistant engine port

Ported `backend/src/ai/` (assistant tool-use engine, chat/action routes, notifications, knowledge
search) to the Next.js server layer. Blocking request model (no streaming) per decision; chat route
carries `export const maxDuration = 60` (Vercel Hobby-safe). Constructor DI replaced by an env-based
Anthropic client seam (`getAnthropicClient()`) plus a `deps.client` injection point so tests never
hit the network. `AssistantService` split into `web/src/server/ai/assistant.ts` (engine + knowledge)
and `web/src/server/ai/notifications.ts`. `auditRecord` calls gain `ip: null` (the ported
`AuditActor` interface added `ip` in Phase 1). All 5 endpoints, all 13 tools (6 read + 7 write),
and the PROPOSED→EXECUTED/REJECTED action state machine reproduced faithfully; system-prompt
safety block copied verbatim. 15 new tests (assistant 9, notifications 6); full suite 159/159.

### Deviations from the design spec / backend
- **AI assistant port (Phase 4):** `create_config_item`/workstream track default changed from `'EXE'`
  (backend bug — not a valid `WorkstreamTrack` enum value, would throw at Prisma runtime) to
  `'OPERATIONS'`.

### Known inherited limitations (faithful ports of backend bugs — deferred to Phase 6/7)
- **`create_task` AI tool bypasses zod defaults.** The `create_task` write dispatch builds the DTO
  by hand and casts past `createTaskSchema.parse()` (1:1 with backend `assistant.service.ts:503`).
  When the model omits `budgetVnd`/`actualVnd`, `createTask` runs `BigInt(undefined)` → throws. This
  is safely contained: the throw happens inside `confirmAction`'s try/catch, so the action is marked
  `FAILED` and surfaced — no partial write or corruption. Fix (parse through `createTaskSchema` in
  the dispatch, which would also fix the backend) deferred to Phase 6/7.
- **`bulk_update_progress` swallows per-task errors** with a bare `catch` → "skipped" (faithful to
  backend); the skip reason is not surfaced to the model. Observability improvement deferred.

## 2026-07-01 — Phase 3: analytics & IO port (budget, dashboard, milestones, import-export)

Ported the computation/IO modules into Next.js (`web/src/server/**` + route handlers), same
vertical-slice pattern as Phase 2. All money serialized via `moneyToNumber`; WS emits stay dropped.

### Deviations from the design spec / backend
- **AI + notifications deferred to Phase 4.** The design spec listed the AI assistant under Phase 3;
  it was split out into its own phase because it is the largest module, depends on budget/dashboard/
  tasks/comments/config being ported first, and carries its own streaming/`maxDuration` decisions.
- **Import column strictness relaxed (import-export).** The backend `indexer` throws
  `BadRequestException` for ANY referenced seed column that is absent (all ~24 columns effectively
  required). The Next port instead requires only a task-code column (`id` **or** `code`) and tolerates
  other missing columns via `safeGet` fallbacks — this supports simplified/hand-built partial seeds
  (the web import UI does not always send all 24 columns). Consequence: a malformed partial payload
  that the backend would 400 now imports with defaulted fields and returns 200. The real 24-column
  `db/seed/tasks.seed.json` is unaffected. A missing code column still returns 400.
- **Import track column:** the port reads the workstream track from the `project` column first, with a
  `workstream` fallback (the real seed uses `project` for the track key; the fallback supports the
  simplified seed). This fixes a bug where a real seed would have dumped all tasks into the PMO track.
- **Dashboard budget concurrency:** the port runs the main aggregation `$transaction` and
  `budgetSummary` via `Promise.all` (the backend ran them sequentially) — a latency improvement, same
  result.

### Performance carry-notes (Phase 7 hardening — functionally correct today)
- `dashboardOverview` issues ~18 DB queries/request; `importPackedSeed` uses a sequential row loop
  (~N× per-row queries); `listMilestones` hydrate is N×2 queries. All carry inline `// PERF` comments.
  Batch these + set Vercel `maxDuration` when deploying.

### rbac.ts
- `leadOwnsWorkstream` was made `export` (visibility only, no logic change) so the milestone gate
  helper can reuse it.

## 2026-07-01 — Phase 2: Next.js vertical-slice port (services + route handlers + integration tests)

### Execution strategy — vertical slices instead of design-spec's P2/P3 split
The handoff spec described P2 as "all services" and P3 as "all route handlers". Phase 2 was instead
executed as **vertical slices**: each module ships a service + route handler(s) + integration tests
together, satisfying the CLAUDE.md DoD in one pass. Reason: the DoD requires a tested endpoint per
feature; splitting service and routes across phases would leave untested code between milestones.

### Modules ported (all in `web/src/`)
- **projects** — list, create, get, update, archive (`server/projects/`, `app/api/v1/projects/`)
- **config** — phases, workstreams, statuses, priorities, budget-categories (CRUD + reorder +
  delete-with-replacement) (`server/config/`, `app/api/v1/projects/[projectId]/{phases,workstreams,statuses,priorities,budget-categories}/`)
- **members** — list, invite, update role, remove (`server/members/`, `app/api/v1/projects/[projectId]/members/`)
- **tasks** — list, create, get, update, delete, progress, assignments, dependencies, mine
  (incl. invariant enforcement + dependency-cycle detection)
  (`server/tasks/`, `app/api/v1/{projects/[projectId]/tasks,tasks/[id]/}`)
- **comments** — list, create, delete (`server/comments/`, `app/api/v1/tasks/[id]/comments/`)

### WebSocket `realtime.emit` calls DROPPED in ported services
The Next.js service ports do not call a `realtime.emit` equivalent. The backend's
`RealtimeGateway` is NestJS/socket.io-specific and not available in the Next.js runtime.
**Realtime becomes client polling in Phase 5.** Emit sites are commented in the corresponding
backend service source (`backend/src/tasks/tasks.service.ts`, etc.) so the integration point
is traceable when WS is wired.

### Money (VND BigInt) serialization
`Response.json()` cannot serialize `BigInt`. A `moneyToNumber` helper converts VND `BigInt`
fields to `Number` at every DTO boundary before JSON serialization; callers write back
money fields with `BigInt(value)`. `BigInt` remains the DB representation.

### Known deferred item — `listProjects` org-scoping
`listProjects` filters on membership (user is a member of the project) only — no explicit `orgId`
filter. This is a faithful port of the backend's `findMany({ where: { members: { some: { userId } } } })`.
Cross-tenant isolation is enforced by the membership join at the DB level. A dedicated cross-tenant
test will be added in M7 hardening to pin this guarantee explicitly.

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
