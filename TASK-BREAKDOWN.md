# TASK BREAKDOWN — Furama PMO

> Bảng điều phối để Claude Code triển khai **theo từng file**, rồi **gộp lại theo dự án**.
> Nguồn chân lý: `docs/*`, `prisma/schema.prisma`, `api/openapi.yaml`. Mỗi task = 1 file (hoặc cụm nhỏ) + Definition of Done trong `CLAUDE.md §4`.
>
> **Quy ước cột:** `ID` để tham chiếu · `Module` · `File` đường dẫn đích · `Phụ thuộc` các ID phải xong trước · `M` milestone.
> **Cách chạy 1 task với Claude Code:** mở session mới, dán prompt mẫu ở cuối file, thay `<ID>`.

---

## 0. Bản đồ module → dự án (mức cao)

```
furama-pmo/ (pnpm workspace)
├── shared/      ← SST của DTO/zod/types  (mọi module backend+web import)
├── backend/     ← NestJS modular monolith (controller → service → prisma)
│   └── src/{config,common,prisma,auth,rbac,users,projects,members,config-dim,
│            tasks,comments,budget,milestones,dashboard,audit,realtime,import-export,ai}
├── web/         ← React + Vite + TanStack Query + Zustand
│   └── src/{app,lib,routes,features/*,components}
├── prisma/      ← schema.prisma (đã có) + migrations
├── db/          ← schema.sql (đã có) + seed/tasks.seed.json (đã có) + scripts/seed.ts
├── api/         ← openapi.yaml (đã có)
└── infra/       ← docker-compose.yml (đã có) + .github/workflows/ci.yml
```

**Thứ tự gộp (integration order):** `shared` → `backend/common+prisma` → từng module backend → `web/lib` → từng feature web → `infra/CI`. Backend và web của cùng một module có thể chạy song song sau khi `shared` của module đó xong.

**Luật then chốt khi chia file:** mỗi NestJS module có 4 file chuẩn → tách thành 4 task độc lập:
`*.module.ts` (wiring) · `*.controller.ts` (validate + RBAC) · `*.service.ts` (business logic) · `*.spec.ts` (test). Service là task nặng nhất, controller mỏng.

---

## M0 — Scaffolding & nền tảng

| ID | Module | File | Phụ thuộc |
|----|--------|------|-----------|
| S-01 | workspace | `pnpm-workspace.yaml`, `package.json` (root scripts: dev/lint/typecheck/test/db:seed) | — |
| S-02 | shared | `shared/src/types/index.ts` (TS types từ data-model: enums, entity types) | — |
| S-03 | shared | `shared/src/schemas/common.ts` (zod: pagination, id, money/BigInt, date, error envelope) | S-02 |
| S-04 | backend/config | `backend/src/config/env.ts` (zod-validated config, fail-fast at boot) | S-01 |
| S-05 | backend/prisma | `backend/src/prisma/prisma.service.ts` + `prisma.module.ts` | S-04 |
| S-06 | backend/common | `backend/src/common/error.filter.ts` (error envelope, không leak Prisma/stack) | S-03 |
| S-07 | backend/common | `backend/src/common/logging.ts` (pino + requestId) · `helmet` · CORS allowlist · global ValidationPipe | S-04 |
| S-08 | backend/app | `backend/src/main.ts` + `app.module.ts` + `/health` `/ready` controller | S-05,S-06,S-07 |
| S-09 | infra | `infra/.github/workflows/ci.yml` (lint, typecheck, test, build) + xác nhận `docker-compose.yml` | S-08 |
| S-10 | web | `web/{vite.config.ts,index.html,src/main.tsx,src/app/App.tsx}` + Tailwind + 1 route trống | S-01 |

**Gate M0:** `docker compose up` + `pnpm dev` boot cả 2 app; `/health` trả 200; 1 test trivial xanh trong CI.

---

## M1 — Auth + RBAC core

| ID | Module | File | Phụ thuộc |
|----|--------|------|-----------|
| A-01 | shared | `shared/src/schemas/auth.ts` (register/login/refresh DTO zod) | S-03 |
| A-02 | backend/audit | `backend/src/audit/audit.service.ts` (`record()` INSERT-only) + module | S-05 |
| A-03 | backend/users | `backend/src/users/users.service.ts` (find/create, không trả passwordHash) | S-05 |
| A-04 | backend/auth | `backend/src/auth/tokens.service.ts` (JWT issue + refresh rotation + family revoke) | S-05 |
| A-05 | backend/auth | `backend/src/auth/auth.service.ts` (register/login/refresh/logout/getMe, Argon2id) | A-03,A-04,A-02 |
| A-06 | backend/auth | `backend/src/auth/auth.controller.ts` (5 endpoint + secure cookie + rate-limit) | A-05,A-01 |
| A-07 | backend/auth | `backend/src/auth/auth.module.ts` | A-05,A-06 |
| A-08 | backend/rbac | `backend/src/rbac/capability.enum.ts` (map từ RBAC matrix §2) | S-02 |
| A-09 | backend/rbac | `backend/src/rbac/rbac.service.ts` (`effectiveRole`, `assertCan`, `canEditTask`, `canUpdateProgress`, `isAssignee`, `leadOwnsWorkstream`) | A-08,S-05 |
| A-10 | backend/rbac | `backend/src/rbac/guards.ts` (`JwtAuthGuard`, `ProjectMemberGuard`, `@RequireCapability`) | A-09,A-04 |
| A-11 | backend/auth | `backend/src/auth/auth.spec.ts` (login, rotation, **token-reuse → family revoke**) | A-05 |
| A-12 | backend/rbac | `backend/src/rbac/rbac.spec.ts` (**deny-path cho từng role**) | A-09,A-10 |

**Gate M1:** auth unit+integration xanh; có deny-path test mỗi role; token-reuse test pass.

---

## M2 — Projects, members, config dimensions

| ID | Module | File | Phụ thuộc |
|----|--------|------|-----------|
| P-01 | shared | `shared/src/schemas/project.ts` + `member.ts` + `config-dim.ts` (DTO zod) | S-03 |
| P-02 | backend/projects | `backend/src/projects/projects.service.ts` (create+auto-OWNER, list theo membership, get, updateMeta, archive) | A-09,A-02 |
| P-03 | backend/projects | `backend/src/projects/projects.controller.ts` + `.module.ts` | P-02,A-10,P-01 |
| P-04 | backend/members | `backend/src/members/members.service.ts` (add/updateRole/setWorkstreamScope/remove, **last-OWNER guard**) | A-09,A-02 |
| P-05 | backend/members | `backend/src/members/members.controller.ts` + `.module.ts` | P-04,A-10,P-01 |
| P-06 | backend/config-dim | `backend/src/config-dim/config.service.ts` (phases/workstreams/statuses/priorities/budget-categories: CRUD+reorder+referential guard, cascade rename trong transaction) | A-09,A-02 |
| P-07 | backend/config-dim | `backend/src/config-dim/config.controller.ts` + `.module.ts` (5 nhóm route) | P-06,A-10,P-01 |
| P-08 | backend/projects | `projects.spec.ts` + `members.spec.ts` + `config.spec.ts` (non-PM bị chặn, last-OWNER, cascade-rename status) | P-02,P-04,P-06 |

**Gate M2:** OWNER/PM cấu hình được; non-PM bị chặn (test); cascade-rename status xanh.

---

## M3 — Tasks CRUD + assignments + seed import

| ID | Module | File | Phụ thuộc |
|----|--------|------|-----------|
| T-01 | shared | `shared/src/schemas/task.ts` (create/update/progress/assignment/dependency/list-query zod, invariants) | P-01 |
| T-02 | backend/tasks | `backend/src/tasks/task-invariants.ts` (status↔percent thuần hàm, test riêng) | T-01 |
| T-03 | backend/tasks | `backend/src/tasks/tasks.service.ts` (list filter/sort/paginate, get, create+generateCode, update, delete, setAssignments, setDependencies+cycle-check, myTasks) | T-02,A-09,A-02 |
| T-04 | backend/tasks | `backend/src/tasks/tasks.controller.ts` + `.module.ts` (route `/projects/:pid/tasks*` + `/tasks/:id*`) | T-03,A-10 |
| T-05 | backend/import-export | `backend/src/import-export/import-export.service.ts` (`importPackedSeed` upsert by `(projectId,code)`, tạo phase/workstream khi gặp lần đầu, map assignment; export JSON/CSV) | T-03 |
| T-06 | db | `db/scripts/seed.ts` (đọc `db/seed/tasks.seed.json` → gọi import) | T-05 |
| T-07 | backend/import-export | `import-export.controller.ts` + `.module.ts` (`/import`, `/export`, `/export/tasks.csv`) | T-05,A-10 |
| T-08 | backend/tasks | `tasks.spec.ts` + `import.spec.ts` (**import seed = đúng 628 task idempotent**, filter/paginate, LEAD-scope create/edit) | T-03,T-05 |

**Gate M3:** import `tasks.seed.json` tạo đúng 628 task, chạy lại không nhân đôi; filter/pagination test; LEAD-scope enforced.

---

## M4 — Progress, board, comments, realtime (backend + web bắt đầu)

| ID | Module | File | Phụ thuộc |
|----|--------|------|-----------|
| R-01 | backend/tasks | `tasks.service.ts::updateProgress` (áp invariants + audit + emit) — mở rộng T-03 | T-03,R-04 |
| R-02 | backend/comments | `backend/src/comments/comments.service.ts` (list, add — non-viewer, sanitize 1–4000) + controller + module | A-09,A-02 |
| R-03 | shared | `shared/src/schemas/ws-events.ts` (payload các event WS) | S-03 |
| R-04 | backend/realtime | `backend/src/realtime/realtime.gateway.ts` (auth bằng access token, join room theo membership, `emit`) + Redis pub/sub | A-04,A-09,R-03 |
| R-05 | backend/realtime | `realtime.spec.ts` (no cross-project leakage) | R-04 |
| W-01 | web/lib | `web/src/lib/{api-client.ts,query-client.ts,auth-store.ts}` (axios + token refresh + Zustand) | S-10,A-01 |
| W-02 | web/lib | `web/src/lib/ws.ts` (socket.io client, patch TanStack cache theo event) | W-01,R-03 |
| W-03 | web/features | `web/src/features/auth/{LoginPage.tsx,useAuth.ts}` | W-01 |
| W-04 | web/features | `web/src/features/tasks/TasksTable.tsx` (inline status/% , filter) | W-01,T-04 |
| W-05 | web/features | `web/src/features/tasks/KanbanBoard.tsx` (DnD, move semantics) | W-04,R-01 |
| W-06 | web/features | `web/src/features/tasks/TaskDrawer.tsx` (field role-gated + comments) | W-04,R-02 |

**Gate M4:** E2E member kéo task → COMPLETED + realtime cross-browser pass; progress audit + WS được assert.

---

## M5 — Budget, gates, dashboard

| ID | Module | File | Phụ thuộc |
|----|--------|------|-----------|
| B-01 | backend/budget | `backend/src/budget/budget.service.ts` (`summary`: cap/planned/committed/actual/byCategory/byWorkstream/overCap/overruns) + controller + module | T-03,P-06 |
| B-02 | backend/milestones | `backend/src/milestones/milestones.service.ts` (list/create/update/setStatus, gate readiness từ task) + controller + module | T-03,A-09 |
| B-03 | backend/dashboard | `backend/src/dashboard/dashboard.service.ts` (`overview`: KPIs, progress by phase/workstream, deadlines 14d, activity, countdown) + controller + module | T-03,B-01,A-02 |
| B-04 | backend | `budget.spec.ts` + `milestones.spec.ts` + `dashboard.spec.ts` (over-cap, gate role-gated, aggregate khớp seed) | B-01,B-02,B-03 |
| W-07 | web/features | `web/src/features/dashboard/DashboardPage.tsx` (KPI, progress bar, countdown, budget widget) | W-01,B-03 |
| W-08 | web/features | `web/src/features/budget/BudgetPanel.tsx` + `features/milestones/GatesPanel.tsx` | W-01,B-01,B-02 |

**Gate M5:** over-cap E2E flag; dashboard aggregate khớp seed; gate transition role-gated.

---

## M6 — Audit/activity + reports + config UI

| ID | Module | File | Phụ thuộc |
|----|--------|------|-----------|
| C-01 | backend/audit | `audit.service.ts::feed` + `entityHistory` + controller `/activity` (scope theo RBAC) | A-02,A-09 |
| C-02 | web/features | `web/src/features/activity/ActivityFeed.tsx` + per-entity history | W-01,C-01 |
| C-03 | web/features | `web/src/features/settings/{ProjectSettings.tsx,ConfigLists.tsx}` (meta + phases/workstreams/statuses/priorities/budget-cat) | W-01,P-07 |
| C-04 | web/features | `web/src/features/team/TeamPage.tsx` (member + role + workstream scope) | W-01,P-05 |
| C-05 | web/features | `web/src/features/io/ImportExportPanel.tsx` (import/export UI, CSV) | W-01,T-07 |

**Gate M6:** mọi thao tác config có trên UI và được audit; activity feed scope đúng RBAC.

---

## M7 — Security hardening, E2E, CI, docs

| ID | Module | File | Phụ thuộc |
|----|--------|------|-----------|
| H-01 | backend/security | rà soát headers/CORS/rate-limit theo `docs/06` + `pnpm audit` gate | toàn bộ backend |
| H-02 | backend/test | `backend/test/security/*.spec.ts` (IDOR sweep, secrets, threat-model controls — mỗi control 1 test) | H-01 |
| H-03 | web/e2e | `web/e2e/*.spec.ts` Playwright (journey cho cả 5 role) | toàn bộ web |
| H-04 | infra | CI enforce coverage threshold (≥80% line/75% branch) + E2E + security; deploy staging | S-09,H-02,H-03 |
| H-05 | docs | `docs/CHANGELOG.md` (ghi mọi deviation) + runbook backup/restore | — |

**Gate M7:** CI xanh gồm security + E2E + coverage; mỗi control threat-model có test; deploy staging thành công.

---

## (Tùy chọn) M8 — AI Assistant

| ID | Module | File | Phụ thuộc |
|----|--------|------|-----------|
| AI-01 | backend/ai | `backend/src/ai/tools.ts` (map `ai/tools.json` → service + RBAC, permission-bounded) | toàn bộ service |
| AI-02 | backend/ai | `backend/src/ai/assistant.service.ts` (dùng `ai/system-prompt.md`, anti-injection) | AI-01 |
| AI-03 | web/features | `web/src/features/ai/AssistantPanel.tsx` (conversational update) | AI-02 |

> Chi tiết trong `docs/09-ai-assistant.md` (chưa đọc kỹ — đọc trước khi làm M8).

---

## Tóm tắt khối lượng & cách phân công

- **~70 task-file**, nhóm theo 8 milestone. Mỗi task vừa 1 phiên Claude Code.
- **Đường găng (critical path):** S-04→S-05→A-09(RBAC)→T-03(TaskService)→B-03(Dashboard). Ưu tiên các ID này.
- **Song song được:** trong cùng milestone, các `*.service.ts` của module khác nhau độc lập sau khi `shared` + RBAC xong. Web feature chạy song song backend cùng module sau khi controller xong.
- **Không bao giờ** merge một service mà thiếu `*.spec.ts` deny-path tương ứng (DoD `CLAUDE.md §4`).

### Prompt mẫu giao 1 task cho Claude Code
```
Repo: Furama PMO (xem CLAUDE.md). Thực hiện đúng task <ID> trong TASK-BREAKDOWN.md.
Chỉ tạo/sửa file đích của task này và file test của nó.
Tuân thủ: layering controller→service→prisma, zod ở shared/, RBAC guard + deny-path test,
audit khi mutate, không dùng `any`. Sau khi xong chạy: pnpm lint && pnpm typecheck && pnpm test -F <module>.
Phụ thuộc <các ID> coi như đã merge.
```

### Quy trình gộp theo dự án
1. Làm theo milestone; trong milestone làm theo thứ tự `Phụ thuộc`.
2. Mỗi task → 1 nhánh `feat/<ID>-<slug>` → PR nhỏ → CI xanh → merge.
3. Cuối mỗi milestone chạy `pnpm lint typecheck test` toàn repo + check "Gate".
4. Không sang milestone mới khi milestone trước chưa xanh (luật `docs/08`).
