/**
 * Integration tests for audit activity feed & entity history.
 * TDD: written before implementation — expect RED first, then GREEN after activity.ts is created.
 *
 * Covers:
 *  - activityFeed: OWNER sees all rows; MEMBER → 403; LEAD → only WS-A task rows
 *  - entityHistory: OWNER sees Task history; MEMBER → 403; LEAD on WS-B task → 403; LEAD on Project entity → 403
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { activityFeed, entityHistory } from './activity';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerUserId: string;
let leadUserId: string;
let memberUserId: string;
let pid: string;
let wsAId: string;
let wsBId: string;
let taskAId: string;  // in WS-A (LEAD owns)
let taskBId: string;  // in WS-B (LEAD doesn't own)
let auditRowTaskAId: string;
let auditRowTaskBId: string;
let auditRowProjectId: string;

let ownerCtx: AuthContext;
let leadCtx: AuthContext;
let memberCtx: AuthContext;

beforeAll(async () => {
  const ts = Date.now();

  const org = await prisma.organization.create({
    data: { slug: `activity-${ts}`, name: 'ActivityOrg' },
  });
  orgId = org.id;

  ownerUserId = (
    await prisma.user.create({
      data: { orgId, name: 'Owner', email: `activity-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  leadUserId = (
    await prisma.user.create({
      data: { orgId, name: 'Lead', email: `activity-lead-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  memberUserId = (
    await prisma.user.create({
      data: { orgId, name: 'Member', email: `activity-member-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: {
      orgId,
      name: `ActivityProject-${ts}`,
      budgetCapVnd: BigInt(0),
      createdById: ownerUserId,
    },
  });
  pid = project.id;

  // Seed project members
  const ownerMember = await prisma.projectMember.create({
    data: { projectId: pid, userId: ownerUserId, role: 'OWNER' },
  });
  const leadMember = await prisma.projectMember.create({
    data: { projectId: pid, userId: leadUserId, role: 'LEAD' },
  });
  await prisma.projectMember.create({
    data: { projectId: pid, userId: memberUserId, role: 'MEMBER' },
  });

  // Seed workstreams
  const wsA = await prisma.workstream.create({
    data: { projectId: pid, name: 'WS-A', order: 0 },
  });
  wsAId = wsA.id;

  const wsB = await prisma.workstream.create({
    data: { projectId: pid, name: 'WS-B', order: 1 },
  });
  wsBId = wsB.id;

  // Assign LEAD to WS-A only (not WS-B)
  await prisma.memberWorkstream.create({
    data: { projectMemberId: leadMember.id, workstreamId: wsAId },
  });

  // Seed tasks
  const taskA = await prisma.task.create({
    data: {
      projectId: pid,
      code: `ACT-A-${ts}`,
      title: 'Task in WS-A',
      priority: 'MEDIUM',
      status: 'NOT_STARTED',
      percent: 0,
      workstreamId: wsAId,
      budgetVnd: BigInt(0),
      actualVnd: BigInt(0),
      createdById: ownerUserId,
      updatedById: ownerUserId,
    },
  });
  taskAId = taskA.id;

  const taskB = await prisma.task.create({
    data: {
      projectId: pid,
      code: `ACT-B-${ts}`,
      title: 'Task in WS-B',
      priority: 'MEDIUM',
      status: 'NOT_STARTED',
      percent: 0,
      workstreamId: wsBId,
      budgetVnd: BigInt(0),
      actualVnd: BigInt(0),
      createdById: ownerUserId,
      updatedById: ownerUserId,
    },
  });
  taskBId = taskB.id;

  // Write audit log rows directly
  const rowA = await prisma.auditLog.create({
    data: {
      projectId: pid,
      actorId: ownerUserId,
      action: 'task.created',
      entityType: 'Task',
      entityId: taskAId,
    },
  });
  auditRowTaskAId = rowA.id;

  const rowB = await prisma.auditLog.create({
    data: {
      projectId: pid,
      actorId: ownerUserId,
      action: 'task.created',
      entityType: 'Task',
      entityId: taskBId,
    },
  });
  auditRowTaskBId = rowB.id;

  const rowP = await prisma.auditLog.create({
    data: {
      projectId: pid,
      actorId: ownerUserId,
      action: 'project.updated',
      entityType: 'Project',
      entityId: pid,
    },
  });
  auditRowProjectId = rowP.id;

  ownerCtx = { userId: ownerUserId, orgId };
  leadCtx = { userId: leadUserId, orgId };
  memberCtx = { userId: memberUserId, orgId };
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { projectId: pid } });
  await prisma.memberWorkstream.deleteMany({
    where: { projectMember: { projectId: pid } },
  });
  await prisma.task.deleteMany({ where: { projectId: pid } });
  await prisma.workstream.deleteMany({ where: { projectId: pid } });
  await prisma.projectMember.deleteMany({ where: { projectId: pid } });
  await prisma.project.deleteMany({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

const defaultQuery = { page: 1, pageSize: 20, order: 'desc' as const };

describe('activityFeed', () => {
  it('OWNER sees all rows (total >= 3)', async () => {
    const result = await activityFeed(ownerCtx, pid, defaultQuery);
    expect(result.total).toBeGreaterThanOrEqual(3);
    const ids = result.data.map((r) => r.id);
    expect(ids).toContain(auditRowTaskAId);
    expect(ids).toContain(auditRowTaskBId);
    expect(ids).toContain(auditRowProjectId);
  });

  it('MEMBER → rejects with status 403', async () => {
    await expect(activityFeed(memberCtx, pid, defaultQuery)).rejects.toMatchObject({ status: 403 });
  });

  it('LEAD sees the WS-A task row but NOT the WS-B task row nor the Project row', async () => {
    const result = await activityFeed(leadCtx, pid, defaultQuery);
    const entityIds = result.data.map((r) => r.entityId);
    // Should include taskA
    expect(entityIds).toContain(taskAId);
    // Should NOT include taskB (different workstream)
    expect(entityIds).not.toContain(taskBId);
    // Should NOT include project-level row
    expect(entityIds).not.toContain(pid);
  });

  it('result data rows have correct DTO shape (id, action, entityType, createdAt ISO string)', async () => {
    const result = await activityFeed(ownerCtx, pid, defaultQuery);
    const row = result.data[0]!;
    expect(typeof row.id).toBe('string');
    expect(typeof row.action).toBe('string');
    expect(typeof row.entityType).toBe('string');
    expect(typeof row.createdAt).toBe('string');
    // createdAt should be ISO 8601
    expect(() => new Date(row.createdAt)).not.toThrow();
  });

  it('pagination fields are present', async () => {
    const result = await activityFeed(ownerCtx, pid, defaultQuery);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(typeof result.total).toBe('number');
  });
});

describe('entityHistory', () => {
  it('OWNER gets the WS-A task history (>= 1 row, newest-first)', async () => {
    const rows = await entityHistory(ownerCtx, pid, 'Task', taskAId);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Verify newest-first ordering if multiple rows
    if (rows.length > 1) {
      expect(new Date(rows[0]!.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(rows[1]!.createdAt).getTime(),
      );
    }
    expect(rows[0]!.entityId).toBe(taskAId);
  });

  it('MEMBER → rejects with status 403', async () => {
    await expect(entityHistory(memberCtx, pid, 'Task', taskAId)).rejects.toMatchObject({ status: 403 });
  });

  it('LEAD on WS-B task → status 403 (outside scope)', async () => {
    await expect(entityHistory(leadCtx, pid, 'Task', taskBId)).rejects.toMatchObject({ status: 403 });
  });

  it('LEAD on non-Task entity (entityType Project) → status 403', async () => {
    await expect(entityHistory(leadCtx, pid, 'Project', pid)).rejects.toMatchObject({ status: 403 });
  });

  it('LEAD can see history for a Task in their own workstream (WS-A)', async () => {
    const rows = await entityHistory(leadCtx, pid, 'Task', taskAId);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.entityId).toBe(taskAId);
  });
});
