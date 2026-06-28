# 04 — API Specification

Base URL: `/api/v1`. Auth: `Authorization: Bearer <access>` (except auth endpoints). Refresh via httpOnly cookie. All list endpoints support `?page&pageSize&sort&order`. Errors use the envelope in §4. Full contract: `api/openapi.yaml`.

## 1. Auth

| Method | Path | Body | Returns | Authz |
|---|---|---|---|---|
| POST | `/auth/register` | `{orgSlug?,name,email,password}` | `201 {user}` | public (first user of org → OWNER) |
| POST | `/auth/login` | `{email,password}` | `200 {accessToken, user}` + Set-Cookie refresh | public, rate-limited |
| POST | `/auth/refresh` | – (cookie) | `200 {accessToken}` + rotated cookie | cookie |
| POST | `/auth/logout` | – | `204` | auth |
| GET | `/auth/me` | – | `200 {user, memberships[]}` | auth |

## 2. Projects, members, config

| Method | Path | Returns | Authz |
|---|---|---|---|
| GET | `/projects` | projects caller belongs to | auth |
| POST | `/projects` | created project (+ caller as OWNER) | auth |
| GET | `/projects/:pid` | project detail | member |
| PATCH | `/projects/:pid` | updated meta | OWNER/PM |
| POST | `/projects/:pid/archive` | archived | OWNER |
| GET | `/projects/:pid/members` | members | member |
| POST | `/projects/:pid/members` | added member | OWNER/PM |
| PATCH | `/projects/:pid/members/:mid` | role/scope/label | OWNER/PM |
| DELETE | `/projects/:pid/members/:mid` | removed | OWNER/PM |
| GET/POST/PATCH/DELETE | `/projects/:pid/phases[/:id]` | phase CRUD + reorder | read: member · write: OWNER/PM |
| GET/POST/PATCH/DELETE | `/projects/:pid/workstreams[/:id]` | workstream CRUD | read: member · write: OWNER/PM |
| GET/POST/PATCH/DELETE | `/projects/:pid/statuses[/:id]` | status defs | read: member · write: OWNER/PM |
| GET/POST/PATCH/DELETE | `/projects/:pid/priorities[/:id]` | priority defs | read: member · write: OWNER/PM |
| GET/POST/PATCH/DELETE | `/projects/:pid/budget-categories[/:id]` | budget categories | read: member · write: OWNER/PM |

## 3. Tasks, progress, comments, budget, gates, dashboard

| Method | Path | Notes | Authz |
|---|---|---|---|
| GET | `/projects/:pid/tasks` | filters: `phaseId,workstreamId,status,priority,assignee,q`; paginated | member |
| POST | `/projects/:pid/tasks` | create | OWNER/PM/LEAD(scope) |
| GET | `/projects/:pid/tasks/mine` | caller's assigned tasks | member |
| GET | `/tasks/:id` | detail + assignments + comments count | member |
| PATCH | `/tasks/:id` | full edit | OWNER/PM/LEAD(scope) |
| PATCH | `/tasks/:id/progress` | `{status?,percent?,notes?}`; applies invariants | OWNER/PM/LEAD(scope)/MEMBER(assignee) |
| PUT | `/tasks/:id/assignments` | replace assignments | OWNER/PM/LEAD(scope) |
| PUT | `/tasks/:id/dependencies` | set deps (cycle-checked) | OWNER/PM/LEAD(scope) |
| DELETE | `/tasks/:id` | delete | OWNER/PM |
| GET | `/tasks/:id/comments` | thread | member |
| POST | `/tasks/:id/comments` | add comment | non-viewer member |
| GET | `/projects/:pid/budget/summary` | rollups vs cap | member |
| GET/POST/PATCH | `/projects/:pid/milestones[/:id]` | gates/milestones | read: member · write: OWNER/PM, LEAD(status in scope) |
| GET | `/projects/:pid/dashboard` | KPIs + aggregates | member |
| GET | `/projects/:pid/activity` | audit feed (paginated) | OWNER/PM, LEAD(scope) |
| GET | `/projects/:pid/export` | full JSON | OWNER/PM |
| GET | `/projects/:pid/export/tasks.csv` | CSV | OWNER/PM |
| POST | `/projects/:pid/import` | packed seed JSON | OWNER/PM |

## 4. Error envelope

```json
{ "error": { "code": "FORBIDDEN", "message": "You cannot edit tasks outside your workstream.", "requestId": "req_..." } }
```
Codes: `VALIDATION`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL`. Never include stack traces or DB messages.

## 5. WebSocket events

Namespace `/ws`, auth by access token on connect. Client emits `project:join {projectId}` (server authorizes by membership). Server broadcasts to room `project:{pid}`:

| Event | Payload |
|---|---|
| `task.created` / `task.updated` / `task.deleted` | `{ task }` / `{ taskId }` |
| `task.progress` | `{ taskId, status, percent, by }` |
| `comment.created` | `{ taskId, comment }` |
| `budget.changed` | `{ projectId }` (clients refetch summary) |
| `milestone.updated` | `{ milestone }` |

## 6. Pagination & sorting
`page` (1-based), `pageSize` (≤100, default 25). Response: `{ data:[], page, pageSize, total }`. `sort` is a whitelisted field; `order` ∈ {asc,desc}.

## 7. Rate limits (Redis)
- `/auth/login`, `/auth/register`, `/auth/refresh`: 10/min/IP + per-account backoff.
- Mutating endpoints: 120/min/user. Read: 600/min/user. Exceed → `429 RATE_LIMITED`.
