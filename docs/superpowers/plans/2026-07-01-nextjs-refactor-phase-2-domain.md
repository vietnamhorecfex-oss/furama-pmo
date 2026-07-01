# Next.js Refactor — Phase 2 (Core Domain: projects, config, members, tasks, comments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the core domain of the NestJS `backend/` into the Next.js app at `web/` as server functions + REST route handlers, so projects, config dimensions, members, tasks, and comments all work against the real Postgres DB with RBAC + audit intact.

**Architecture:** Vertical slices — each module ports its NestJS service into `web/src/server/<module>/` as plain functions (injected `PrismaService` → singleton import; `assertCan`/`auditRecord`/errors reused from Phase 1), then exposes REST route handlers under `web/src/app/api/v1/**` mirroring the backend controllers. WebSocket emits are DROPPED (realtime becomes client polling in Phase 5). This deviates from the design spec's P2(services)/P3(routes) split — we do service+routes together per module so each task ends with a working, integration-tested endpoint (better CLAUDE.md DoD alignment). Recorded as a deviation in the plan; note in `docs/CHANGELOG.md` at phase end.

**Tech Stack:** Next.js 14 App Router route handlers, Prisma 5, zod (`@furama/shared`), Vitest (integration against native Postgres).

## Global Constraints

- **The backend source is the line-level spec for each port.** Every task names the exact `backend/src/<module>/*.service.ts` to port. Reproduce its logic and invariants faithfully; the only mechanical transforms are: NestJS class → module functions; injected `this.prisma` → `import { prisma }`; `ForbiddenException/NotFoundException/BadRequestException/ConflictException` → `Forbidden/NotFound/BadRequest/Conflict` from `web/src/server/http/errors`; `this.rbac.assertCan` → `assertCan` from `web/src/server/rbac/rbac`; `this.audit.record` → `auditRecord` from `web/src/server/audit/audit`.
- **AuthContext** is `{ userId: string; orgId: string }` (from `web/src/server/rbac/rbac`). Obtain it in every route handler via `getAuthContext(req)` (`web/src/server/auth/session`). `assertCan` already denies non-members (`effectiveRole` null → Forbidden), so there is NO separate project-member guard — membership is enforced by the first `assertCan` in each service method.
- **Money is `BigInt` in the DB.** `JSON.stringify`/`Response.json` THROWS on a raw BigInt. Every DTO mapper MUST convert money to `Number` (`Number(row.budgetVnd)` etc.) before returning. Fields: `Project.budgetCapVnd`, `BudgetCategory.plannedVnd`, `Task.budgetVnd`, `Task.actualVnd`. Write to DB with `BigInt(dto.x)`.
- **WebSocket emits are REMOVED.** Where the backend calls `this.realtime.emit(...)`, the port simply omits it (a code comment `// realtime: was emit(...); replaced by client polling in Phase 5` is fine). Do NOT add socket.io.
- **Route handler conventions:** body via `readJson(req)` (`web/src/server/http/request` — throws 400 on bad JSON) then `<schema>.parse(...)`; dynamic params via the handler's 2nd arg `ctx.params`; query params via `new URL(req.url).searchParams`; client IP via `clientIp(req)`; wrap every handler in `route(...)` from `web/src/server/http/envelope` for the error envelope. Reject unknown fields (schemas are `.strict()`/`.strip()` already).
- **Next.js routing rule:** a dynamic segment must use ONE param name at a given position. The task segment is ALWAYS `[id]` — comments live at `app/api/v1/tasks/[id]/comments/route.ts` (NOT `[taskId]`). Literal segments that share a parent with a dynamic route need their own folder and take precedence: `tasks/mine/`, `phases/reorder/`, `workstreams/reorder/`, etc.
- **`/tasks/[id]/**` and `/tasks/[id]/comments` have NO `projectId` in the URL** — the service resolves `projectId` by fetching the task first, then authorizes. Replicate that two-step.
- **Tests** are Vitest integration tests against the native Postgres `furama_pmo` (env auto-loaded by `web/vitest.setup.ts`). Seed rows via Prisma in `beforeAll`, clean up in `afterAll` (respect FK order). Prove at minimum: the happy path AND one RBAC deny path per module.
- **Schema field reality (verified in Phase 1):** `Project` has NO `code`; `Workstream` has `name`/`track`(enum)/`order`, NO `key`; `Task.status` is enum `NOT_STARTED|IN_PROGRESS|IN_REVIEW|BLOCKED|COMPLETED`; `Task.code` required, unique per project; `ProjectMember.memberLabel` nullable; `MemberWorkstream` = `{projectMemberId, workstreamId}` + `projectMember` relation.
- OpenAPI (`api/openapi.yaml`) only documents a few of these paths. We follow the **backend controllers** as the contract for full parity; updating openapi is deferred to Phase 6 (note it, don't block).
- No new `any`; DB access only in `web/src/server/**`. Audit every mutation. Coverage ≥80% line / 75% branch per module.

---

## File Structure (created in this plan)

```
web/src/server/
  http/serialize.ts            # money BigInt→Number helper + Paginated shape
  projects/projects.ts
  config/phases.ts  config/workstreams.ts
  config/statuses.ts  config/priorities.ts  config/categories.ts
  members/members.ts
  tasks/task-invariants.ts  tasks/tasks.ts
  comments/comments.ts
web/src/app/api/v1/
  projects/route.ts                                   # GET list, POST create
  projects/[projectId]/route.ts                       # GET get, PATCH updateMeta
  projects/[projectId]/archive/route.ts               # POST
  projects/[projectId]/phases/route.ts                # GET,POST
  projects/[projectId]/phases/reorder/route.ts        # POST
  projects/[projectId]/phases/[id]/route.ts           # PATCH,DELETE
  projects/[projectId]/workstreams/…                  # same shape
  projects/[projectId]/statuses/…                     # same shape (+DELETE ?replaceWithKey)
  projects/[projectId]/priorities/…                   # same shape (+DELETE ?replaceWithKey)
  projects/[projectId]/budget-categories/…            # same shape
  projects/[projectId]/members/route.ts               # GET,POST
  projects/[projectId]/members/[memberId]/route.ts    # PATCH,DELETE
  projects/[projectId]/tasks/route.ts                 # GET list, POST create
  projects/[projectId]/tasks/mine/route.ts            # GET
  tasks/[id]/route.ts                                 # GET, PATCH, DELETE
  tasks/[id]/progress/route.ts                        # PATCH
  tasks/[id]/assignments/route.ts                     # PUT
  tasks/[id]/dependencies/route.ts                    # PUT
  tasks/[id]/comments/route.ts                        # GET, POST
```

---

## Task 2.0: Shared serialization helper

**Files:**
- Create: `web/src/server/http/serialize.ts`
- Test: `web/src/server/http/serialize.test.ts`

**Interfaces:**
- Produces: `moneyToNumber(v: bigint | number | null | undefined): number` (BigInt→Number, null/undefined→0); `type Paginated<T> = { data: T[]; page: number; pageSize: number; total: number }`.

- [ ] **Step 1: Write the failing test `serialize.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { moneyToNumber } from './serialize';

describe('moneyToNumber', () => {
  it('converts bigint to number', () => { expect(moneyToNumber(1234567890n)).toBe(1234567890); });
  it('passes through number', () => { expect(moneyToNumber(42)).toBe(42); });
  it('maps null/undefined to 0', () => { expect(moneyToNumber(null)).toBe(0); expect(moneyToNumber(undefined)).toBe(0); });
});
```

- [ ] **Step 2: Run → FAIL** `npm run test -w @furama/web -- serialize` (module missing).

- [ ] **Step 3: Implement `serialize.ts`**

```ts
export type Paginated<T> = { data: T[]; page: number; pageSize: number; total: number };

/** Convert a DB money value (VND BigInt) to a JSON-safe number. Response.json throws on raw BigInt. */
export function moneyToNumber(v: bigint | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'bigint' ? Number(v) : v;
}
```

- [ ] **Step 4: Run → PASS** (3 tests). Then `npm run typecheck -w @furama/web` → clean.

- [ ] **Step 5: Commit** `git add web/src/server/http/serialize.ts web/src/server/http/serialize.test.ts && git commit -m "feat(web/server): money serialization helper + Paginated type"`

---

## Task 2.1: Projects — service + routes

**Files:**
- Create: `web/src/server/projects/projects.ts`, `web/src/app/api/v1/projects/route.ts`, `web/src/app/api/v1/projects/[projectId]/route.ts`, `web/src/app/api/v1/projects/[projectId]/archive/route.ts`
- Test: `web/src/server/projects/projects.test.ts`

**Port from:** `backend/src/projects/projects.service.ts` + `projects.controller.ts`.

**Interfaces (functions to produce, all take `ctx: AuthContext` first):**
- `createProject(ctx, dto: CreateProjectDto, ip): Promise<ProjectDto>` — creates project under `ctx.orgId` AND an OWNER `ProjectMember` for `ctx.userId` **in one `prisma.$transaction`**. No `assertCan` (any authed user may create). Validates `startDate<=endDate` (throw `BadRequest`) — but rely on `createProjectSchema` which already refines start/end/opening ranges. Audit `project.created`. Map `budgetCapVnd` with `BigInt(dto.budgetCapVnd)`.
- `listProjects(ctx): Promise<ProjectDto[]>` — non-archived projects where `members.some({ userId: ctx.userId })`, `createdAt desc`. No assertCan.
- `getProject(ctx, projectId): Promise<ProjectDto>` — `assertCan(ctx,'VIEW_PROJECT',projectId)`; `NotFound` if missing.
- `updateProjectMeta(ctx, projectId, dto: UpdateProjectMetaDto, ip): Promise<ProjectDto>` — `assertCan(ctx,'MANAGE_CONFIG',projectId)`; partial update (undefined = leave); re-validate merged start/end order; `BigInt` cast on `budgetCapVnd` if present; audit `project.updated` with before/after.
- `archiveProject(ctx, projectId, ip): Promise<ProjectDto>` — `assertCan(ctx,'ARCHIVE_PROJECT',projectId)` (OWNER only); `Conflict` if already archived; set `archivedAt=now`, `status='ARCHIVED'`; audit `project.archived`.
- `toProjectDto(row): ProjectDto` — map fields; `budgetCapVnd: moneyToNumber(row.budgetCapVnd)`; dates → ISO string | null.

**Routes:** `GET /api/v1/projects`→listProjects (200); `POST /api/v1/projects`→createProject (201); `GET /api/v1/projects/[projectId]`→getProject (200); `PATCH …/[projectId]`→updateProjectMeta (200); `POST …/[projectId]/archive`→archiveProject (200). Each: `const ctx = getAuthContext(req)`, parse body with `createProjectSchema`/`updateProjectMetaSchema`, `params.projectId`, `clientIp(req)`.

- [ ] **Step 1: Write the failing integration test `projects.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { createProject, listProjects, getProject, archiveProject } from './projects';

let orgId: string, userId: string, otherUserId: string;
const ctx = () => ({ userId, orgId });

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { slug: `p-${Date.now()}`, name: 'P' } });
  orgId = org.id;
  userId = (await prisma.user.create({ data: { orgId, name: 'O', email: `o-${Date.now()}@x.test`, passwordHash: 'x', isActive: true } })).id;
  otherUserId = (await prisma.user.create({ data: { orgId, name: 'X', email: `x-${Date.now()}@x.test`, passwordHash: 'x', isActive: true } })).id;
});
afterAll(async () => {
  await prisma.projectMember.deleteMany({ where: { project: { orgId } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [userId, otherUserId] } } });
  await prisma.project.deleteMany({ where: { orgId } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('projects', () => {
  let pid: string;
  it('creates a project and makes the caller OWNER; budgetCapVnd is a number', async () => {
    const p = await createProject(ctx(), { name: 'Grand Opening', budgetCapVnd: 2241700000 } as any, null);
    pid = p.id;
    expect(typeof p.budgetCapVnd).toBe('number');
    const m = await prisma.projectMember.findFirst({ where: { projectId: pid, userId } });
    expect(m?.role).toBe('OWNER');
  });
  it('lists only projects the caller belongs to', async () => {
    const mine = await listProjects(ctx());
    expect(mine.find((p) => p.id === pid)).toBeTruthy();
    const others = await listProjects({ userId: otherUserId, orgId });
    expect(others.find((p) => p.id === pid)).toBeFalsy();
  });
  it('denies get for a non-member (Forbidden)', async () => {
    await expect(getProject({ userId: otherUserId, orgId }, pid)).rejects.toThrow(/member|forbidden/i);
  });
  it('archive is OWNER-only and rejects double-archive', async () => {
    await archiveProject(ctx(), pid, null);
    await expect(archiveProject(ctx(), pid, null)).rejects.toThrow(/archiv/i);
  });
});
```

- [ ] **Step 2: Run → FAIL** `npm run test -w @furama/web -- projects`.

- [ ] **Step 3: Implement `projects.ts`** — port `backend/src/projects/projects.service.ts` per the Interfaces above. Use `prisma.$transaction` for `createProject` (project + OWNER member). Import `assertCan`, `auditRecord`, `moneyToNumber`, errors. Reuse `CreateProjectDto/UpdateProjectMetaDto/ProjectDto` from `@furama/shared`.

- [ ] **Step 4: Run → PASS** (4 tests). `npm run typecheck` clean.

- [ ] **Step 5: Implement the 5 route handlers** (thin: getAuthContext → parse → call → NextResponse.json with status). Example `projects/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createProjectSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp } from '@/server/http/request';
import { readJson } from '@/server/http/request';
import { listProjects, createProject } from '@/server/projects/projects';

export const GET = route(async (req) => {
  const ctx = getAuthContext(req);
  return NextResponse.json(await listProjects(ctx), { status: 200 });
});
export const POST = route(async (req) => {
  const ctx = getAuthContext(req);
  const dto = createProjectSchema.parse(await readJson(req));
  return NextResponse.json(await createProject(ctx, dto, clientIp(req)), { status: 201 });
});
```
(Handlers with params read `ctx2.params.projectId` from the 2nd arg. Use the `@/` alias consistently.)

- [ ] **Step 6: Manual verify** with the dev server detached on :3002 (start `nohup npm run dev -w @furama/web`, poll `/api/health`): log in (reuse the Phase 1 curl to get an access token), then `POST /api/v1/projects` with `{"name":"Test"}` → 201; `GET /api/v1/projects` → 200 array; kill the server. Do not touch :3000/:3001.

- [ ] **Step 7: Commit** `git add web/src/server/projects web/src/app/api/v1/projects && git commit -m "feat(web): projects service + routes (create/list/get/update/archive)"`

---

## Task 2.2: Config-dim — phases + workstreams

**Files:**
- Create: `web/src/server/config/phases.ts`, `web/src/server/config/workstreams.ts`
- Create routes under `web/src/app/api/v1/projects/[projectId]/phases/{route.ts, reorder/route.ts, [id]/route.ts}` and the same three under `.../workstreams/`
- Test: `web/src/server/config/phases.test.ts`, `web/src/server/config/workstreams.test.ts`

**Port from:** `backend/src/config-dim/config.service.ts` (Phase methods lines ~60-122, Workstream ~124-187) + `config.controller.ts`.

**Interfaces (each `ctx` first):**
- Phases: `listPhases(ctx, projectId)` (VIEW_PROJECT, order `[order asc, name asc]`); `createPhase(ctx, projectId, dto: CreatePhaseDto, ip)` (MANAGE_CONFIG, unique `(projectId,name)` → `Conflict` on P2002, audit `phase.created`); `updatePhase(ctx, projectId, phaseId, dto: UpdatePhaseDto, ip)` (MANAGE_CONFIG, scope-guard via `findFirst({id,projectId})` → NotFound, audit `phase.updated`); `deletePhase(ctx, projectId, phaseId, ip)` (MANAGE_CONFIG, block if any `task.count>0` referencing phaseId → `Conflict`, audit `phase.deleted`); `reorderPhases(ctx, projectId, dto: ReorderDto, ip)` (MANAGE_CONFIG, bulk `$transaction`, audit `phase.reordered`).
- Workstreams: same five (`listWorkstreams/createWorkstream/updateWorkstream/deleteWorkstream/reorderWorkstreams`). **`deleteWorkstream` blocks if `task.count>0` OR `memberWorkstream.count>0`** (both checks — don't omit the MemberWorkstream one). Audit `workstream.*`.

**Routes (both dimensions identical shape):** `GET/POST .../phases`; `POST .../phases/reorder`; `PATCH/DELETE .../phases/[id]`. DELETE → 204. `reorder` MUST be its own folder so it isn't captured by `[id]`.

- [ ] **Step 1: Write failing integration tests** — `phases.test.ts` proving: create → list ordered; duplicate name → Conflict; delete blocked when a task references the phase; a non-manager (VIEWER member) gets Forbidden on create. `workstreams.test.ts` proving create/list + delete blocked when a `MemberWorkstream` references it. (Seed org/user/project + a VIEWER member for the deny path. Use `status: 'NOT_STARTED'` for any seeded task.)

```ts
// phases.test.ts sketch — fill seed per Task 2.1 pattern
it('rejects a duplicate phase name with Conflict', async () => {
  await createPhase(ownerCtx, pid, { name: 'Design' } as any, null);
  await expect(createPhase(ownerCtx, pid, { name: 'Design' } as any, null)).rejects.toThrow(/conflict|exist/i);
});
it('a VIEWER cannot create a phase (Forbidden)', async () => {
  await expect(createPhase(viewerCtx, pid, { name: 'X' } as any, null)).rejects.toThrow(/forbidden|cannot/i);
});
it('blocks deleting a phase still referenced by a task', async () => {
  const ph = await createPhase(ownerCtx, pid, { name: 'Build' } as any, null);
  await prisma.task.create({ data: { projectId: pid, phaseId: ph.id, code: `T${Date.now()}`, title: 't', status: 'NOT_STARTED', priority: 'MEDIUM' } });
  await expect(deletePhase(ownerCtx, pid, ph.id, null)).rejects.toThrow(/conflict|referenc|in use/i);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `phases.ts` + `workstreams.ts`** porting the two dimensions faithfully (P2002 catch → Conflict; scope via `findFirst({id,projectId})`; reference-count guards; `$transaction` for reorder).
- [ ] **Step 4: Run → PASS.** typecheck clean.
- [ ] **Step 5: Implement the 6 route files** (phases ×3, workstreams ×3). Each thin handler: getAuthContext, params.projectId (+ params.id where applicable), parse body with the matching schema, call, return (list/patch 200, create 201, delete 204, reorder 200).
- [ ] **Step 6: Commit** `git add web/src/server/config/phases.ts web/src/server/config/workstreams.ts web/src/app/api/v1/projects/[projectId]/phases web/src/app/api/v1/projects/[projectId]/workstreams && git commit -m "feat(web): config phases + workstreams service + routes"`

---

## Task 2.3: Config-dim — statuses + priorities + budget-categories

**Files:**
- Create: `web/src/server/config/statuses.ts`, `config/priorities.ts`, `config/categories.ts`
- Routes: `.../statuses/{route,reorder,[id]}`, `.../priorities/{route,reorder,[id]}`, `.../budget-categories/{route,reorder,[id]}`
- Test: `web/src/server/config/statuses.test.ts`, `categories.test.ts`

**Port from:** `config.service.ts` StatusDef (~189-293), PriorityDef (~295-381), BudgetCategory (~383-448).

**Interfaces:**
- StatusDef & PriorityDef (identical shape): `list*` (VIEW_PROJECT, order `[order asc, key asc]`); `create*` (MANAGE_CONFIG, unique `(projectId,key)`, audit `status.created`/`priority.created`); `update*` (MANAGE_CONFIG; supports `renameToKey`: validate no clash then update key in `$transaction`; the task-migration is intentionally COMMENTED OUT in the backend — keep it commented, `Task.status`/`priority` are Prisma enums in v1; audit `*.updated`); `delete*(ctx, projectId, id, opts: DeleteWithReplacementDto, ip)` (MANAGE_CONFIG; if tasks reference the key and no `replaceWithKey` → `Conflict`; if `replaceWithKey` given: validate replacement exists, migrate tasks + delete in `$transaction`; audit `*.deleted`); `reorder*` (MANAGE_CONFIG, bulk tx).
- BudgetCategory: `listBudgetCategories` (VIEW_PROJECT); `createBudgetCategory`/`updateBudgetCategory` (**MANAGE_BUDGET**, `plannedVnd` → `BigInt(dto.plannedVnd)`, DTO out uses `moneyToNumber(row.plannedVnd)` and `moneyToNumber(row.actualVnd)`); `deleteBudgetCategory` (MANAGE_BUDGET, block if a task references `budgetCategoryId` → Conflict); `reorderBudgetCategories` (MANAGE_BUDGET, tx). Audit `budgetCategory.*`.

**Routes:** same 3-file shape per dimension. **DELETE statuses/priorities read `replaceWithKey` from the QUERY STRING**, not the body: in the handler, `const replaceWithKey = new URL(req.url).searchParams.get('replaceWithKey') ?? undefined;` then `deleteStatusDef(ctx, projectId, id, { replaceWithKey }, ip)`. budget-categories DELETE has no query param.

- [ ] **Step 1: Write failing tests** — `statuses.test.ts`: create status; delete-in-use without `replaceWithKey` → Conflict; delete WITH `replaceWithKey` migrates tasks then deletes (assert tasks now have the replacement key... note `Task.status` is an enum, so the migration is the commented-out path — instead assert delete succeeds when no task references it, and Conflict when one does). `categories.test.ts`: create with `plannedVnd` → DTO `plannedVnd` is a `number`; MANAGE_BUDGET denies a LEAD.

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `statuses.ts`, `priorities.ts`, `categories.ts`** — statuses & priorities share the exact same shape (write priorities by adapting statuses; do NOT abstract into one generic — keep them separate files matching the backend, values differ by `renameToKey` field name and audit action). Preserve the commented-out task migration verbatim.
- [ ] **Step 4: Run → PASS.** typecheck clean.
- [ ] **Step 5: Implement the 9 route files.** statuses/priorities DELETE parse `replaceWithKey` from query.
- [ ] **Step 6: Commit** `git add web/src/server/config/statuses.ts web/src/server/config/priorities.ts web/src/server/config/categories.ts web/src/app/api/v1/projects/[projectId]/statuses web/src/app/api/v1/projects/[projectId]/priorities web/src/app/api/v1/projects/[projectId]/budget-categories && git commit -m "feat(web): config statuses + priorities + budget-categories service + routes"`

---

## Task 2.4: Members — service + routes

**Files:**
- Create: `web/src/server/members/members.ts`, routes `web/src/app/api/v1/projects/[projectId]/members/{route.ts,[memberId]/route.ts}`
- Test: `web/src/server/members/members.test.ts`

**Port from:** `backend/src/members/members.service.ts` + controller.

**Interfaces:**
- `listMembers(ctx, projectId): Promise<MemberDto[]>` — `VIEW_PROJECT`; include `workstreams:{select:{workstreamId:true}}` → `workstreamIds: string[]`; order `createdAt asc`.
- `addMember(ctx, projectId, dto: AddMemberDto, ip): Promise<MemberDto>` — `MANAGE_MEMBERS`; pre-check duplicate `(projectId,userId)` → `Conflict`; `memberLabel` unique per project (`assertLabelFree`); `$transaction`: create member then `applyScope` (write `MemberWorkstream` rows if `role='LEAD'` and `workstreamIds` given; **validate every workstreamId belongs to the project** → `BadRequest` if not); audit `member.added`; return `getOne` (with workstream join).
- `updateMember(ctx, projectId, memberId, dto: UpdateMemberDto, ip): Promise<MemberDto>` — `MANAGE_MEMBERS`; if demoting an OWNER → `assertNotLastOwner` INSIDE the tx (count owners excluding this member; `<1` → `BadRequest('Cannot remove or demote the last OWNER')`); run `applyScope` when `dto.workstreamIds!==undefined || dto.role!==undefined` (non-LEAD roles clear scope); audit `member.updated`. **Distinguish `workstreamIds===undefined` (leave scope) from `[]` (clear).**
- `removeMember(ctx, projectId, memberId, ip): Promise<void>` — `MANAGE_MEMBERS`; if removing an OWNER → `assertNotLastOwner` in tx; hard-delete (MemberWorkstream cascades); audit `member.removed`.
- Helpers `applyScope`, `assertNotLastOwner`, `assertLabelFree(projectId, label, exceptMemberId?)` — port as private module functions.

**Routes:** `GET/POST .../members`; `PATCH/DELETE .../members/[memberId]` (DELETE 204).

- [ ] **Step 1: Write failing integration test** proving: add a LEAD with `workstreamIds` → member has those `workstreamIds`; adding a workstreamId from another project → BadRequest; duplicate memberLabel → Conflict; **demoting the last OWNER → BadRequest** (the load-bearing invariant). Seed: org, 2 users, project with the caller as OWNER member, a workstream.

```ts
it('refuses to demote the last OWNER', async () => {
  // ownerMember is the only OWNER
  await expect(updateMember(ownerCtx, pid, ownerMemberId, { role: 'PM' } as any, null))
    .rejects.toThrow(/last owner/i);
});
it('rejects a workstreamId from another project', async () => {
  await expect(addMember(ownerCtx, pid, { userId: u2, role: 'LEAD', memberLabel: 'L', workstreamIds: [foreignWsId] } as any, null))
    .rejects.toThrow(/bad request|workstream/i);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `members.ts`** porting faithfully; keep the last-owner check inside the same `$transaction` as the mutation (TOCTOU safety).
- [ ] **Step 4: Run → PASS.** typecheck clean.
- [ ] **Step 5: Implement the 2 route files.**
- [ ] **Step 6: Commit** `git add web/src/server/members web/src/app/api/v1/projects/[projectId]/members && git commit -m "feat(web): members service + routes (scope, last-owner guard)"`

---

## Task 2.5: Tasks — service part 1 (list/get/mine/create) + invariants

**Files:**
- Create: `web/src/server/tasks/task-invariants.ts`, `web/src/server/tasks/tasks.ts` (part 1 methods), routes `web/src/app/api/v1/projects/[projectId]/tasks/{route.ts, mine/route.ts}`, `web/src/app/api/v1/tasks/[id]/route.ts` (GET only for now)
- Test: `web/src/server/tasks/task-invariants.test.ts`, `web/src/server/tasks/tasks.create.test.ts`

**Port from:** `backend/src/tasks/task-invariants.ts` (pure) and `tasks.service.ts` methods `list` (~66), `get` (~108), `myTasks` (~118), `create` (~136), `generateCode` (~412). **Drop the `realtime.emit` in `create`.**

**Interfaces:**
- `applyTaskInvariants({ current, next, kanbanMove? }): { resolved, conflict }` — pure port of `task-invariants.ts`: COMPLETED⇒percent=100; percent=100⇒COMPLETED; 0<percent<100 & NOT_STARTED⇒IN_PROGRESS; kanbanMove+next NOT_STARTED+no explicit percent⇒percent=0 first; `conflict=true` when explicitly contradictory (COMPLETED+percent≠100, or percent=100+status≠COMPLETED).
- `listTasks(ctx, projectId, q: ListTasksQuery): Promise<Paginated<TaskDto>>` — `VIEW_PROJECT`; filters phaseId/workstreamId/status/priority/assignee(label contains, ci)/q(OR title|code|description, ci); pagination page/pageSize(max100)/sort(whitelist: code,title,priority,status,deadline,startDate,updatedAt,createdAt,percent)/order; include assignments; return `{data,page,pageSize,total}`.
- `getTask(ctx, taskId): Promise<TaskDto>` — fetch task → `assertCan(ctx,'VIEW_PROJECT',task.projectId)`; include assignments + dependencies→`dependsOnTaskIds`; `NotFound` if missing.
- `myTasks(ctx, projectId): Promise<TaskDto[]>` — `VIEW_PROJECT`; resolve caller `memberLabel`; tasks where assigned by `userId` OR `label`; order `[deadline asc, createdAt asc]`.
- `createTask(ctx, projectId, dto: CreateTaskDto, ip): Promise<TaskDto>` — `assertCan(ctx,'CREATE_TASK',projectId,{ workstreamId: dto.workstreamId ?? null })`; `startDate<=deadline` else `BadRequest`; code = `dto.code?.trim()` or `generateCode(projectId, workstreamId)` (prefix by workstream track MKT/OPS/EXE/TSK else TSK, then `<PREFIX>-NNNN` from max seq); explicit dup guard `findFirst({projectId,code})` in tx → `Conflict`; `$transaction`: create Task then `createMany` assignments; `BigInt` on budgetVnd/actualVnd; audit `task.created`; return `getTask(created.id)`.
- `toTaskDto(row): TaskDto` — money via `moneyToNumber`; dates→ISO|null; assignments mapped; `dependsOnTaskIds` from dependencies.

- [ ] **Step 1: Write `task-invariants.test.ts`** (pure, no DB) covering all 5 rules + the conflict cases:

```ts
import { applyTaskInvariants } from './task-invariants';
it('COMPLETED forces percent=100', () => {
  expect(applyTaskInvariants({ current: { status: 'NOT_STARTED', percent: 0 }, next: { status: 'COMPLETED' } }).resolved.percent).toBe(100);
});
it('percent=100 forces COMPLETED', () => {
  expect(applyTaskInvariants({ current: { status: 'IN_PROGRESS', percent: 50 }, next: { percent: 100 } }).resolved.status).toBe('COMPLETED');
});
it('flags conflict when COMPLETED + explicit percent≠100', () => {
  expect(applyTaskInvariants({ current: { status: 'NOT_STARTED', percent: 0 }, next: { status: 'COMPLETED', percent: 50 } }).conflict).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL.** Implement `task-invariants.ts` (verbatim port). Run → PASS.
- [ ] **Step 3: Write `tasks.create.test.ts`** (integration): create a task with an explicit code → `budgetVnd`/`actualVnd` are numbers in the DTO; create without a code under a workstream → auto code matches `/^(MKT|OPS|EXE|TSK)-\d{4}$/`; duplicate explicit code → Conflict; a VIEWER member cannot create (Forbidden); a LEAD who owns workstream A can create in A but a LEAD of A is Forbidden creating in workstream B (the scope deny path).
- [ ] **Step 4: Run → FAIL.** Implement `tasks.ts` part-1 methods + `generateCode`. Run → PASS. typecheck clean.
- [ ] **Step 5: Implement routes** `projects/[projectId]/tasks/route.ts` (GET listTasks via `listTasksQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))`, POST createTask 201), `projects/[projectId]/tasks/mine/route.ts` (GET), and `tasks/[id]/route.ts` (GET getTask only — PATCH/DELETE come in Task 2.6). **`mine` folder must exist so it isn't shadowed.**
- [ ] **Step 6: Commit** `git add web/src/server/tasks web/src/app/api/v1/projects/[projectId]/tasks web/src/app/api/v1/tasks && git commit -m "feat(web): tasks list/get/mine/create + invariants + routes"`

---

## Task 2.6: Tasks — service part 2 (update/progress/delete/assignments/dependencies)

**Files:**
- Modify: `web/src/server/tasks/tasks.ts` (add methods)
- Create routes: `web/src/app/api/v1/tasks/[id]/progress/route.ts`, `.../[id]/assignments/route.ts`, `.../[id]/dependencies/route.ts`; extend `tasks/[id]/route.ts` with PATCH + DELETE
- Test: `web/src/server/tasks/tasks.mutate.test.ts`

**Port from:** `tasks.service.ts` `update` (~212), `updateProgress` (~274), `delete` (~324), `setAssignments` (~342), `setDependencies` (~371). **Drop all four `realtime.emit` calls.**

**Interfaces:**
- `updateTask(ctx, taskId, dto: UpdateTaskDto, ip): Promise<TaskDto>` — fetch → `assertCan(ctx,'EDIT_TASK',projectId,{taskId})`; merged date-order check; `applyTaskInvariants` → `conflict` ⇒ `BadRequest('status and percent are inconsistent')`; BigInt casts; audit `task.updated`.
- `updateTaskProgress(ctx, taskId, dto: ProgressUpdateDto, ip): Promise<TaskDto>` — `assertCan(ctx,'UPDATE_TASK_PROGRESS',projectId,{taskId})` (MEMBER assignee scope); `applyTaskInvariants`; write status/percent/optional notes; audit `task.progress`.
- `deleteTask(ctx, taskId, ip): Promise<void>` — `assertCan(ctx,'DELETE_TASK',projectId)` (no scope; LEAD=false); hard delete (assignments/comments/deps cascade); audit `task.deleted`.
- `setTaskAssignments(ctx, taskId, dto: SetAssignmentsDto, ip): Promise<TaskDto>` — `EDIT_TASK`+`{taskId}`; replace-all in tx; audit `task.assignmentsSet`.
- `setTaskDependencies(ctx, taskId, dto: SetDependenciesDto, ip): Promise<TaskDto>` — `EDIT_TASK`+`{taskId}`; dedupe + drop self; all dep IDs same project else `BadRequest`; **cycle detection**: load whole project dep graph, build adjacency incl. proposed edges, DFS from taskId — if reachable back to taskId → `BadRequest('Dependency cycle detected')`; replace-all tx; audit `task.dependenciesSet`.

**Routes:** `PATCH /tasks/[id]`→updateTask; `DELETE /tasks/[id]`→deleteTask (204); `PATCH /tasks/[id]/progress`→updateTaskProgress; `PUT /tasks/[id]/assignments`→setTaskAssignments; `PUT /tasks/[id]/dependencies`→setTaskDependencies. (assignments/dependencies are PUT.)

- [ ] **Step 1: Write `tasks.mutate.test.ts`** (integration): update to COMPLETED sets percent=100 + writes an audit row; a contradictory update (COMPLETED + percent=50) → BadRequest; MEMBER assignee can updateProgress on their task but a MEMBER non-assignee is Forbidden; `setTaskDependencies` with a self-edge is silently dropped; a dependency that would form a cycle (A→B then B→A) → BadRequest.

```ts
it('setting COMPLETED forces percent=100 and writes an audit row', async () => {
  const t = await updateTask(ownerCtx, taskId, { status: 'COMPLETED' } as any, null);
  expect(t.percent).toBe(100);
  const a = await prisma.auditLog.findFirst({ where: { entityId: taskId, action: 'task.updated' } });
  expect(a).toBeTruthy();
});
it('rejects a dependency cycle', async () => {
  await setTaskDependencies(ownerCtx, taskB, { dependsOnTaskIds: [taskA] } as any, null); // B depends on A
  await expect(setTaskDependencies(ownerCtx, taskA, { dependsOnTaskIds: [taskB] } as any, null))
    .rejects.toThrow(/cycle/i); // A depends on B would close the loop
});
```

- [ ] **Step 2: Run → FAIL.** Implement the 5 methods. Run → PASS. typecheck clean.
- [ ] **Step 3: Implement/extend the routes** (PATCH+DELETE on `[id]/route.ts`; new progress/assignments/dependencies route files).
- [ ] **Step 4: Manual verify** detached dev server: get a token, create a task, `PATCH /tasks/:id/progress` `{"percent":100}` → 200 with status COMPLETED; kill server.
- [ ] **Step 5: Commit** `git add web/src/server/tasks web/src/app/api/v1/tasks && git commit -m "feat(web): tasks update/progress/delete/assignments/dependencies + routes"`

---

## Task 2.7: Comments — service + routes

**Files:**
- Create: `web/src/server/comments/comments.ts`, route `web/src/app/api/v1/tasks/[id]/comments/route.ts`
- Test: `web/src/server/comments/comments.test.ts`

**Port from:** `backend/src/comments/comments.service.ts` + controller. **Drop the `realtime.emit`.** Route segment is `[id]` (same as tasks) — NOT `[taskId]`.

**Interfaces:**
- `listComments(ctx, taskId): Promise<CommentDto[]>` — resolve `task.projectId` (`NotFound` if task missing) → `assertCan(ctx,'VIEW_PROJECT',projectId)`; comments `createdAt asc`.
- `addComment(ctx, taskId, body: string, ip): Promise<CommentDto>` — resolve projectId (`NotFound`) → `assertCan(ctx,'COMMENT_TASK',projectId)` (VIEWER denied); **sanitize** `body` (port the `sanitise()` function: strip `<script|iframe|object|embed|svg|style>` tags, strip ALL html tags, strip `javascript:|data:|vbscript:` protocols, trim); `authorId = ctx.userId`; audit `comment.created` with `after:{taskId}`; return `CommentDto`.
- `toCommentDto(row): CommentDto` — `{ id, taskId, authorId, body, createdAt: iso }`.

**Routes:** `GET /api/v1/tasks/[id]/comments`→listComments (200); `POST …`→addComment (201). POST parses `addCommentSchema` then passes `dto.body` to `addComment`.

- [ ] **Step 1: Write `comments.test.ts`** (integration): add a comment → returned `authorId` equals the caller; a VIEWER member → Forbidden; a body containing `<script>alert(1)</script>Hello` is sanitized (no `<script`, keeps `Hello`); listing a missing task → NotFound.

```ts
it('sanitizes script tags out of the comment body', async () => {
  const c = await addComment(ownerCtx, taskId, '<script>alert(1)</script>Hello', null);
  expect(c.body).not.toMatch(/<script/i);
  expect(c.body).toContain('Hello');
});
it('a VIEWER cannot comment (Forbidden)', async () => {
  await expect(addComment(viewerCtx, taskId, 'hi', null)).rejects.toThrow(/forbidden|cannot/i);
});
```

- [ ] **Step 2: Run → FAIL.** Implement `comments.ts` (port `sanitise` verbatim). Run → PASS. typecheck clean.
- [ ] **Step 3: Implement the route file** at `tasks/[id]/comments/route.ts`.
- [ ] **Step 4: Commit** `git add web/src/server/comments web/src/app/api/v1/tasks/[id]/comments && git commit -m "feat(web): comments service + routes (sanitization, VIEWER deny)"`

---

## Self-Review (done during authoring)

- **Spec coverage:** projects (2.1), config phases/workstreams (2.2), config statuses/priorities/categories (2.3), members (2.4), tasks list/get/mine/create+invariants (2.5), tasks mutate/assignments/dependencies (2.6), comments (2.7). Every backend controller route for these 5 modules maps to a route file. Serialization helper (2.0) is the shared prerequisite.
- **Placeholder scan:** the tasks are "port" tasks — each names the exact backend source file + the per-method invariants/RBAC/audit and the verbatim test code. The implementation "code" is a faithful port of a concrete, committed source file (not a stub); this is the legitimate port pattern, consistent with Phase 1. No "TBD"/"handle edge cases".
- **Type consistency:** `AuthContext`, `moneyToNumber`, `Paginated<T>`, `assertCan`, `auditRecord`, `getAuthContext`, `readJson`, `clientIp`, `route()` names are used identically across tasks and match Phase 1 exports. DTO/type names taken from the verified `@furama/shared` schema exports.
- **Routing hazards flagged:** `[id]` (never `[taskId]`) for the tasks segment so comments nest cleanly; literal `mine`/`reorder` folders precede dynamic `[id]`; statuses/priorities DELETE reads `replaceWithKey` from the query string.
- **Deviation from design spec:** vertical slices (service+routes per module) instead of P2(services)/P3(routes). Better DoD fit; record in `docs/CHANGELOG.md` at phase end.

## Known carry-ins from Phase 1 (already tracked)
- `readJson()` (400 on bad body) is in place — use it in every body-taking handler.
- Realtime is polling-only from Phase 5; this phase just omits the WS emits.
- OpenAPI is not yet updated for these paths (Phase 6 doc task).

## Follow-up (later plans)
- **Phase 3** — remaining modules: budget (summary + per-category actuals rollup), dashboard (overview aggregation), milestones (auto-gen from phases), import-export, ai assistant.
- **Phase 4** — App Router pages + full route tree + migrate `web/legacy/features` to TanStack Query (incl. task-detail intercepting route).
- **Phase 5** — polling realtime + notifications. **Phase 6** — parity check, delete `backend/`, update docs/openapi. **Phase 7** — Vercel + Neon deploy.
