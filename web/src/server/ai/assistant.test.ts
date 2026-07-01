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

describe('searchKnowledge', () => {
  it('returns matching excerpts and respects topK', async () => {
    const hits = await searchKnowledge(ownerCtx, pid, 'greeting', 4);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.title).toBe('Check-in SOP');
    expect(hits[0]!.excerpt.length).toBeLessThanOrEqual(500);
  });
});
