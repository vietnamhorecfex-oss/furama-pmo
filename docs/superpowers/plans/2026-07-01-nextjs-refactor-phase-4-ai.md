# Phase 4 — AI Assistant + Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the M8 AI assistant (Claude tool-use loop with propose/confirm/reject write actions), in-app notifications, and knowledge search from NestJS (`backend/src/ai/`) to the Next.js server layer (`web/src/server/ai/` + route handlers), faithfully preserving RBAC, prompt-injection safety, and the blocking request model.

**Architecture:** A single blocking `chat()` function drives a bounded (≤6 iteration) Anthropic tool-use loop. Read tools dispatch immediately against the already-ported domain services; write tools are intercepted into `AiActionLog(PROPOSED)` rows and only mutate on an explicit `POST /ai/actions/:id/confirm`. The Anthropic client is obtained from env (`ANTHROPIC_API_KEY`) via a mockable seam so tests never hit the network. Route handlers are thin (`route()` wrapper + `getAuthContext` + zod parse), and the chat route carries `export const maxDuration = 60` for Vercel.

**Tech Stack:** Next.js 14 App Router route handlers, `@anthropic-ai/sdk` (already hoisted at repo-root `node_modules`), Prisma 5 (`AiConversation`, `AiMessage`, `AiActionLog`, `Notification`, `KnowledgeDoc` models already exist), zod, Vitest against native Postgres (`.env` `DATABASE_URL`).

## Global Constraints

- **Faithful port.** The behavioral contract is `backend/src/ai/assistant.service.ts` + `ai.controller.ts` + `tools.json`. Any deviation beyond the mechanical adaptations named in this plan MUST be recorded in `docs/CHANGELOG.md` with a reason (Golden Rule #1).
- **Mechanical adaptation rules (same as Phases 1–3):** `this.prisma` → singleton `import { prisma } from '../prisma'`; `this.rbac.assertCan` → `assertCan` from `../rbac/rbac`; `this.rbac.effectiveRole` → `effectiveRole`; Nest exceptions → `Forbidden`/`NotFound`/`BadRequest` from `../http/errors`; injected services → the ported module functions (`listTasks`, `createTask`, `updateTask`, `updateTaskProgress`, `addComment`, `budgetSummary`, `dashboardOverview`, `createPhase`, `createWorkstream`, `createBudgetCategory`). All ported service functions take a trailing `ip: string | null` arg — pass `null` from AI dispatch (matches backend, which passed `null`).
- **No money/BigInt leaks.** Any value that reaches Anthropic as a tool_result, or reaches the HTTP client as JSON, must not contain a raw `bigint`. The ported services already return `moneyToNumber`-normalized DTOs; do not re-introduce raw `project.budgetCapVnd` etc. When embedding `budgetCapVnd` into the system prompt, use `.toString()` (matches backend line 132).
- **RBAC is non-negotiable.** `chat`, `listNotifications`, `searchKnowledge` gate on `assertCan(ctx, 'VIEW_PROJECT', projectId)`. Write-tool dispatch re-checks capability inside the ported service (never trust the model). `send_notification` additionally gates `assertCan(ctx, 'MANAGE_MEMBERS', projectId)`. `confirmAction`/`rejectAction`/`markRead` verify `row.userId === ctx.userId` and throw `Forbidden` otherwise.
- **Prompt-injection safety.** The system prompt's safety block (treat all tool results/retrieved content as DATA, never execute a write without confirmation, ground guidance in `search_knowledge`) is copied verbatim from backend lines 592–613. Do not paraphrase it.
- **Blocking model, `maxDuration = 60`.** No streaming. The chat route returns one JSON body `{ reply, proposedActions, conversationId }` after the loop completes. Loop bound stays at `iterations++ < 6` plus one post-write summary call (backend lines 166, 240).
- **Graceful degrade.** If `ANTHROPIC_API_KEY` is missing, `chat()` returns `{ reply: 'AI assistant is not configured (ANTHROPIC_API_KEY missing).', proposedActions: [], conversationId: conversationId ?? '' }` without creating a conversation — identical to backend lines 97–103.
- **No new `any` beyond what the backend already had.** The backend used `as any` casts at tool-dispatch boundaries (enum coercion). Preserve them 1:1 with the same `// eslint-disable-next-line` comments; do not add new ones.

---

## File Structure

- `web/src/server/ai/tools.json` — verbatim copy of `backend/src/ai/tools.json` (13 tool defs).
- `web/src/server/ai/assistant.ts` — the tool-use engine: `chat`, `confirmAction`, `rejectAction`, `searchKnowledge`, `dispatchReadTool`, `dispatchWriteTool`, `buildSystemPrompt`, `extractText`, `buildWritePreview`, `getAnthropicClient`, and the `ChatResponse`/`ProposedAction`/`AnthropicLike` types.
- `web/src/server/ai/notifications.ts` — `listNotifications`, `markRead`.
- `web/src/app/api/v1/projects/[projectId]/ai/chat/route.ts` — `POST` chat, `maxDuration = 60`.
- `web/src/app/api/v1/ai/actions/[id]/confirm/route.ts` — `POST` confirm.
- `web/src/app/api/v1/ai/actions/[id]/reject/route.ts` — `POST` reject (204).
- `web/src/app/api/v1/projects/[projectId]/notifications/route.ts` — `GET` list.
- `web/src/app/api/v1/notifications/[id]/read/route.ts` — `POST` mark read (204).
- Tests: `web/src/server/ai/assistant.test.ts`, `web/src/server/ai/notifications.test.ts`.

---

## Task 4.1: AI engine — `assistant.ts` (chat loop + tool dispatch + confirm/reject + knowledge)

**Files:**
- Create: `web/src/server/ai/tools.json`
- Create: `web/src/server/ai/assistant.ts`
- Test: `web/src/server/ai/assistant.test.ts`

**Interfaces:**
- Consumes (from earlier phases, exact signatures):
  - `assertCan(ctx: AuthContext, capability: Capability, projectId: string, scope?: ScopeHints): Promise<void>` and `effectiveRole(userId, projectId): Promise<MemberRole|null>` from `../rbac/rbac`.
  - `Forbidden`, `NotFound` from `../http/errors`.
  - `prisma` from `../prisma`; `auditRecord` — check the exact export name in `../audit/audit` (Phase 1 named it; use whatever `web/src/server/audit/audit.ts` exports — do NOT invent `AuditService`).
  - Domain services: `listTasks(ctx, projectId, query)`, `createTask(ctx, projectId, dto, ip)`, `updateTask(ctx, taskId, dto, ip)`, `updateTaskProgress(ctx, taskId, dto, ip)` from `../tasks/tasks`; `addComment(ctx, taskId, body, ip)` from `../comments/comments`; `budgetSummary(ctx, projectId)` from `../budget/budget`; `dashboardOverview(ctx, projectId)` from `../dashboard/dashboard`; `createPhase(ctx, projectId, dto, ip)` from `../config/phases`, `createWorkstream(...)` from `../config/workstreams`, `createBudgetCategory(...)` from `../config/categories`.
- Produces (Task 4.2 relies on these exact names/types):
  - `chat(ctx: AuthContext, projectId: string, userMessage: string, conversationId?: string, deps?: { client?: AnthropicLike | null }): Promise<ChatResponse>`
  - `confirmAction(ctx: AuthContext, actionId: string): Promise<{ message: string }>`
  - `rejectAction(ctx: AuthContext, actionId: string): Promise<void>`
  - `searchKnowledge(ctx: AuthContext, projectId: string, query: string, topK?: number): Promise<{ id: string; title: string; source: string | null; excerpt: string }[]>`
  - `interface ChatResponse { reply: string; proposedActions: ProposedAction[]; conversationId: string }`
  - `interface ProposedAction { actionId: string; tool: string; preview: unknown; args: unknown }`

**Port source:** `backend/src/ai/assistant.service.ts` lines 46–614. Transcribe it into module functions applying the Global-Constraints adaptation rules. The paragraphs below specify only the parts that differ from a straight `this.x → x` rename.

**The Anthropic client seam (replaces constructor injection):**

```ts
import Anthropic from '@anthropic-ai/sdk';

// Minimal surface the loop uses — lets tests inject a scripted client without the network.
export interface AnthropicLike {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export function getAnthropicClient(): AnthropicLike | null {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new Anthropic({ apiKey: key }) : null;
}
```

`chat()` resolves its client as `const anthropic = deps?.client !== undefined ? deps.client : getAnthropicClient();` at the top, then follows backend lines 95–277 exactly (RBAC gate → null-client graceful return → resolve/create conversation → load project + membership → `buildSystemPrompt` → load prev messages → save user message → tool-use loop → save assistant reply → `auditRecord` → return). Every `this.anthropic` becomes `anthropic`. Every `this.dispatchReadTool`/`this.dispatchWriteTool` becomes the module function. `this.prisma` → `prisma`. `this.rbac.assertCan` → `assertCan`. `this.audit.record(a, b)` → the ported audit function with the same two args (match the ported signature — Phase 1 tasks used it; copy a call site from `web/src/server/tasks/tasks.ts`).

**Date handling note:** the backend calls `new Date()` (line 126, 423, 497). Keep `new Date()` in `assistant.ts` — this is server runtime code, NOT a workflow script; `new Date()` is fully available here. (The Date restriction only applies to Workflow-tool scripts, not application code.)

**`dispatchReadTool` / `dispatchWriteTool`:** transcribe backend lines 371–563 verbatim with service-name substitutions: `this.tasks.list` → `listTasks`, `this.tasks.updateProgress` → `updateTaskProgress`, `this.tasks.update` → `updateTask`, `this.tasks.create` → `createTask`, `this.comments.add` → `addComment`, `this.budget.summary` → `budgetSummary`, `this.dashboard.overview` → `dashboardOverview`, `this.configDim.createPhase` → `createPhase`, `this.configDim.createWorkstream` → `createWorkstream`, `this.configDim.createBudgetCategory` → `createBudgetCategory`, `this.searchKnowledge` → `searchKnowledge`, `this.rbac.effectiveRole` → `effectiveRole`, `this.rbac.assertCan` → `assertCan`. Preserve the exact `as any`/`as Parameters<...>` casts and their eslint-disable comments (backend lines 393, 400, 454, 465, 478, 500, 514, 530, 551). The `logger.error` calls (backend lines 440) → `console.error('[ai] tool dispatch error', tool, err)`.

**Helpers (`extractText`, `buildWritePreview`, `buildSystemPrompt`):** copy verbatim from backend lines 568–614. The system-prompt safety block is a Global Constraint — do not alter wording.

- [ ] **Step 1: Copy tools.json**

```bash
cp backend/src/ai/tools.json web/src/server/ai/tools.json
```

Then verify it is valid JSON and unchanged:

```bash
node -e "const t=require('./web/src/server/ai/tools.json'); if(t.tools.length!==13) throw new Error('expected 13 tools, got '+t.tools.length); console.log('tools.json OK', t.tools.length)"
```

Expected: `tools.json OK 13`

- [ ] **Step 2: Write the failing test** (`web/src/server/ai/assistant.test.ts`)

The test injects a scripted `AnthropicLike` so no network call happens. It creates an org/OWNER/VIEWER/project via Prisma (copy the `beforeAll` shape from `web/src/server/budget/budget.test.ts`), plus one `Task`, one `Phase`, one `Workstream`, and one `KnowledgeDoc`. Full test file:

```ts
/**
 * Integration tests for the AI assistant engine (Task 4.1).
 * The Anthropic client is injected (deps.client) — no network calls.
 * TDD: RED before assistant.ts exists.
 *
 * Covers:
 *  - unconfigured client → graceful message, no conversation created
 *  - read tool (search_tasks) dispatches and returns data to the model
 *  - write tool (update_task_progress) is intercepted → AiActionLog(PROPOSED), NOT executed
 *  - confirmAction executes the staged write and flips status to EXECUTED
 *  - confirming someone else's action → Forbidden
 *  - rejectAction flips status to REJECTED without mutating
 *  - VIEW_PROJECT denied (non-member) → Forbidden from chat
 *  - searchKnowledge returns excerpts, respects topK
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../prisma';
import {
  chat,
  confirmAction,
  rejectAction,
  searchKnowledge,
  type AnthropicLike,
} from './assistant';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerCtx: AuthContext;
let strangerCtx: AuthContext;
let pid: string;
let taskId: string;

// Build a scripted client: `steps` is a queue of Anthropic-shaped responses.
function scriptedClient(steps: any[]): AnthropicLike {
  let i = 0;
  return {
    messages: {
      create: async () => {
        const step = steps[Math.min(i, steps.length - 1)];
        i += 1;
        return step;
      },
    },
  };
}

beforeAll(async () => {
  const ts = Date.now();
  const org = await prisma.organization.create({ data: { slug: `ai-${ts}`, name: 'AiOrg' } });
  orgId = org.id;

  const owner = await prisma.user.create({
    data: { orgId, name: 'Owner', email: `ai-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
  });
  const stranger = await prisma.user.create({
    data: { orgId, name: 'Stranger', email: `ai-str-${ts}@x.test`, passwordHash: 'x', isActive: true },
  });
  ownerCtx = { userId: owner.id, orgId };
  strangerCtx = { userId: stranger.id, orgId };

  const project = await prisma.project.create({
    data: { orgId, name: `AiProject-${ts}`, budgetCapVnd: BigInt(0), createdById: owner.id },
  });
  pid = project.id;
  await prisma.projectMember.create({ data: { projectId: pid, userId: owner.id, role: 'OWNER' } });

  const phase = await prisma.phase.create({ data: { projectId: pid, name: 'Exec', order: 1 } });
  const ws = await prisma.workstream.create({ data: { projectId: pid, name: 'Ops', track: 'EXE', order: 1 } });
  const task = await prisma.task.create({
    data: {
      projectId: pid, phaseId: phase.id, workstreamId: ws.id,
      code: `T-${ts}`, title: 'Install PBX', status: 'NOT_STARTED', percent: 0,
    },
  });
  taskId = task.id;

  await prisma.knowledgeDoc.create({
    data: { projectId: pid, title: 'Check-in SOP', source: 'playbook', content: 'The front desk greeting procedure is: welcome the guest warmly.' },
  });
});

describe('chat', () => {
  it('returns graceful message and creates no conversation when client is null', async () => {
    const before = await prisma.aiConversation.count({ where: { projectId: pid } });
    const res = await chat(ownerCtx, pid, 'hi', undefined, { client: null });
    expect(res.reply).toContain('not configured');
    expect(res.proposedActions).toEqual([]);
    const after = await prisma.aiConversation.count({ where: { projectId: pid } });
    expect(after).toBe(before);
  });

  it('denies a non-member (VIEW_PROJECT) with Forbidden', async () => {
    await expect(
      chat(strangerCtx, pid, 'hi', undefined, { client: scriptedClient([]) }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('dispatches a read tool then returns the model final reply', async () => {
    const client = scriptedClient([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'tu1', name: 'search_tasks', input: { q: 'PBX' } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'You have 1 task: Install PBX.' }] },
    ]);
    const res = await chat(ownerCtx, pid, 'what tasks do I have', undefined, { client });
    expect(res.reply).toContain('Install PBX');
    expect(res.proposedActions).toEqual([]);
    expect(res.conversationId).toBeTruthy();
  });

  it('intercepts a write tool into a PROPOSED action without mutating', async () => {
    const client = scriptedClient([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu2', name: 'update_task_progress', input: { taskId, status: 'COMPLETED' } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I have staged marking it complete — please confirm.' }] },
    ]);
    const res = await chat(ownerCtx, pid, 'mark PBX done', undefined, { client });
    expect(res.proposedActions).toHaveLength(1);
    expect(res.proposedActions[0]!.tool).toBe('update_task_progress');
    const staged = await prisma.aiActionLog.findUnique({ where: { id: res.proposedActions[0]!.actionId } });
    expect(staged!.status).toBe('PROPOSED');
    // task is NOT mutated yet
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    expect(task!.status).toBe('NOT_STARTED');
  });
});

describe('confirm / reject', () => {
  async function stageAction(): Promise<string> {
    const client = scriptedClient([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu', name: 'update_task_progress', input: { taskId, status: 'COMPLETED' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'confirm?' }] },
    ]);
    const res = await chat(ownerCtx, pid, 'mark done', undefined, { client });
    return res.proposedActions[0]!.actionId;
  }

  it('confirmAction executes the staged write (task → COMPLETED, status EXECUTED)', async () => {
    const actionId = await stageAction();
    const out = await confirmAction(ownerCtx, actionId);
    expect(out.message).toContain('executed');
    const staged = await prisma.aiActionLog.findUnique({ where: { id: actionId } });
    expect(staged!.status).toBe('EXECUTED');
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    expect(task!.status).toBe('COMPLETED');
    expect(task!.percent).toBe(100); // invariant applied by updateTaskProgress
  });

  it('rejects confirming another user\'s action with Forbidden', async () => {
    const actionId = await stageAction();
    await expect(confirmAction(strangerCtx, actionId)).rejects.toMatchObject({ status: 403 });
  });

  it('rejectAction flips to REJECTED without mutating', async () => {
    // reset task first
    await prisma.task.update({ where: { id: taskId }, data: { status: 'NOT_STARTED', percent: 0 } });
    const actionId = await stageAction();
    await rejectAction(ownerCtx, actionId);
    const staged = await prisma.aiActionLog.findUnique({ where: { id: actionId } });
    expect(staged!.status).toBe('REJECTED');
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    expect(task!.status).toBe('NOT_STARTED');
  });
});

describe('searchKnowledge', () => {
  it('returns matching excerpts and respects topK', async () => {
    const hits = await searchKnowledge(ownerCtx, pid, 'greeting', 4);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.title).toBe('Check-in SOP');
    expect(hits[0]!.excerpt.length).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run src/server/ai/assistant.test.ts`
Expected: FAIL — `Cannot find module './assistant'` (or all cases red).

- [ ] **Step 4: Implement `assistant.ts`**

Transcribe `backend/src/ai/assistant.service.ts` per the port rules above. Key structural notes:
- Module-level: `import toolsJson from './tools.json';` (verify `tsconfig` has `resolveJsonModule` — the ported `config.ts`/others may already import JSON; if not, add `"resolveJsonModule": true` to `web/tsconfig.json` `compilerOptions` as part of this task). Build `const TOOLS = ...` and `const WRITE_TOOLS = ...` exactly as backend lines 36–44.
- `chat()` signature includes the `deps?: { client?: AnthropicLike | null }` param; resolve `const anthropic = deps?.client !== undefined ? deps.client : getAnthropicClient();`.
- Type the loop messages/response with the SDK types (`Anthropic.MessageParam`, `Anthropic.Message`, `Anthropic.ToolResultBlockParam`, `Anthropic.ContentBlock`) exactly as backend.
- Everything else 1:1 with the backend.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/server/ai/assistant.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/server/ai/tools.json web/src/server/ai/assistant.ts web/src/server/ai/assistant.test.ts web/tsconfig.json
git commit -m "feat(ai): port assistant tool-use engine to Next.js server layer"
```

---

## Task 4.2: Chat + action routes (`ai/chat`, `ai/actions/[id]/confirm|reject`)

**Files:**
- Create: `web/src/app/api/v1/projects/[projectId]/ai/chat/route.ts`
- Create: `web/src/app/api/v1/ai/actions/[id]/confirm/route.ts`
- Create: `web/src/app/api/v1/ai/actions/[id]/reject/route.ts`
- Test: append route-level cases to `web/src/server/ai/assistant.test.ts` is NOT required; instead add `web/src/server/ai/routes.test.ts` only if you can import handlers without a running server (see Step 2). If direct handler invocation is impractical, the engine tests in 4.1 are the coverage gate and this task's deliverable is verified by typecheck + a manual curl note in the report.

**Interfaces:**
- Consumes: `chat`, `confirmAction`, `rejectAction` from `@/server/ai/assistant`; `route` from `@/server/http/envelope`; `getAuthContext` from `@/server/auth/session`; `readJson` from `@/server/http/request`.
- Produces: HTTP routes matching backend `ai.controller.ts` — `POST /projects/:projectId/ai/chat` (200, `{reply, proposedActions, conversationId}`), `POST /ai/actions/:id/confirm` (200, `{message}`), `POST /ai/actions/:id/reject` (204).

**Chat request schema (inline, matches backend lines 26–29):**

```ts
const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
}).strict();
```

- [ ] **Step 1: Write chat route** (`web/src/app/api/v1/projects/[projectId]/ai/chat/route.ts`)

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { readJson } from '@/server/http/request';
import { chat } from '@/server/ai/assistant';

export const maxDuration = 60;

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
}).strict();

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = chatSchema.parse(await readJson(req));
  return NextResponse.json(
    await chat(auth, projectId, dto.message, dto.conversationId),
    { status: 200 },
  );
});
```

- [ ] **Step 2: Write confirm route** (`web/src/app/api/v1/ai/actions/[id]/confirm/route.ts`)

```ts
import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { confirmAction } from '@/server/ai/assistant';

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  return NextResponse.json(await confirmAction(auth, id), { status: 200 });
});
```

- [ ] **Step 3: Write reject route** (`web/src/app/api/v1/ai/actions/[id]/reject/route.ts`)

```ts
import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { rejectAction } from '@/server/ai/assistant';

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  await rejectAction(auth, id);
  return new NextResponse(null, { status: 204 });
});
```

Match the 204 shape to how existing 204 routes return (check `web/src/app/api/v1/tasks/[id]/route.ts` DELETE or the milestones delete route; if they use `new NextResponse(null, { status: 204 })`, mirror it exactly).

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual smoke (documented in report, not committed)**

With `pnpm`/`npm run dev` up and a valid access token + `ANTHROPIC_API_KEY` unset, confirm the graceful path:

```bash
curl -s -X POST localhost:3002/api/v1/projects/$PID/ai/chat \
  -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"message":"hi"}' | grep -q "not configured" && echo "chat route OK (graceful)"
```

Record the result in the report. (Full AI path requires a real key — note it as manual-verify-deferred.)

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/v1/projects/*/ai web/src/app/api/v1/ai
git commit -m "feat(ai): chat + action confirm/reject route handlers (maxDuration=60)"
```

---

## Task 4.3: Notifications module + routes

**Files:**
- Create: `web/src/server/ai/notifications.ts`
- Create: `web/src/app/api/v1/projects/[projectId]/notifications/route.ts`
- Create: `web/src/app/api/v1/notifications/[id]/read/route.ts`
- Test: `web/src/server/ai/notifications.test.ts`

**Interfaces:**
- Consumes: `assertCan` from `../rbac/rbac`; `Forbidden`, `NotFound` from `../http/errors`; `prisma` from `../prisma`.
- Produces:
  - `listNotifications(ctx: AuthContext, projectId: string, unreadOnly?: boolean): Promise<Notification[]>`
  - `markRead(ctx: AuthContext, notificationId: string): Promise<void>`
  - Routes: `GET /projects/:projectId/notifications?unread=true` (200, array); `POST /notifications/:id/read` (204).

**Port source:** backend `assistant.service.ts` lines 328–345. `listNotifications` gates `VIEW_PROJECT`, filters `{ projectId, userId: ctx.userId, ...(unreadOnly ? { readAt: null } : {}) }`, `orderBy createdAt desc`, `take: 50`. `markRead` loads the notification, throws `NotFound` if absent, throws `Forbidden` if `notif.userId !== ctx.userId`, else sets `readAt: new Date()`.

- [ ] **Step 1: Write the failing test** (`web/src/server/ai/notifications.test.ts`)

```ts
/**
 * Integration tests for notifications (Task 4.3).
 * Covers: list scoping to caller, unreadOnly filter, VIEW_PROJECT deny,
 *         markRead ownership (Forbidden for another user), NotFound.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../prisma';
import { listNotifications, markRead } from './notifications';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let memberCtx: AuthContext;
let strangerCtx: AuthContext;
let pid: string;
let unreadId: string;

beforeAll(async () => {
  const ts = Date.now();
  const org = await prisma.organization.create({ data: { slug: `notif-${ts}`, name: 'NotifOrg' } });
  orgId = org.id;
  const member = await prisma.user.create({
    data: { orgId, name: 'M', email: `notif-m-${ts}@x.test`, passwordHash: 'x', isActive: true },
  });
  const stranger = await prisma.user.create({
    data: { orgId, name: 'S', email: `notif-s-${ts}@x.test`, passwordHash: 'x', isActive: true },
  });
  memberCtx = { userId: member.id, orgId };
  strangerCtx = { userId: stranger.id, orgId };
  const project = await prisma.project.create({
    data: { orgId, name: `NotifProject-${ts}`, budgetCapVnd: BigInt(0), createdById: member.id },
  });
  pid = project.id;
  await prisma.projectMember.create({ data: { projectId: pid, userId: member.id, role: 'OWNER' } });

  const unread = await prisma.notification.create({
    data: { projectId: pid, userId: member.id, type: 'AI_NUDGE', severity: 'INFO', title: 'Ping', body: 'do the thing' },
  });
  unreadId = unread.id;
  await prisma.notification.create({
    data: { projectId: pid, userId: member.id, type: 'AI_NUDGE', severity: 'INFO', title: 'Old', body: 'read one', readAt: new Date() },
  });
});

describe('listNotifications', () => {
  it('returns the caller\'s notifications, newest first', async () => {
    const all = await listNotifications(memberCtx, pid);
    expect(all.length).toBe(2);
  });
  it('unreadOnly filters out read notifications', async () => {
    const unread = await listNotifications(memberCtx, pid, true);
    expect(unread.length).toBe(1);
    expect(unread[0]!.id).toBe(unreadId);
  });
  it('denies a non-member with Forbidden', async () => {
    await expect(listNotifications(strangerCtx, pid)).rejects.toMatchObject({ status: 403 });
  });
});

describe('markRead', () => {
  it('marks the caller\'s own notification read', async () => {
    await markRead(memberCtx, unreadId);
    const n = await prisma.notification.findUnique({ where: { id: unreadId } });
    expect(n!.readAt).not.toBeNull();
  });
  it('forbids marking another user\'s notification', async () => {
    const other = await prisma.notification.create({
      data: { projectId: pid, userId: memberCtx.userId, type: 'AI_NUDGE', severity: 'INFO', title: 'x', body: 'y' },
    });
    await expect(markRead(strangerCtx, other.id)).rejects.toMatchObject({ status: 403 });
  });
  it('throws NotFound for a missing notification', async () => {
    await expect(markRead(memberCtx, 'cxxxxnope0000000000000000')).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/server/ai/notifications.test.ts`
Expected: FAIL — `Cannot find module './notifications'`.

- [ ] **Step 3: Implement `notifications.ts`**

```ts
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { Forbidden, NotFound } from '../http/errors';

export async function listNotifications(ctx: AuthContext, projectId: string, unreadOnly = false) {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);
  return prisma.notification.findMany({
    where: { projectId, userId: ctx.userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function markRead(ctx: AuthContext, notificationId: string): Promise<void> {
  const notif = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notif) throw new NotFound('Notification not found');
  if (notif.userId !== ctx.userId) throw new Forbidden();
  await prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/server/ai/notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Write list route** (`web/src/app/api/v1/projects/[projectId]/notifications/route.ts`)

```ts
import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { listNotifications } from '@/server/ai/notifications';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const unread = new URL(req.url).searchParams.get('unread') === 'true';
  return NextResponse.json(await listNotifications(auth, projectId, unread), { status: 200 });
});
```

- [ ] **Step 6: Write read route** (`web/src/app/api/v1/notifications/[id]/read/route.ts`)

```ts
import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { markRead } from '@/server/ai/notifications';

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  await markRead(auth, id);
  return new NextResponse(null, { status: 204 });
});
```

- [ ] **Step 7: Typecheck + full suite**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests (existing + new AI/notification) green.

- [ ] **Step 8: Commit**

```bash
git add web/src/server/ai/notifications.ts web/src/server/ai/notifications.test.ts web/src/app/api/v1/projects/*/notifications web/src/app/api/v1/notifications
git commit -m "feat(ai): notifications module + list/read routes"
```

---

## Post-plan: CHANGELOG

After Task 4.3, add a Phase 4 section to `docs/CHANGELOG.md` recording: (1) AI ported blocking with `maxDuration=60` per user decision; (2) constructor DI replaced by an env-based client seam + `deps.client` test injection; (3) `AssistantService` split into `assistant.ts` (engine + knowledge) and `notifications.ts`; (4) any deviation the reviewer flags. This is its own final step, not part of a task's DoD.

## Self-Review (completed by plan author)

- **Spec coverage:** chat loop ✓ (4.1), read tools ✓ (4.1 dispatchReadTool), write intercept→PROPOSED ✓ (4.1), confirm/reject ✓ (4.1 + routes 4.2), notifications list/read ✓ (4.3), knowledge search ✓ (4.1 searchKnowledge, used by tool + gated). All 5 backend endpoints have routes: chat, confirm, reject, notifications-list, notification-read. `send_notification`/`create_config_item`/`create_task`/etc. are write tools inside dispatchWriteTool, covered by 4.1.
- **Placeholder scan:** test code is complete; port steps name the exact backend line ranges + substitution table rather than re-transcribing 600 lines (the source file is the authoritative spec for a faithful port — same approach as Phases 2–3).
- **Type consistency:** `chat` signature (with `deps`), `confirmAction`, `rejectAction`, `searchKnowledge`, `listNotifications`, `markRead` names match between the Interfaces blocks, the route imports, and the tests. `AnthropicLike` defined once in 4.1 and imported by the test.
- **Open verification for implementer:** confirm the exact ported audit function name/signature (`web/src/server/audit/audit.ts`) and the 204-response idiom (`web/src/app/api/v1/tasks/[id]/route.ts`) before writing — both are named as "check the existing call site" in the steps, not guessed.
