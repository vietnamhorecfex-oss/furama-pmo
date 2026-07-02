/**
 * Tests for the AI Digest (reminders + project summary).
 * Client is injected (deps.client) so tests run offline. Covers the deterministic
 * fallback (no client) and the LLM path (scripted client), plus RBAC deny.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { taskReminders, projectSummary, type AnthropicLike } from './digest';
import type { AuthContext } from '../rbac/rbac';

function scriptedClient(text: string): AnthropicLike {
  return { messages: { create: async () => ({ content: [{ type: 'text', text }] }) as never } };
}

let orgId: string;
let pid: string;
let ownerCtx: AuthContext;
let strangerCtx: AuthContext;

const DAY = 86_400_000;

beforeAll(async () => {
  const ts = Date.now();
  const org = await prisma.organization.create({ data: { slug: `dg-${ts}`, name: 'DigestOrg' } });
  orgId = org.id;
  const owner = await prisma.user.create({
    data: { orgId, name: 'DGOwner', email: `dg-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
  });
  const stranger = await prisma.user.create({
    data: { orgId, name: 'DGStranger', email: `dg-str-${ts}@x.test`, passwordHash: 'x', isActive: true },
  });
  ownerCtx = { userId: owner.id, orgId };
  strangerCtx = { userId: stranger.id, orgId };

  const project = await prisma.project.create({
    data: { orgId, name: `DGProject-${ts}`, budgetCapVnd: BigInt(1_000_000), createdById: owner.id },
  });
  pid = project.id;
  await prisma.projectMember.create({ data: { projectId: pid, userId: owner.id, role: 'OWNER' } });

  const now = Date.now();
  // overdue (with a PIC assignment)
  const overdue = await prisma.task.create({
    data: {
      projectId: pid, code: `OV-${ts}`, title: 'Việc quá hạn', status: 'NOT_STARTED',
      priority: 'CRITICAL', percent: 0, deadline: new Date(now - 2 * DAY),
    },
  });
  await prisma.taskAssignment.create({ data: { taskId: overdue.id, role: 'IN_CHARGE', label: 'PMO Lead' } });
  // due soon (within 3 days)
  await prisma.task.create({
    data: {
      projectId: pid, code: `DS-${ts}`, title: 'Việc sắp đến hạn', status: 'IN_PROGRESS',
      priority: 'HIGH', percent: 20, deadline: new Date(now + 2 * DAY),
    },
  });
  // blocked
  await prisma.task.create({
    data: { projectId: pid, code: `BL-${ts}`, title: 'Việc bị chặn', status: 'BLOCKED', priority: 'MEDIUM', percent: 10 },
  });
  // completed overdue → must be excluded from reminders
  await prisma.task.create({
    data: {
      projectId: pid, code: `CP-${ts}`, title: 'Việc đã xong', status: 'COMPLETED',
      priority: 'LOW', percent: 100, deadline: new Date(now - 5 * DAY),
    },
  });
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { projectId: pid } });
  await prisma.project.deleteMany({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('taskReminders', () => {
  it('buckets overdue / dueSoon / blocked and excludes completed (rule-based fallback)', async () => {
    const r = await taskReminders(ownerCtx, pid, { client: null });
    expect(r.generatedByAI).toBe(false);
    const b = r.data as { overdue: unknown[]; dueSoon: unknown[]; blocked: unknown[] };
    expect(b.overdue).toHaveLength(1);
    expect(b.dueSoon).toHaveLength(1);
    expect(b.blocked).toHaveLength(1);
    expect(r.markdown).toContain('Nhắc việc');
    expect(r.markdown).toContain('Việc quá hạn');
    expect(r.markdown).not.toContain('Việc đã xong'); // completed excluded
    expect(r.markdown).toContain('PMO Lead'); // PIC surfaced
  });

  it('uses the LLM text when a client is provided', async () => {
    const r = await taskReminders(ownerCtx, pid, { client: scriptedClient('NHẮC VIỆC DO AI') });
    expect(r.generatedByAI).toBe(true);
    expect(r.markdown).toBe('NHẮC VIỆC DO AI');
  });

  it('denies a non-member (Forbidden)', async () => {
    await expect(taskReminders(strangerCtx, pid, { client: null })).rejects.toThrow();
  });
});

describe('projectSummary', () => {
  it('builds a recap from the dashboard overview (rule-based fallback)', async () => {
    const r = await projectSummary(ownerCtx, pid, { client: null });
    expect(r.generatedByAI).toBe(false);
    expect(r.markdown).toContain('Tổng kết');
    expect(r.markdown).toContain('Tiến độ tổng thể');
    expect(r.markdown).toContain('quá hạn');
  });

  it('uses the LLM text when a client is provided', async () => {
    const r = await projectSummary(ownerCtx, pid, { client: scriptedClient('TỔNG KẾT DO AI') });
    expect(r.generatedByAI).toBe(true);
    expect(r.markdown).toBe('TỔNG KẾT DO AI');
  });
});
