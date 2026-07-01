/**
 * Integration tests for workstreams service functions.
 * TDD: written before implementation — expect RED first, then GREEN after workstreams.ts is created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import {
  createWorkstream,
  listWorkstreams,
  updateWorkstream,
  deleteWorkstream,
  reorderWorkstreams,
} from './workstreams';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerId: string;
let viewerId: string;
let pid: string;
let ownerCtx: AuthContext;
let viewerCtx: AuthContext;

beforeAll(async () => {
  const ts = Date.now();
  const org = await prisma.organization.create({ data: { slug: `ws-${ts}`, name: 'WsOrg' } });
  orgId = org.id;

  ownerId = (
    await prisma.user.create({
      data: { orgId, name: 'WsOwner', email: `ws-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  viewerId = (
    await prisma.user.create({
      data: { orgId, name: 'WsViewer', email: `ws-viewer-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: {
      orgId,
      name: `WsProject-${ts}`,
      budgetCapVnd: BigInt(0),
      createdById: ownerId,
    },
  });
  pid = project.id;

  // Owner member (OWNER role → has MANAGE_CONFIG)
  await prisma.projectMember.create({ data: { projectId: pid, userId: ownerId, role: 'OWNER' } });

  // Viewer member (VIEWER → VIEW_PROJECT only)
  await prisma.projectMember.create({ data: { projectId: pid, userId: viewerId, role: 'VIEWER' } });

  ownerCtx = { userId: ownerId, orgId };
  viewerCtx = { userId: viewerId, orgId };
});

afterAll(async () => {
  // Clean up in FK order
  await prisma.taskAssignment.deleteMany({ where: { task: { projectId: pid } } });
  await prisma.task.deleteMany({ where: { projectId: pid } });
  await prisma.memberWorkstream.deleteMany({ where: { projectMember: { projectId: pid } } });
  await prisma.workstream.deleteMany({ where: { projectId: pid } });
  await prisma.projectMember.deleteMany({ where: { projectId: pid } });
  await prisma.auditLog.deleteMany({ where: { projectId: pid } });
  await prisma.project.delete({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('workstreams', () => {
  it('creates workstreams and lists them ordered by [order asc, name asc]', async () => {
    const ws1 = await createWorkstream(ownerCtx, pid, { name: 'Zulu', order: 1 } as any, null);
    const ws2 = await createWorkstream(ownerCtx, pid, { name: 'Alpha', order: 1 } as any, null);
    const ws3 = await createWorkstream(ownerCtx, pid, { name: 'Bravo', order: 2 } as any, null);

    const list = await listWorkstreams(ownerCtx, pid);
    const names = list.map((w) => w.name);
    // order=1 → Alpha before Zulu (alpha); then order=2 → Bravo last
    expect(names.indexOf('Alpha')).toBeLessThan(names.indexOf('Zulu'));
    expect(names.indexOf('Zulu')).toBeLessThan(names.indexOf('Bravo'));

    await prisma.workstream.deleteMany({ where: { id: { in: [ws1.id, ws2.id, ws3.id] } } });
  });

  it('rejects a duplicate workstream name with Conflict', async () => {
    await createWorkstream(ownerCtx, pid, { name: 'Marketing' } as any, null);
    await expect(createWorkstream(ownerCtx, pid, { name: 'Marketing' } as any, null)).rejects.toThrow(
      /conflict|exist/i,
    );
    await prisma.workstream.deleteMany({ where: { projectId: pid, name: 'Marketing' } });
  });

  it('a VIEWER cannot create a workstream (Forbidden)', async () => {
    await expect(createWorkstream(viewerCtx, pid, { name: 'X' } as any, null)).rejects.toThrow(
      /forbidden|cannot/i,
    );
  });

  it('a VIEWER can list workstreams (VIEW_PROJECT)', async () => {
    const ws = await createWorkstream(ownerCtx, pid, { name: 'ViewTestWs' } as any, null);
    const list = await listWorkstreams(viewerCtx, pid);
    expect(list.some((w) => w.id === ws.id)).toBe(true);
    await prisma.workstream.delete({ where: { id: ws.id } });
  });

  it('updateWorkstream returns the updated name', async () => {
    const ws = await createWorkstream(ownerCtx, pid, { name: 'OldWsName' } as any, null);
    const updated = await updateWorkstream(ownerCtx, pid, ws.id, { name: 'NewWsName' } as any, null);
    expect(updated.name).toBe('NewWsName');
    await prisma.workstream.delete({ where: { id: ws.id } });
  });

  it('updateWorkstream throws NotFound for an ID not in this project', async () => {
    await expect(
      updateWorkstream(ownerCtx, pid, 'nonexistent-id', { name: 'X' } as any, null),
    ).rejects.toThrow(/not found/i);
  });

  it('blocks deleting a workstream still referenced by a task', async () => {
    const ws = await createWorkstream(ownerCtx, pid, { name: 'TaskWs' } as any, null);
    await prisma.task.create({
      data: {
        projectId: pid,
        workstreamId: ws.id,
        code: `TW${Date.now()}`,
        title: 'task-in-ws',
        status: 'NOT_STARTED',
        priority: 'MEDIUM',
      },
    });
    await expect(deleteWorkstream(ownerCtx, pid, ws.id, null)).rejects.toThrow(
      /conflict|referenc|in use|task|lead/i,
    );
    // Cleanup
    await prisma.task.deleteMany({ where: { workstreamId: ws.id } });
    await prisma.workstream.delete({ where: { id: ws.id } });
  });

  it('blocks deleting a workstream referenced by a MemberWorkstream (LEAD scope)', async () => {
    const ws = await createWorkstream(ownerCtx, pid, { name: 'LeadWs' } as any, null);

    // Create a LEAD member and assign to this workstream
    const ts = Date.now();
    const leadUser = await prisma.user.create({
      data: { orgId, name: 'Lead', email: `lead-${ts}@x.test`, passwordHash: 'x', isActive: true },
    });
    const leadMember = await prisma.projectMember.create({
      data: { projectId: pid, userId: leadUser.id, role: 'LEAD' },
    });
    await prisma.memberWorkstream.create({
      data: { projectMemberId: leadMember.id, workstreamId: ws.id },
    });

    await expect(deleteWorkstream(ownerCtx, pid, ws.id, null)).rejects.toThrow(
      /conflict|referenc|in use|task|lead/i,
    );

    // Cleanup
    await prisma.memberWorkstream.deleteMany({ where: { workstreamId: ws.id } });
    await prisma.projectMember.delete({ where: { id: leadMember.id } });
    await prisma.user.delete({ where: { id: leadUser.id } });
    await prisma.workstream.delete({ where: { id: ws.id } });
  });

  it('deleteWorkstream succeeds when neither tasks nor member scopes reference it', async () => {
    const ws = await createWorkstream(ownerCtx, pid, { name: 'SafeWsDelete' } as any, null);
    await expect(deleteWorkstream(ownerCtx, pid, ws.id, null)).resolves.toBeUndefined();
  });

  it('reorderWorkstreams updates order in transaction', async () => {
    const ws1 = await createWorkstream(ownerCtx, pid, { name: 'WsR1', order: 10 } as any, null);
    const ws2 = await createWorkstream(ownerCtx, pid, { name: 'WsR2', order: 20 } as any, null);

    await reorderWorkstreams(
      ownerCtx,
      pid,
      { items: [{ id: ws1.id, order: 7 }, { id: ws2.id, order: 3 }] },
      null,
    );

    const list = await listWorkstreams(ownerCtx, pid);
    const r1 = list.find((w) => w.id === ws1.id)!;
    const r2 = list.find((w) => w.id === ws2.id)!;
    expect(r2.order).toBeLessThan(r1.order);

    await prisma.workstream.deleteMany({ where: { id: { in: [ws1.id, ws2.id] } } });
  });
});
