# 07 — Test Plan

## 1. Strategy & pyramid

| Layer | Tooling | Scope | Target |
|---|---|---|---|
| Unit | Jest (api), Vitest (web) | services, RBAC policy, invariants, reducers | many, fast |
| Integration | Jest + Supertest + **Testcontainers Postgres** | route → service → real DB | per endpoint |
| Component (web) | Vitest + Testing Library | views, forms, query hooks (MSW mocks) | key UI |
| E2E | Playwright | critical user journeys across roles | few, high-value |
| Security | Jest/Supertest + scripts | authz bypass, token reuse, rate limit, injection | per protected route |

**Coverage gate:** ≥ 80% lines / 75% branches overall; RBAC, AuthService, TaskService, BudgetService must be ≥ 90% lines. CI fails below threshold.

## 2. Critical unit cases

### RBAC policy
- OWNER/PM allowed every capability.
- LEAD allowed editing task in scoped workstream; **denied** (403) editing out-of-scope workstream.
- MEMBER allowed `progress` on assigned task; **denied** on unassigned; **denied** editing non-progress fields.
- VIEWER denied all writes incl. comment.
- Non-member denied all (and not leaked existence → 404 vs 403 policy documented).

### Task invariants (`updateProgress`)
- set `COMPLETED` ⇒ percent becomes 100.
- set percent 100 ⇒ status becomes COMPLETED.
- percent 40 while NOT_STARTED ⇒ status IN_PROGRESS.
- Kanban move to NOT_STARTED ⇒ percent 0.
- deadline < start ⇒ rejected.
- dependency cycle ⇒ rejected.

### Budget rollup
- committed = Σ task.budget; actual = Σ task.actual; planned = Σ category.planned.
- overCap flagged when any of planned/committed/actual > cap.
- category overrun > 10% surfaced.
- BigInt math correct at ≥ 1e9 (no float drift).

### Auth
- Argon2id verify true/false.
- refresh rotation issues new + revokes old + links replacedBy.
- reused refresh ⇒ family revoked.
- expired refresh ⇒ 401.

## 3. Integration cases (Supertest + Testcontainers)
- `POST /auth/login` happy + wrong password (401, generic) + rate limit (429 after N).
- `POST /projects` creates project and OWNER membership atomically.
- `GET /projects/:pid/tasks` returns only that project's tasks; filters & pagination correct.
- `PATCH /tasks/:id/progress` as MEMBER assignee → 200; as MEMBER non-assignee → 403; audit row written; WS event emitted (assert via test gateway/spy).
- `PATCH /tasks/:id` as LEAD out-of-scope → 403.
- `DELETE /tasks/:id` as LEAD → 403; as PM → 204.
- IDOR: user A (project 1) requests `/tasks/:id` of project 2 → 404/403 (no data leak).
- Config: renaming a status cascades to tasks in one transaction; deleting referenced status without replacement → 409.
- Import: importing `tasks.seed.json` yields **628** tasks, creates expected phases/workstreams, maps assignments; re-import is idempotent (no duplicates by code).

## 4. E2E journeys (Playwright)
1. **Owner setup:** register → create project → set cap/dates → add a LEAD with workstream scope → import seed → see dashboard counts.
2. **Lead flow:** sign in → filter to own workstream → create task → set schedule → cannot open Settings (hidden) and direct API call returns 403.
3. **Member flow:** sign in → "My tasks" → drag a card to Completed → percent shows 100 → comment posted → second browser sees realtime update.
4. **Viewer flow:** read-only; all edit controls absent; attempted PATCH returns 403.
5. **Budget:** add task budgets pushing a category > cap → dashboard shows over-cap flag.

## 5. Security tests
- For **every** protected route: unauthenticated → 401; wrong-role → 403; cross-project → 404/403.
- Refresh token reuse → 401 + family revoked (assert DB).
- Rate limit on `/auth/login` and `/auth/refresh`.
- Injection/fuzz: task title/description/comment with `' OR 1=1 --`, `<script>`, very long strings, unicode → stored safely, rendered escaped, no 500.
- Headers present: HSTS (edge), `X-Content-Type-Options`, CSP, no `Server` banner leak; CORS rejects unknown origin.
- AuthZ regression suite runs on every PR.

## 6. Test data & fixtures
- Factory builders for org/user/project/member/task (e.g., `makeTask({status, workstream})`).
- A "roles fixture" seeding one user per role with proper scope for permission tests.
- Use the real `tasks.seed.json` in one integration suite to validate the importer at scale.

## 7. CI pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml (target)
on: [push, pull_request]
jobs:
  build-test:
    runs-on: ubuntu-latest
    services: { postgres: { image: postgres:16, ports: ['5432:5432'], env: { POSTGRES_PASSWORD: test } } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint && pnpm typecheck
      - run: pnpm -F backend prisma migrate deploy
      - run: pnpm test:cov            # fails under coverage threshold
      - run: pnpm -F backend audit --audit-level=high
      - run: pnpm build
      - run: pnpm test:e2e            # Playwright (headless)
```

## 8. Definition of test-done per feature
A feature ships only when: unit (happy+edge+deny), one integration test, any specified E2E step, and security route checks are green, and coverage thresholds hold.
