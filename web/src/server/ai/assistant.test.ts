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
let leadCtx: AuthContext;
let leadUserId: string;
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
  const lead = await prisma.user.create({
    data: { orgId, name: 'Lead', email: `ai-lead-${ts}@x.test`, passwordHash: 'x', isActive: true },
  });
  ownerCtx = { userId: owner.id, orgId };
  strangerCtx = { userId: stranger.id, orgId };
  leadCtx = { userId: lead.id, orgId };
  leadUserId = lead.id;

  const project = await prisma.project.create({
    data: { orgId, name: `AiProject-${ts}`, budgetCapVnd: BigInt(0), createdById: owner.id },
  });
  pid = project.id;
  await prisma.projectMember.create({ data: { projectId: pid, userId: owner.id, role: 'OWNER' } });
  await prisma.projectMember.create({ data: { projectId: pid, userId: lead.id, role: 'LEAD' } });

  const phase = await prisma.phase.create({ data: { projectId: pid, name: 'Exec', order: 1 } });
  const ws = await prisma.workstream.create({ data: { projectId: pid, name: 'Ops', track: 'OPERATIONS', order: 1 } });
  const task = await prisma.task.create({
    data: {
      projectId: pid, phaseId: phase.id, workstreamId: ws.id,
      code: `T-${ts}`, title: 'Install PBX', status: 'NOT_STARTED', percent: 0,
    },
  });
  taskId = task.id;

  await prisma.knowledgeDoc.create({
    data: { projectId: pid, title: 'Check-in SOP', source: 'PLAYBOOK', content: 'The front desk greeting procedure is: welcome the guest warmly.' },
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

describe('list_overdue', () => {
  it('finds overdue tasks even when they fall outside the first 50 by creation order', async () => {
    // Fresh project: 55 future-deadline tasks created FIRST, 5 overdue created LAST —
    // a page-1-of-50 slice by createdAt would contain zero overdue tasks.
    const ts = Date.now();
    const project = await prisma.project.create({
      data: { orgId, name: `AiOverdue-${ts}`, budgetCapVnd: BigInt(0), createdById: ownerCtx.userId },
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: ownerCtx.userId, role: 'OWNER' },
    });
    const phase = await prisma.phase.create({ data: { projectId: project.id, name: 'P', order: 1 } });
    const ws = await prisma.workstream.create({
      data: { projectId: project.id, name: 'W', track: 'OPERATIONS', order: 1 },
    });
    const future = new Date(Date.now() + 30 * 86_400_000);
    const past = new Date(Date.now() - 2 * 86_400_000);
    const base = Date.now() - 3_600_000;
    await prisma.task.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        projectId: project.id, phaseId: phase.id, workstreamId: ws.id,
        code: `OV-F-${i}`, title: `Future ${i}`, status: 'NOT_STARTED' as const, percent: 0,
        deadline: future, createdAt: new Date(base + i * 1000),
      })),
    });
    await prisma.task.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        projectId: project.id, phaseId: phase.id, workstreamId: ws.id,
        code: `OV-P-${i}`, title: `Overdue ${i}`, status: 'NOT_STARTED' as const, percent: 0,
        deadline: past, createdAt: new Date(base + (100 + i) * 1000),
      })),
    });

    const captured: any[] = [];
    const steps = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu-ov', name: 'list_overdue', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    let i = 0;
    const client: AnthropicLike = {
      messages: {
        create: async (params) => {
          captured.push(params);
          return steps[Math.min(i++, steps.length - 1)] as any;
        },
      },
    };
    await chat(ownerCtx, project.id, 'what is overdue?', undefined, { client });

    // The second model call carries the tool_result the model saw.
    const toolResultMsg = captured[1].messages.at(-1);
    const payload = JSON.parse(toolResultMsg.content[0].content);
    expect(payload.total).toBe(5);
    const codes = payload.tasks.map((t: { code: string }) => t.code).sort();
    expect(codes).toEqual(['OV-P-0', 'OV-P-1', 'OV-P-2', 'OV-P-3', 'OV-P-4']);
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

describe('send_notification RBAC deny (MANAGE_MEMBERS)', () => {
  it('LEAD can propose send_notification but confirmAction is denied with 403 and marks action FAILED', async () => {
    // LEAD has VIEW_PROJECT → can reach chat() and get a PROPOSED action
    const client = scriptedClient([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu-notif',
            name: 'send_notification',
            input: { userId: leadUserId, title: 'x', body: 'y' },
          },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Staged notification — please confirm.' }] },
    ]);

    const res = await chat(leadCtx, pid, 'send a notification', undefined, { client });
    expect(res.proposedActions).toHaveLength(1);
    const actionId = res.proposedActions[0]!.actionId;

    // Confirm as LEAD — MANAGE_MEMBERS check inside dispatchWriteTool → send_notification must throw 403
    await expect(confirmAction(leadCtx, actionId)).rejects.toMatchObject({ status: 403 });

    // Action row must be marked FAILED
    const action = await prisma.aiActionLog.findUnique({ where: { id: actionId } });
    expect(action!.status).toBe('FAILED');

    // No Notification row created for this lead user as a result
    const notifCount = await prisma.notification.count({
      where: { projectId: pid, userId: leadUserId, title: 'x' },
    });
    expect(notifCount).toBe(0);
  });
});
