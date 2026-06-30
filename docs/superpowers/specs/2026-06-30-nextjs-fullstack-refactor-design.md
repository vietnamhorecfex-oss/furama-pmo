# Design — Refactor Furama PMO → Full-stack Next.js

- **Date:** 2026-06-30
- **Status:** Approved (design); pending implementation plan
- **Scope owner:** operator (vietnamhorecfex@gmail.com)

## 1. Goal

Replace the current split architecture (Vite React SPA + standalone NestJS API) with a
single **full-stack Next.js (App Router)** application that has a **complete URL route tree**
(the current frontend is tab-based with no routing/deep-linking). Target deployment: Vercel.

## 2. Current state (baseline)

- `web/` — React 18 + **Vite** SPA. **No router**: views are switched with `useState` in
  `web/src/app/App.tsx` (tabs: dashboard, table, board, calendar, budget, gates, activity, team,
  settings, io, ai). Project chosen via dropdown. Task opens as a drawer overlay. Realtime via
  `web/src/lib/ws.ts` (socket.io-client). Data via TanStack Query + axios.
- `backend/` — NestJS API (now on port **3001**). JWT access + refresh-token rotation with
  reuse-detection/family-revoke, argon2 hashing, httpOnly cookies, RBAC capability guards, Prisma
  + PostgreSQL, socket.io realtime gateway, `@nestjs/throttler` rate-limiting. Modules: ai, audit,
  auth, budget, comments, config-dim, dashboard, health, import-export, members, milestones,
  projects, rbac, realtime, tasks, users.
- `shared/` — zod schemas + derived TS types; single source of DTO truth (`@furama/shared`).
- `prisma/` — schema + migrations at repo root. Postgres runs natively in dev. Redis removed.
- Package manager: **npm workspaces** (`shared`, `backend`, `web`).

## 3. Decisions (locked)

| Area | Decision |
|---|---|
| Scope | Full-stack Next.js (App Router); **drop NestJS entirely** |
| Realtime | Remove socket.io → **polling** via TanStack Query (refetch interval + refetchOnWindowFocus) |
| Auth | **Port as-is**: JWT access + refresh rotation + family-revoke + argon2, httpOnly cookies |
| API & data | **REST route handlers** under `/api/v1/**` mirroring `api/openapi.yaml` + **keep TanStack Query** on the client |
| `shared` | Keep as a workspace package (least churn; preserves DTO-truth principle) |
| Task detail | Intercepting route — drawer/modal on in-app navigation, full page on direct load / refresh |

## 4. Target monorepo structure

```
shared/                 # unchanged workspace — zod schemas + types
web/                    # Next.js full-stack app (replaces BOTH Vite SPA and NestJS)
  src/
    app/                # App Router — both pages and /api route handlers
    server/             # logic ported from backend/src (services → pure functions)
      prisma.ts         # Prisma singleton (global cache for serverless)
      auth/ rbac/ tasks/ budget/ dashboard/ members/ config/ milestones/
      comments/ audit/ import-export/ ai/
    features/           # FE components ported from web/src/features
    lib/                # api-client, auth-store, i18n, query-client
    middleware.ts       # auth cookie check + protected-route redirect
backend/                # DELETED after parity is reached
prisma/                 # unchanged — schema + migrations
```

`@furama/shared` imports in ported code stay unchanged. Vercel: project root = `web`, monorepo
workspace install.

## 5. Full route tree (App Router)

### Pages (UI)
```
/login                                       public
/                                            → redirect /projects
/projects                                    project list + selector
/projects/[projectId]                        → redirect /dashboard
/projects/[projectId]/dashboard
/projects/[projectId]/tasks                  list/table view
/projects/[projectId]/tasks/[taskId]         task detail (intercepting route → modal in-app, page on direct load)
/projects/[projectId]/board                  Kanban
/projects/[projectId]/calendar
/projects/[projectId]/budget
/projects/[projectId]/milestones             (gates)
/projects/[projectId]/activity
/projects/[projectId]/team
/projects/[projectId]/settings               requires MANAGE_CONFIG
/projects/[projectId]/import-export          requires IMPORT_EXPORT
/projects/[projectId]/ai
```

`projects/[projectId]/layout.tsx`: header + project switcher + tab nav (real links, active state
from URL) + NotificationBell. RBAC hides tabs by capability; a forbidden tab redirects to dashboard.

### API route handlers (`/api/v1`, mirror `api/openapi.yaml`)
```
auth/login   auth/refresh   auth/logout   auth/me
projects (GET, POST)                          projects/[pid] (GET, PATCH)
projects/[pid]/tasks (GET, POST)              tasks/[id] (GET, PATCH, DELETE)
tasks/[id]/progress (PATCH)                   tasks/[id]/assignments
tasks/[id]/dependencies                       tasks/[id]/comments
projects/[pid]/budget/summary (GET)           projects/[pid]/budget (PATCH)
projects/[pid]/dashboard                      projects/[pid]/milestones
projects/[pid]/members                        projects/[pid]/config (workstreams/phases/categories)
projects/[pid]/activity                       projects/[pid]/import   projects/[pid]/export
ai/*    notifications    health    ready
```

## 6. Backend → Next.js porting rules

- **Controller → route handler**: zod-validate (from `shared`) at the top, reject unknown fields,
  RBAC check, call server lib, return JSON. Errors mapped to the existing `ApiError` shape
  (port `error.filter` logic into a shared handler wrapper).
- **Service → pure server function** in `web/src/server/<module>/`. Logic ported near-verbatim,
  Nest decorators removed; dependencies passed explicitly.
- **Guards/RBAC** → `requireCapability(req, projectId, capability)` helper used in each handler,
  plus `middleware.ts` for the auth-cookie gate and protected-route redirects.
- **Prisma** → singleton with `globalThis` cache to avoid exhausting connections on serverless.
- **Audit** → `auditRecord(...)` called in every mutation (preserves CLAUDE.md "audit everything").
- **WebSocket gateway** → deleted; clients poll via TanStack Query.

## 7. Risks / constraints

1. **Rate-limiting**: `@nestjs/throttler` is in-memory and does not work correctly on serverless
   (per-lambda memory). Redis was already removed. Interim: rely on Vercel WAF/firewall; optionally
   add `@upstash/ratelimit` later. **Flagged, non-blocking.**
2. **Production database**: Vercel serverless needs managed Postgres with connection pooling
   (recommend **Neon**, native Vercel integration; Prisma uses the pooled URL / `pgbouncer=true`).
   Local dev keeps native Postgres.
3. **Long tasks (AI, import/export)** may hit Vercel function time limits → may need higher
   `maxDuration` or to be split.
4. **No instant realtime**: polling introduces a few seconds of latency (accepted).

## 8. Execution strategy (feature branch, each phase tested)

```
P0  Scaffold Next.js + Prisma singleton + wire shared + Tailwind
P1  Auth: port tokens/rbac, route handlers, middleware; deny-path tests
P2  Port server lib per module (tasks, budget, dashboard, members, config, milestones, comments, audit, import-export, ai)
P3  API route handlers mirroring openapi + per-route integration tests (Testcontainers Postgres)
P4  Pages + App Router tree + migrate features to TanStack Query
P5  Polling realtime + notifications
P6  Full parity check vs current app + delete backend/ + update docs/CHANGELOG.md
P7  Vercel config + managed Postgres + preview deploy
```

## 9. Testing

Keep the CLAUDE.md Definition of Done: zod validation, RBAC deny-path unit tests, audit on
mutations, ≥80% line / 75% branch per module. Unit tests for ported server lib (Vitest/Jest);
integration tests hitting route handlers against a Testcontainers Postgres; Playwright e2e against
the Next dev server.

## 10. Out of scope

- Instant realtime / WebSocket (replaced by polling).
- Redis-backed sessions/rate-limit (removed).
- Distributed rate-limiting (deferred to Upstash if needed).
- Any new product feature — this is a structural refactor at functional parity.
