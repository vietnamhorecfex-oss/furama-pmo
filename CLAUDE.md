# CLAUDE.md — Build Guide for Claude Code

You are implementing the **Furama PMO** system from the specs in this repo. This file is your operating manual. Read it fully before writing code.

> **⚠️ ARCHITECTURE MIGRATED (2026-07, Phases 0–6).** The system was refactored from a
> NestJS backend + Vite SPA into a **single full-stack Next.js 14 app** (`web/`). The `backend/`
> NestJS app has been **deleted**; all business logic now lives in `web/src/server/**` (plain
> module functions) exposed through App Router route handlers under `web/src/app/api/v1/**`.
> Docker and Redis were removed; the DB is native PostgreSQL. Package manager is **npm workspaces**
> (`shared`, `web`), not pnpm. Realtime is **TanStack Query polling**, not WebSockets. See
> `docs/CHANGELOG.md` (Phases 0–6) for the full deviation record. Sections 1–2 below describe the
> ORIGINAL stack and are kept for historical spec context — follow the migrated reality where they
> conflict. The RBAC matrix, data model, API contract (`api/openapi.yaml`), and security rules are
> unchanged and still authoritative.

## 0. Golden rules

1. **The specs are the contract.** `docs/` + `prisma/schema.prisma` + `api/openapi.yaml` define the system. If you must deviate, note it in `docs/CHANGELOG.md` with a reason.
2. **Security is not optional.** Every endpoint that touches data must pass an RBAC guard (see `docs/06-security.md`). Never ship an endpoint without an authz check and input validation.
3. **Tests gate merges.** No feature is "done" until it has tests and the suite is green (see Definition of Done).
4. **Real data exists.** Seed from `db/seed/tasks.seed.json` — don't invent placeholder tasks.
5. **Small, verifiable steps.** Follow `docs/08-build-roadmap.md` milestone by milestone. After each milestone, run the full test suite.

## 1. Tech stack (do not substitute without recording why)

```
backend/   NestJS 10, TypeScript 5, Prisma 5, PostgreSQL 16, Redis (sessions/rate-limit/pubsub)
web/       React 18, Vite, TypeScript, TanStack Query 5, Tailwind 3, Zustand, react-hook-form + zod
shared/    zod schemas + TS types shared by api & web (single source of DTO truth)
infra/     Docker Compose, GitHub Actions
```

Use **pnpm workspaces** monorepo: `backend/`, `web/`, `shared/`.

## 2. Standard commands

```bash
pnpm install
pnpm -F backend prisma migrate dev --name <change>
pnpm -F backend prisma generate
pnpm db:seed                      # scripts/seed.ts -> imports db/seed/tasks.seed.json
pnpm -F backend dev               # Nest watch, :3000
pnpm -F web dev                   # Vite, :5173
pnpm lint && pnpm typecheck
pnpm test                         # unit + integration (Jest/Vitest)
pnpm test:cov                     # coverage report
pnpm test:e2e                     # Playwright
```

## 3. Conventions

- **Layering (backend):** `controller → service → prisma`. Controllers do validation + authz only; business logic lives in services; DB access only in services/repositories.
- **DTOs/validation:** define zod schemas in `shared/`, derive TS types, validate at the controller boundary. Reject unknown fields.
- **Errors:** throw typed exceptions (`ForbiddenException`, `NotFoundException`, `BadRequestException`). Never leak stack traces or Prisma errors to clients.
- **IDs:** `cuid()` for all primary keys.
- **Money:** store VND as `BigInt` (integer minor unit not needed — VND has no decimals). Never use float for money.
- **Dates:** store as `timestamptz` (UTC). Project-local display handled in `web/`.
- **Naming:** REST resources plural kebab (`/api/v1/projects/:projectId/tasks`). DB tables snake_case. TS camelCase.
- **No secrets in code.** Read from env via a validated config module.
- **Audit everything that mutates.** Call `AuditService.record(...)` in mutating services.

## 4. Definition of Done (per feature)

- [ ] Endpoint(s) implemented matching `api/openapi.yaml`
- [ ] Input validated with zod; unknown fields rejected
- [ ] RBAC guard + resource-scope check applied and **unit-tested for the deny path**
- [ ] Audit log written for mutations
- [ ] Unit tests for service logic (happy + edge + deny)
- [ ] Integration test hitting the route against a Testcontainers Postgres
- [ ] Frontend wired with TanStack Query + optimistic update where specified
- [ ] No new `any`, no lint errors, typecheck clean
- [ ] Coverage for the module ≥ 80% lines / 75% branches

## 5. Build order

Follow `docs/08-build-roadmap.md`. Summary:
M0 scaffolding → M1 auth + RBAC core → M2 projects/members/config → M3 tasks CRUD + assignments → M4 progress/board/comments + realtime → M5 budget + gates + dashboard → M6 audit/activity + reports → M7 security hardening + E2E + CI.

## 6. What "good" looks like

- A `LEAD` of the Marketing workstream **can** edit a Marketing task but **gets 403** editing an Operations task — and there is a test proving the 403.
- Importing the seed loads exactly 628 tasks with correct phase/workstream/assignee mapping.
- Refresh-token rotation works; a stolen-then-reused refresh token is detected and the family is revoked.
- Changing a task to `COMPLETED` sets `percent=100`, writes an audit row, and broadcasts a WS event to project members only.

## 7. Where things live

| Need | Look in |
|---|---|
| Entities, enums, indexes | `prisma/schema.prisma`, `docs/02-data-model.md` |
| Who-can-do-what | `docs/03-functional-spec.md` §RBAC, `docs/06-security.md` |
| Exact request/response | `api/openapi.yaml`, `docs/04-api-spec.md` |
| How a flow should behave | `docs/05-workflows.md` |
| What to test | `docs/07-test-plan.md` |
