# 08 — Build Roadmap (for Claude Code)

Implement milestone by milestone. After each milestone: run `pnpm lint typecheck test`, commit, and check the milestone's "Done when" gate. Do not start a milestone before the previous one is green.

## M0 — Scaffolding
- pnpm monorepo: `backend/` (NestJS), `web/` (Vite React), `shared/` (zod+types).
- Docker Compose: postgres:16, redis:7. `.env` from `.env.example`, validated config module (zod) at boot.
- Prisma wired to `prisma/schema.prisma`; `migrate dev` creates DB; `prisma generate`.
- Base app: health/readiness endpoints, pino logging w/ request IDs, helmet, CORS allowlist, global validation pipe, error filter (error envelope).
- **Done when:** `docker compose up`, `pnpm dev` boots both apps; `/health` 200; one trivial test passes in CI.

## M1 — Auth + RBAC core
- AuthService (register/login/refresh/logout/me), Argon2id, JWT, refresh rotation + family revocation, secure cookie, login rate limit.
- RbacService + `JwtAuthGuard`, `ProjectMemberGuard`, `@RequireCapability`, resource-scope helpers; capability enum from RBAC matrix.
- Audit foundation (`AuditService.record`, append-only privileges note).
- **Done when:** auth unit + integration green; deny-path tests for each role exist; token-reuse test passes.

## M2 — Projects, members, config
- Project CRUD + meta + archive; auto-OWNER on create; membership-scoped listing.
- MemberService (add/updateRole/scope/remove; last-OWNER guard).
- ConfigService: phases, workstreams, statuses, priorities, budget categories (CRUD + reorder + referential guards).
- **Done when:** OWNER/PM can configure a project; non-PM blocked (tested); cascade-rename status test green.

## M3 — Tasks CRUD + assignments + import
- TaskService: list (filter/sort/paginate), get, create (auto code), update, delete, setAssignments, setDependencies (cycle check), generateCode, myTasks.
- ImportExportService: `importPackedSeed` + export JSON/CSV.
- **Done when:** importing `tasks.seed.json` creates 628 tasks idempotently; filters/pagination tested; LEAD-scope create/edit enforced.

## M4 — Progress, board, comments, realtime
- `updateProgress` with invariants; Kanban move semantics.
- CommentService (non-viewer); RealtimeGateway (auth join by membership; emit task/comment/budget/milestone events).
- Web: Tasks table (inline status/%), Kanban DnD, task drawer (role-gated fields), comments, live updates via WS + TanStack Query cache patching.
- **Done when:** E2E member-drag-to-completed + realtime cross-browser test passes; progress audit + WS asserted.

## M5 — Budget, gates, dashboard
- BudgetService.summary (rollups, over-cap, overruns).
- MilestoneService (gates w/ readiness from linked tasks; status transitions per state machine).
- DashboardService.overview; web dashboard (KPIs, progress bars, upcoming deadlines, countdown, budget widget).
- **Done when:** budget over-cap E2E flag; dashboard aggregates match seed; gate transitions role-gated.

## M6 — Audit/activity + reports + config UI
- Activity feed endpoint + UI; per-entity history.
- Settings UI (project meta + configurable lists), Team/members UI with role + workstream scope, import/export UI.
- CSV export; (optional) PDF weekly status.
- **Done when:** all config operations available in UI and audited; activity feed scoped per RBAC.

## M7 — Security hardening, E2E, CI, docs
- Full OWASP pass (`docs/06`): headers, CORS, rate limits, IDOR sweep, secrets check, `pnpm audit` gate.
- Complete Playwright journeys (all 5 roles), security test suite, coverage thresholds enforced in CI.
- Ops: backups/restore runbook, migration deploy step, observability hooks.
- **Done when:** CI green incl. security + E2E + coverage; threat-model controls each have a test; deploy to staging succeeds.

## Backlog / v1.1+
- Email notifications (overdue, mentions), password reset email, SSO/OAuth, attachments (object storage + scan), multi-language polish, saved filters/views, cross-project portfolio dashboard for the **restaurant cluster**, PDF/Excel report generation, mobile-optimized PWA.

## Suggested repo layout
```
furama-pmo/
  backend/  src/{auth,rbac,projects,members,config,tasks,comments,budget,milestones,dashboard,audit,realtime,common}
            test/{unit,integration,security}
  web/      src/{app,features,components,lib,routes}
  shared/   src/{schemas,types}
  prisma/   schema.prisma  migrations/
  db/       schema.sql  seed/tasks.seed.json  scripts/seed.ts
  api/      openapi.yaml
  docs/     01..08
  infra/    docker-compose.yml  .github/workflows/ci.yml
```
