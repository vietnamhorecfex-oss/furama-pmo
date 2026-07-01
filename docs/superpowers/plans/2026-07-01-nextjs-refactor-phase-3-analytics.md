# Next.js Refactor — Phase 3 (Analytics & IO: budget, dashboard, milestones, import-export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the computation/IO modules of the NestJS `backend/` into the Next.js app — budget summary + edits + import, dashboard overview aggregation, milestones (incl. gate status + generate-from-phases), and project import/export (packed-seed + JSON + CSV) — as server functions + REST route handlers, against the real Postgres DB with RBAC + audit intact.

**Architecture:** Same vertical-slice pattern as Phase 2 (service in `web/src/server/<module>/`, route handlers under `web/src/app/api/v1/**`, integration tests against native Postgres). Reuses all Phase-1/2 infrastructure (`assertCan`, `auditRecord`, `moneyToNumber`, `route`, `getAuthContext`, `readJson`, `clientIp`). WebSocket emits stay dropped. **AI/assistant + notifications are deferred to Phase 4** (largest module, depends on these four, and has streaming/timeout decisions of its own).

**Tech Stack:** Next.js 14 App Router route handlers, Prisma 5, zod (`@furama/shared`), Vitest integration.

## Global Constraints

- **The backend source is the line-level spec** for each port: `backend/src/budget/budget.service.ts`, `dashboard/dashboard.service.ts`, `milestones/milestones.service.ts`, `import-export/import-export.service.ts`. Mechanical transforms only (as in Phase 2): class→functions; `this.prisma`→`import { prisma } from '../prisma'`; Nest exceptions→`Forbidden/NotFound/BadRequest/Conflict` from `../http/errors`; `this.rbac.assertCan`→`assertCan` from `../rbac/rbac` (and `effectiveRole`/`leadOwnsWorkstream` where used); `this.audit.record`→`auditRecord`; injected sibling services (e.g. dashboard→budget)→direct function import.
- **AuthContext** `{ userId, orgId }` via `getAuthContext(req)` in every handler. `assertCan` enforces membership (no separate guard).
- **Money is `BigInt`.** Convert to Number via `moneyToNumber` at EVERY response boundary; write with `BigInt(...)`. Never let a raw BigInt reach `Response.json`. Fields: `Project.budgetCapVnd`, `BudgetCategory.plannedVnd`/`actualVnd`, `Task.budgetVnd`/`actualVnd`.
- **Route conventions:** body via `readJson(req)` + `<schema>.parse`; params via `await ctx.params` (ALWAYS await — Next 15 forward-compat, matches the Phase-2 capstone); query via `new URL(req.url).searchParams`; IP via `clientIp(req)`; wrap in `route(...)`. Use the `@/` alias.
- **Next.js routing:** the task segment is `[id]`; the milestone segment is `[id]`. Literal segments (`summary`, `cap`, `import`, `export`, `generate-from-phases`, `status`, `tasks.csv`) get their own folders and take precedence over any dynamic sibling. There is NO dynamic sibling under `budget/` or `milestones/…/generate-from-phases`, so no collisions — but keep each literal in its own folder.
- **CSV/JSON export:** no file library. `exportTasksCsv` returns a `string` served with `Content-Type: text/csv; charset=utf-8` (use `new NextResponse(csv, { headers })`, NOT `NextResponse.json`). `exportProject` returns a plain JS object → `NextResponse.json` (all money already `Number`).
- **Import is JSON, not a file upload.** `importPackedSeed` and `importBudget` receive already-parsed JSON DTOs; the client parses XLSX/CSV before POSTing.
- **Faithful-port of aggregation math** — do not "optimize" the semantics. In particular: budget `committedVnd = Σ Task.budgetVnd` per category; budget `actualVnd = BudgetCategory.actualVnd` (manually entered, NOT rolled from tasks); overrun = `committedVnd > plannedVnd * 1.1` (or planned=0 with any commitment); dashboard `atRisk = deadline∈[now,now+7d] AND status=NOT_STARTED`.
- **Tests** are Vitest integration against native Postgres `furama_pmo` (env auto-loaded). Seed via Prisma; prove happy path + one RBAC deny path per module. Task seeds use `status:'NOT_STARTED'|'COMPLETED'`, `priority:'MEDIUM'`, a unique `code` (suffix with a timestamp to avoid cross-run collisions), `WorkstreamTrack` ∈ `MARKETING|OPERATIONS|PMO`.
- **Performance carry-notes (do NOT block, just preserve + comment):** dashboard `overview` fans out ~18 queries — run the main aggregation and `budgetSummary` with `Promise.all` where the backend allows; import-export `importPackedSeed` row loop is sequential (perf risk on Vercel) — port faithfully and add a `// PERF (Phase 7): batch this loop; consider maxDuration` comment. OpenAPI is updated in Phase 6.
- No new `any`; DB access only in `web/src/server/**`; audit every mutation; ≥80% line / 75% branch per module.

---

## File Structure (created in this plan)

```
web/src/server/
  budget/budget.ts
  dashboard/dashboard.ts
  milestones/milestones.ts
  import-export/import-export.ts        # importPackedSeed + exportProject + exportTasksCsv
web/src/app/api/v1/
  projects/[projectId]/budget/summary/route.ts       # GET
  projects/[projectId]/budget/cap/route.ts           # PATCH
  projects/[projectId]/budget/categories/[categoryId]/route.ts  # PATCH
  projects/[projectId]/budget/import/route.ts        # POST
  projects/[projectId]/dashboard/route.ts            # GET
  projects/[projectId]/milestones/route.ts           # GET, POST
  projects/[projectId]/milestones/generate-from-phases/route.ts  # POST
  milestones/[id]/route.ts                            # GET, PATCH, DELETE
  milestones/[id]/status/route.ts                     # PATCH
  projects/[projectId]/import/route.ts               # POST
  projects/[projectId]/export/route.ts               # GET (JSON)
  projects/[projectId]/export/tasks.csv/route.ts     # GET (text/csv)
```

---

## Task 3.1: Budget — service + routes

**Files:**
- Create: `web/src/server/budget/budget.ts`; routes `budget/summary/route.ts`, `budget/cap/route.ts`, `budget/categories/[categoryId]/route.ts`, `budget/import/route.ts`
- Test: `web/src/server/budget/budget.test.ts`

**Port from:** `backend/src/budget/budget.service.ts` + `budget.controller.ts`.

**Interfaces (each `ctx` first):**
- `budgetSummary(ctx, projectId): Promise<BudgetSummary>` — `VIEW_PROJECT`; one `$transaction` of 5 reads (project, categories, `task.groupBy(budgetCategoryId)`, `task.groupBy(workstreamId)`, workstreams). Compute per-category `committedVnd = Σ Task.budgetVnd`, `actualVnd = category.actualVnd`, `utilization = committed/planned (0 if planned=0)`; the `__uncategorized__` bucket for null-category tasks with any spend; `overruns` = committed > planned*1.1 (or planned=0 & committed>0); `overCap = capVnd>0 && Σcommitted>capVnd`; `byWorkstream` totals. **All BigInt → moneyToNumber before return.**
- `setBudgetCap(ctx, projectId, capVnd: number, ip): Promise<BudgetSummary>` — `MANAGE_BUDGET`; NotFound if project missing; write `budgetCapVnd = BigInt(capVnd)`; audit `budget.capSet` (before/after cap); return `budgetSummary`.
- `setCategoryAmounts(ctx, projectId, categoryId, amounts: {plannedVnd?, actualVnd?}, ip): Promise<BudgetSummary>` — `MANAGE_BUDGET`; scoped `findFirst({id,projectId})` → NotFound; write provided fields with `BigInt(...)`; audit `budget.categorySet`; return `budgetSummary`.
- `importBudget(ctx, projectId, dto: BudgetImportDto, ip): Promise<BudgetImportResult>` — `MANAGE_BUDGET`; preload categories into `Map<name.toLowerCase()→id>`; per row: update `plannedVnd` on hit / create (`order = existing+i`) on miss; optional `capVnd` sets project cap; audit `budget.imported` with `{updated,created,capUpdated}`.

**Routes:** `GET budget/summary`(200); `PATCH budget/cap` body `setBudgetCapSchema`(200); `PATCH budget/categories/[categoryId]` body `updateCategoryAmountsSchema`(200); `POST budget/import` body `budgetImportSchema`(200).

- [ ] **Step 1: Write the failing integration test `budget.test.ts`** proving the computation, not just plumbing:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { budgetSummary, setBudgetCap, setCategoryAmounts } from './budget';

// seed org/user/OWNER-member/project + a category "Branding" planned=100, and a task with budgetVnd=120 in that category
// (full seed like Phase 2 tests; suffix codes with Date.now())

describe('budget summary', () => {
  it('committed = Σ task.budgetVnd; actual = category.actualVnd; flags overrun when committed > planned*1.1', async () => {
    await setCategoryAmounts(ownerCtx, pid, brandingId, { plannedVnd: 100, actualVnd: 30 }, null);
    const s = await budgetSummary(ownerCtx, pid);
    const brand = s.byCategory.find((c: any) => c.categoryId === brandingId)!;
    expect(brand.committedVnd).toBe(120);        // from the task
    expect(brand.actualVnd).toBe(30);            // manual, not rolled from tasks
    expect(typeof brand.plannedVnd).toBe('number');
    expect(s.overruns.find((o: any) => o.categoryId === brandingId)).toBeTruthy(); // 120 > 100*1.1
  });
  it('overCap true when Σcommitted exceeds a positive cap', async () => {
    await setBudgetCap(ownerCtx, pid, 50, null);
    const s = await budgetSummary(ownerCtx, pid);
    expect(s.overCap).toBe(true);
  });
  it('a VIEWER can read the summary but a LEAD cannot set the cap', async () => {
    await expect(setBudgetCap(leadCtx, pid, 10, null)).rejects.toThrow(/forbidden|cannot/i);
  });
});
```

- [ ] **Step 2: Run → FAIL** `npm run test -w @furama/web -- budget`.
- [ ] **Step 3: Implement `budget.ts`** — faithful port; every money field via `moneyToNumber`.
- [ ] **Step 4: Run → PASS.** typecheck clean.
- [ ] **Step 5: Implement the 4 route files.**
- [ ] **Step 6: Commit** `git add web/src/server/budget web/src/app/api/v1/projects/[projectId]/budget && git commit -m "feat(web): budget summary + cap/category edits + import + routes"`

---

## Task 3.2: Dashboard — service + route

**Files:**
- Create: `web/src/server/dashboard/dashboard.ts`; route `dashboard/route.ts`
- Test: `web/src/server/dashboard/dashboard.test.ts`

**Port from:** `backend/src/dashboard/dashboard.service.ts` + controller. Reuses `budgetSummary` from Task 3.1.

**Interfaces:**
- `dashboardOverview(ctx, projectId): Promise<DashboardOverview>` — `VIEW_PROJECT`. Compute `now` ONCE at the top. Run the 13-query aggregation in a `$transaction` (task count; groupBy status; groupBy priority; overdue count `deadline<now && status!=COMPLETED`; atRisk count `deadline∈[now,now+7d] && status=NOT_STARTED`; avg percent; groupBy phaseId total; groupBy phaseId completed; groupBy workstreamId total; groupBy workstreamId completed; phases ordered; workstreams ordered; upcoming `deadline∈[now,now+14d]` take 12 select `{id,code,title,deadline,status}`). Build `byPhase[]`/`byWorkstream[]` progress groups (join completed/total; append the `id:null` "Unassigned" bucket if it has tasks). `upcomingDeadlines` with `daysLeft = ceil((deadline-now)/86400000)`. `daysToOpening = project.openingDate ? ceil((opening-now)/86400000) : null`. Then call `budgetSummary(ctx, projectId)` — run it via `Promise.all` with the main `$transaction` (both only read). Return the composed `DashboardOverview` (money already Number via budget's mapper). No audit.

- [ ] **Step 1: Write the failing test `dashboard.test.ts`** — seed a project with: 2 tasks in phase A (1 COMPLETED, 1 NOT_STARTED with deadline in 3 days), 1 overdue task (deadline yesterday, not completed). Assert: `byPhase` for phase A has `total=2, completed=1`; `overdue>=1`; the near-deadline NOT_STARTED task appears in `atRisk` count and in `upcomingDeadlines` (by code); `overallPercent` is the avg; a non-member is Forbidden.

```ts
it('aggregates phase progress, overdue, atRisk, and upcoming deadlines', async () => {
  const o = await dashboardOverview(ownerCtx, pid);
  const phase = o.byPhase.find((g: any) => g.id === phaseAId)!;
  expect(phase.total).toBe(2); expect(phase.completed).toBe(1);
  expect(o.overdue).toBeGreaterThanOrEqual(1);
  expect(o.upcomingDeadlines.map((u: any) => u.code)).toContain(nearTaskCode);
});
it('denies a non-member (Forbidden)', async () => {
  await expect(dashboardOverview({ userId: outsiderId, orgId }, pid)).rejects.toThrow(/member|forbidden/i);
});
```

- [ ] **Step 2: Run → FAIL.** Implement `dashboard.ts` (faithful; `Promise.all` for main-tx + budgetSummary). Run → PASS. typecheck clean.
- [ ] **Step 3: Implement `dashboard/route.ts`** (GET, 200).
- [ ] **Step 4: Commit** `git add web/src/server/dashboard web/src/app/api/v1/projects/[projectId]/dashboard && git commit -m "feat(web): dashboard overview aggregation + route"`

---

## Task 3.3: Milestones — service + routes (incl. gate status + generate-from-phases)

**Files:**
- Create: `web/src/server/milestones/milestones.ts`; routes `projects/[projectId]/milestones/route.ts`, `projects/[projectId]/milestones/generate-from-phases/route.ts`, `milestones/[id]/route.ts`, `milestones/[id]/status/route.ts`
- Test: `web/src/server/milestones/milestones.test.ts`

**Port from:** `backend/src/milestones/milestones.service.ts` + controller (two controllers).

**Interfaces:**
- `listMilestones(ctx, projectId): Promise<MilestoneDto[]>` — `VIEW_PROJECT`; order `[date asc, name asc]`; `hydrate` each (readiness). **Port faithfully, but batch the hydrate**: instead of N×2 queries, compute completion via a single `task.groupBy` over all referenced taskIds — or keep the per-milestone hydrate if simpler, with a `// PERF` note. Either way the DTO fields (`readinessPct|null`, `completedCount|null`, `totalCount|null`) must match.
- `getMilestone(ctx, milestoneId): Promise<MilestoneDto>` — fetch → `assertCan('VIEW_PROJECT', m.projectId)`; hydrate; NotFound.
- `createMilestone(ctx, projectId, dto: CreateMilestoneDto, ip): Promise<MilestoneDto>` — `MANAGE_MILESTONE`; validate `criteria.taskIds` all in project (else BadRequest); store `criteria` as `Prisma.JsonNull` when absent; audit `milestone.created`.
- `generateFromPhases(ctx, projectId, ip): Promise<GenerateMilestonesResult>` — `MANAGE_MILESTONE`; `Promise.all`(phases, tasks with phaseId, existing milestones); group tasks by phase (track maxDeadline); idempotent upsert by `name.toLowerCase()` (`idByName` map); skip empty phases; `criteria.taskIds` capped at 200; audit `milestone.generatedFromPhases` `{created,updated,total}`.
- `updateMilestone(ctx, milestoneId, dto: UpdateMilestoneDto, ip): Promise<MilestoneDto>` — `MANAGE_MILESTONE` on `before.projectId`; re-validate criteria scope if provided; audit `milestone.updated`.
- `setMilestoneStatus(ctx, milestoneId, dto: SetMilestoneStatusDto, ip): Promise<MilestoneDto>` — **the gate.** Does NOT use `assertCan`. Uses `effectiveRole(ctx.userId, before.projectId)`: OWNER/PM allowed; LEAD → `assertLeadScopeCoversCriteria` (every `criteria.taskIds` task's workstream must be one the LEAD owns via `leadOwnsWorkstream`; LEAD with no taskIds or a foreign workstream → Forbidden); MEMBER/VIEWER → Forbidden. Audit `milestone.status` (before/after status).
- `deleteMilestone(ctx, milestoneId, ip): Promise<void>` — `MANAGE_MILESTONE`; audit `milestone.deleted`.
- Port helpers `hydrate`, `validateCriteriaProjectScope`, `assertLeadScopeCoversCriteria` as private functions.

**Routes:** `GET/POST projects/[projectId]/milestones` (200/201); `POST .../generate-from-phases` (200); `GET/PATCH/DELETE milestones/[id]` (200/200/204); `PATCH milestones/[id]/status` (200). `[id]` routes have no `:projectId` — resolve project from the milestone.

- [ ] **Step 1: Write the failing test `milestones.test.ts`** — the load-bearing case is the GATE. Seed: project, OWNER, a LEAD owning workstream A, tasks tA (in A) and tB (in B), a GATE milestone whose `criteria.taskIds=[tA,tB]`. Assert: OWNER can `setMilestoneStatus PASSED`; the LEAD (owns only A, gate spans B) is **Forbidden**; a second gate with criteria=[tA] only → the LEAD **can** pass it. Plus: `generateFromPhases` twice is idempotent (2nd run `created=0`); create with a foreign taskId → BadRequest.

```ts
it('gate: OWNER can set status; LEAD is denied when the gate spans a workstream they do not own', async () => {
  await expect(setMilestoneStatus(ownerCtx, gateAllId, { status: 'PASSED' } as any, null)).resolves.toBeTruthy();
  await expect(setMilestoneStatus(leadCtx, gateAllId, { status: 'PASSED' } as any, null)).rejects.toThrow(/forbidden|scope|cannot/i);
  await expect(setMilestoneStatus(leadCtx, gateOwnId, { status: 'PASSED' } as any, null)).resolves.toBeTruthy();
});
it('generateFromPhases is idempotent by name', async () => {
  const first = await generateFromPhases(ownerCtx, pid, null);
  const second = await generateFromPhases(ownerCtx, pid, null);
  expect(second.created).toBe(0);
});
```

- [ ] **Step 2: Run → FAIL.** Implement `milestones.ts`. Run → PASS. typecheck clean.
- [ ] **Step 3: Implement the 4 route files.**
- [ ] **Step 4: Commit** `git add web/src/server/milestones web/src/app/api/v1/projects/[projectId]/milestones web/src/app/api/v1/milestones && git commit -m "feat(web): milestones service + routes (gate status, generate-from-phases)"`

---

## Task 3.4: Import-Export — service + routes

**Files:**
- Create: `web/src/server/import-export/import-export.ts`; routes `projects/[projectId]/import/route.ts`, `projects/[projectId]/export/route.ts`, `projects/[projectId]/export/tasks.csv/route.ts`
- Test: `web/src/server/import-export/import-export.test.ts`

**Port from:** `backend/src/import-export/import-export.service.ts` + controller.

**Interfaces:**
- `importPackedSeed(ctx, projectId, raw: unknown, ip): Promise<ImportResult>` — `IMPORT_EXPORT`; `packedSeedSchema.safeParse(raw)` (BadRequest on failure). **Pre-pass:** derive `categoryBudget` (Map name→Σ budgetVnd bigint), rank by descending budget, upsert `BudgetCategory` by `(projectId,name)`, set `Project.budgetCapVnd = Σ`. **Row loop** (sequential — keep + `// PERF (Phase 7)` note): resolve/create Workstream by track (`PMO→PMO, MKT→MARKETING, OPS→OPERATIONS`, cached), resolve/create Phase by name (cached); upsert Task by `findFirst({projectId,code})`→update|create; replace TaskAssignment rows (delete-all + createMany, IN_CHARGE/SUPPORT/APPROVER; label→userId via `memberLabelCache`, may be null); status/priority mapped case-insensitively (unknowns→NOT_STARTED/MEDIUM, collected into sets for the result); `status==='COMPLETED'`⇒percent=100; money via `parseMoney` (`BigInt(Math.trunc(Number(v)))`, 0n for negative/non-finite). Audit `import.packedSeed` with the full `ImportResult`. Idempotent (re-import → same task count). Define the `ImportResult` type in this module (it's not in `shared`).
- `exportProject(ctx, projectId): Promise<object>` — `IMPORT_EXPORT`; full snapshot (project, phases, workstreams, statusDefs, priorityDefs, budgetCategories, members, tasks+assignments+dependencies); ALL money → `moneyToNumber`.
- `exportTasksCsv(ctx, projectId): Promise<string>` — `IMPORT_EXPORT`; 12-col CSV string (`code,title,phase,workstream,status,priority,percent,startDate,deadline,budgetVnd,actualVnd,inCharge`); port the hand-rolled `csv()` escaper (quote if field contains `,`/`"`/newline; money as plain numbers).

**Routes:** `POST projects/[projectId]/import` body raw JSON (pass `await readJson(req)` straight to `importPackedSeed`, which does its own safeParse), 200; `GET .../export` → `NextResponse.json(await exportProject(...))`, 200; `GET .../export/tasks.csv` → `new NextResponse(csv, { status:200, headers: { 'content-type':'text/csv; charset=utf-8', 'content-disposition':'attachment; filename="tasks.csv"' } })`.

- [ ] **Step 1: Write the failing test `import-export.test.ts`** — seed a project (OWNER). Build a small packed seed `{ cols:['code','title','phase','workstream','status','budgetVnd'], rows:[['MKT-0001','Launch','Marketing','MKT','COMPLETED', 500],[ 'OPS-0001','Setup','Ops','OPS','NOT_STARTED', 300]] }`. Assert: import returns `{inserted:2,...}`; re-import returns the SAME task count (idempotent, `updated:2`); a Marketing workstream + phases were created; the COMPLETED task has `percent=100`; `Project.budgetCapVnd = 800`. Then `exportTasksCsv` contains the two codes and starts with the 12-column header. A VIEWER member → Forbidden on import.

```ts
it('imports rows idempotently, forces percent=100 on COMPLETED, and sets the cap from Σ budget', async () => {
  const r1 = await importPackedSeed(ownerCtx, pid, seed, null);
  expect(r1.inserted).toBe(2);
  const r2 = await importPackedSeed(ownerCtx, pid, seed, null);
  expect(r2.updated).toBe(2); expect(r2.inserted).toBe(0);       // idempotent by code
  const t = await prisma.task.findFirst({ where: { projectId: pid, code: 'MKT-0001' } });
  expect(t?.percent).toBe(100);
  const p = await prisma.project.findUnique({ where: { id: pid } });
  expect(Number(p!.budgetCapVnd)).toBe(800);
});
it('a VIEWER cannot import (Forbidden)', async () => {
  await expect(importPackedSeed(viewerCtx, pid, seed, null)).rejects.toThrow(/forbidden|cannot/i);
});
```

- [ ] **Step 2: Run → FAIL.** Implement `import-export.ts` (faithful; keep the sequential loop with the PERF comment). Run → PASS. typecheck clean.
- [ ] **Step 3: Implement the 3 route files** (note the literal `tasks.csv` folder + the text/csv response).
- [ ] **Step 4: Commit** `git add web/src/server/import-export web/src/app/api/v1/projects/[projectId]/import web/src/app/api/v1/projects/[projectId]/export && git commit -m "feat(web): import packed-seed + export JSON/CSV + routes"`

---

## Self-Review (done during authoring)

- **Spec coverage:** budget (3.1: summary + cap + category + import), dashboard (3.2), milestones (3.3: list/get/create/generate/update/**gate status**/delete), import-export (3.4: packed-seed + JSON + CSV). AI/notifications explicitly deferred to Phase 4.
- **Placeholders:** port tasks name the exact backend source + per-method behaviors + verbatim tests. No stubs.
- **Type consistency:** `budgetSummary`, `dashboardOverview`, `moneyToNumber`, `assertCan`, `effectiveRole`, `leadOwnsWorkstream`, `auditRecord`, route helpers — all reused from Phase 1/2 with the same names. DTO names from verified `@furama/shared` exports; `ImportResult` defined locally (not in shared).
- **Routing hazards:** literal segments (`summary`/`cap`/`import`/`export`/`tasks.csv`/`generate-from-phases`/`status`) each own a folder; `[id]` for the milestone segment; CSV served as text (not JSON).
- **Deviation from design spec:** AI moved out of Phase 3 into its own Phase 4 (size + streaming/timeout decisions). Record in `docs/CHANGELOG.md` at phase end.

## Known carry-notes (do not block; hand to the final review / Phase 7)
- Dashboard ~18 queries/request and import-export sequential row loop → Vercel `maxDuration` + batching in Phase 7.
- `listProjects` orgId cross-tenant test (M7 carry-in from Phase 2).
- OpenAPI paths for all these routes added in Phase 6.

## Follow-up (later plans)
- **Phase 4** — AI assistant (chat tool-use loop, 13 tools, action propose/confirm/reject) + notifications + knowledge search; decide streaming vs blocking + `maxDuration`.
- **Phase 5** — App Router pages + full route tree + migrate `web/legacy/features` to TanStack Query + polling realtime.
- **Phase 6** — parity check, delete `backend/`, update docs/openapi. **Phase 7** — Vercel + Neon deploy + perf hardening.
