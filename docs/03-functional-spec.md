# 03 — Functional Specification

## 1. Roles

| Role | Who | Scope |
|---|---|---|
| **OWNER** | Owner / GM | Full control incl. members & config & delete |
| **PM** | PMO Lead | Full control incl. members & config & delete |
| **LEAD** | Workstream HOD | Manage tasks within assigned workstream(s) only |
| **MEMBER** | Team member | Update progress on tasks they are assigned to |
| **VIEWER** | Stakeholder | Read-only |

Roles are **per project** (a user can be LEAD on one project, VIEWER on another).

## 2. RBAC matrix (authoritative)

`✓` allowed · `scope` allowed only within own scope · `—` denied

| Capability | OWNER | PM | LEAD | MEMBER | VIEWER |
|---|---|---|---|---|---|
| View project, tasks, dashboards | ✓ | ✓ | ✓ | ✓ | ✓ |
| Comment on task | ✓ | ✓ | ✓ | ✓ | — |
| Update task status/percent/notes | ✓ | ✓ | scope¹ | scope² | — |
| Create task | ✓ | ✓ | scope¹ | — | — |
| Edit all task fields | ✓ | ✓ | scope¹ | — | — |
| Delete task | ✓ | ✓ | — | — | — |
| Manage budget categories | ✓ | ✓ | — | — | — |
| Manage milestones/gates | ✓ | ✓ | scope¹ (update status only) | — | — |
| Manage project config (phases, workstreams, statuses, priorities, meta) | ✓ | ✓ | — | — | — |
| Manage members & roles | ✓ | ✓ | — | — | — |
| Import / export project data | ✓ | ✓ | — | — | — |
| Archive / delete project | ✓ | — | — | — | — |
| View audit log | ✓ | ✓ | scope¹ | — | — |

¹ **scope (LEAD):** task/milestone belongs to one of the LEAD's assigned workstreams (`MemberWorkstream`).
² **scope (MEMBER):** the member is an assignee of the task (`TaskAssignment.userId == caller` OR `TaskAssignment.label == member.memberLabel`).

> The matrix maps 1:1 to policy functions in `docs/06-security.md §RBAC`. Every cell that is `—` or `scope` must have a deny-path test.

## 3. Feature modules, user stories & acceptance criteria

### M-AUTH — Authentication & session
- *As a user I can sign in with email + password and stay signed in.*
  - AC: valid creds → 200 + access token (15m) + refresh cookie (httpOnly, Secure, SameSite=Strict, 7d). Invalid → 401, generic message, no user enumeration.
  - AC: access token expiry → silent refresh via rotation; reused/rotated refresh token → whole family revoked, 401.
  - AC: logout revokes the refresh family and clears the cookie.
- *Password reset by email token* (optional v1.1): single-use, 30-min token, rate-limited.

### M-PROJECT — Projects & cluster
- *As an Owner/PM I can create a restaurant project with dates and budget cap.* AC: required name; opening within [start,end]; cap ≥ 0.
- *As any member I see only projects I belong to.* AC: list filtered by `ProjectMember`.
- *Cluster:* an org can hold many projects; switching projects re-scopes all data and the user's effective role.

### M-MEMBER — Membership & roles
- *Owner/PM add a user to a project with a role; for LEAD, pick workstream scope; for MEMBER, set memberLabel.* AC: unique per (project,user); cannot demote the last OWNER.

### M-CONFIG — Configurable dimensions
- *Owner/PM add/edit/reorder phases, workstreams, statuses, priorities, budget categories, and edit project meta (dates, cap).* AC: renaming a status/priority cascades to tasks within a transaction; cannot delete a status/priority still referenced unless a replacement is provided; cannot delete a phase/workstream with tasks unless reassigned.

### M-TASK — Tasks
- *Create/edit a task with phase, workstream, category, schedule (start/deadline → duration), priority, status, %, budget, KPI, deliverable, dependencies, risk, audience, notes, assignments (in-charge/support/approver).*
  - AC: `code` unique per project (auto-generate `<TRACKPREFIX>-N###` if absent).
  - AC: status/percent invariants enforced server-side (see §4 functions).
  - AC: deadline before start → 400. Dependency cycle → 400.
- *Filter/sort/search tasks* by project, phase, workstream, status, priority, assignee, free text.
- *My tasks* view: tasks where caller is an assignee.

### M-PROGRESS — Progress & board
- *Inline update status/percent from list and drag across Kanban columns.* AC: authz per RBAC; status→percent invariants; emits WS event + audit row.

### M-COMMENT — Discussion
- *Add comments to a task; all non-viewers can comment.* AC: body 1–4000 chars, sanitized; emits WS event.

### M-BUDGET — Budget control
- *See planned (categories) vs committed (sum task.budget) vs actual (sum task.actual) vs cap; flag over-cap and >10% category overrun.* AC: rollups computed by indexed aggregation; over-cap surfaced on dashboard.

### M-GATE — Milestones & Go/No-Go gates
- *Track milestones and gates with criteria + status (PENDING/PASSED/FAILED/NA).* AC: a gate's readiness can reference linked tasks' completion; Owner/PM set PASSED/FAILED; LEAD may update gates in scope.

### M-DASH — Dashboard & reports
- *Overall % complete, counts (done/in-progress/blocked/overdue/at-risk), progress by project/phase/workstream, upcoming deadlines (14d), recent activity, budget summary, opening countdown.*
- *Export*: project JSON; CSV of tasks; (v1.1) PDF weekly status.

### M-AUDIT — Activity & audit
- *Immutable log of every mutation; activity feed on dashboard; per-entity history.* AC: append-only; visible per RBAC.

### M-RT — Real-time
- *Changes broadcast to project members in a room.* AC: WS auth via access token; server authorizes room join by membership; no cross-project leakage.

## 4. Function catalog (service-layer)

Backend service methods Claude Code must implement. Each returns typed DTOs and writes audit on mutation.

### AuthService
- `register(orgId, dto)` → creates user (Argon2id hash).
- `login(email, password, ip)` → `{ accessToken, refreshToken }`; updates `lastLoginAt`.
- `rotateRefresh(refreshToken, ip)` → new pair; revokes old; detects reuse → revoke family.
- `logout(refreshToken)` → revoke family.
- `getMe(userId)` → profile + memberships.

### RbacService / Policy
- `effectiveRole(userId, projectId)` → MemberRole | null.
- `assertCan(ctx, capability, resource?)` → throws `ForbiddenException` if denied. (capability enum mirrors §2.)
- `canEditTask(ctx, task)`, `canUpdateProgress(ctx, task)`, `isAssignee(ctx, task)`, `leadOwnsWorkstream(ctx, workstreamId)`.

### ProjectService
- `create(ctx, dto)`, `list(ctx)`, `get(ctx, id)`, `updateMeta(ctx, id, dto)`, `archive(ctx, id)`.

### MemberService
- `add(ctx, projectId, dto)`, `updateRole(ctx, memberId, dto)`, `setWorkstreamScope(ctx, memberId, ids)`, `remove(ctx, memberId)`.
- Guard: cannot remove/demote the last OWNER.

### ConfigService
- `phases.*`, `workstreams.*`, `statuses.*`, `priorities.*`, `budgetCategories.*` — list/create/update/reorder/delete with referential guards (see M-CONFIG ACs).

### TaskService
- `list(ctx, projectId, query)` → filtered/sorted/paginated.
- `get(ctx, id)`, `create(ctx, projectId, dto)`, `update(ctx, id, dto)`, `delete(ctx, id)`.
- `updateProgress(ctx, id, { status?, percent?, notes? })` — applies invariants:
  - `status=COMPLETED ⇒ percent=100`; `percent=100 ⇒ status=COMPLETED`;
  - `0<percent<100 & status=NOT_STARTED ⇒ status=IN_PROGRESS`;
  - `status=NOT_STARTED ⇒ percent=0` on Kanban move to NOT_STARTED.
- `setAssignments(ctx, id, assignments[])`, `setDependencies(ctx, id, ids[])` (reject cycles).
- `myTasks(ctx, projectId)`.
- `generateCode(projectId, track)` → next `<PREFIX>-N###`.

### CommentService
- `list(taskId)`, `add(ctx, taskId, body)`.

### BudgetService
- `summary(ctx, projectId)` → `{ cap, planned, committed, actual, byCategory[], byWorkstream[], overCap, overruns[] }`.

### MilestoneService
- `list/create/update/setStatus` with gate readiness from linked tasks.

### DashboardService
- `overview(ctx, projectId)` → KPIs, progress by phase/workstream/project, upcoming deadlines, recent activity, countdown.

### AuditService
- `record(ctx, { action, entityType, entityId, before, after })` — INSERT only.
- `feed(ctx, projectId, query)`, `entityHistory(entityType, entityId)`.

### ImportExportService
- `importPackedSeed(ctx, projectId, json)` — upsert by `(projectId, code)`, create phases/workstreams on first sight, map assignments.
- `exportProject(ctx, projectId)` → JSON; `exportTasksCsv(ctx, projectId)`.

### RealtimeGateway
- `joinProject(socket, projectId)` (authz by membership), `emit(projectId, event, payload)`.

## 5. Validation rules (shared zod)
- Email RFC-validated; password ≥ 10 chars, not in common-password list.
- Strings length-bounded (title ≤ 200, description ≤ 4000, comment ≤ 4000, notes ≤ 4000).
- `percent` int 0–100; money int ≥ 0; dates ISO-8601; `deadline ≥ startDate`.
- Reject unknown/extra fields (strict parsing).
