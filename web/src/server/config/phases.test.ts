/**
 * Integration tests for phases service functions.
 * TDD: written before implementation — expect RED first, then GREEN after phases.ts is created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { createPhase, listPhases, updatePhase, deletePhase, reorderPhases } from './phases';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerId: string;
let viewerId: string;
let pid: string;
let ownerCtx: AuthContext;
let viewerCtx: AuthContext;

beforeAll(async () => {
  const ts = Date.now();
  const org = await prisma.organization.create({ data: { slug: `ph-${ts}`, name: 'PhaseOrg' } });
  orgId = org.id;

  ownerId = (
    await prisma.user.create({
      data: { orgId, name: 'Owner', email: `ph-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  viewerId = (
    await prisma.user.create({
      data: { orgId, name: 'Viewer', email: `ph-viewer-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: {
      orgId,
      name: `PhaseProject-${ts}`,
      budgetCapVnd: BigInt(0),
      createdById: ownerId,
    },
  });
  pid = project.id;

  // Owner member (OWNER role → has MANAGE_CONFIG)
  await prisma.projectMember.create({ data: { projectId: pid, userId: ownerId, role: 'OWNER' } });

  // Viewer member (VIEWER role → has VIEW_PROJECT but NOT MANAGE_CONFIG)
  await prisma.projectMember.create({ data: { projectId: pid, userId: viewerId, role: 'VIEWER' } });

  ownerCtx = { userId: ownerId, orgId };
  viewerCtx = { userId: viewerId, orgId };
});

afterAll(async () => {
  // Clean up in FK order
  await prisma.taskAssignment.deleteMany({ where: { task: { projectId: pid } } });
  await prisma.task.deleteMany({ where: { projectId: pid } });
  await prisma.phase.deleteMany({ where: { projectId: pid } });
  await prisma.memberWorkstream.deleteMany({ where: { projectMember: { projectId: pid } } });
  await prisma.projectMember.deleteMany({ where: { projectId: pid } });
  await prisma.auditLog.deleteMany({ where: { projectId: pid } });
  await prisma.project.delete({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('phases', () => {
  it('creates phases and lists them ordered by [order asc, name asc]', async () => {
    const ph1 = await createPhase(ownerCtx, pid, { name: 'Alpha', order: 2 } as any, null);
    const ph2 = await createPhase(ownerCtx, pid, { name: 'Zeta', order: 1 } as any, null);
    const ph3 = await createPhase(ownerCtx, pid, { name: 'Beta', order: 1 } as any, null);

    const list = await listPhases(ownerCtx, pid);
    // Verify order: order=1 items before order=2; within order=1, alphabetical
    const names = list.map((p) => p.name);
    expect(names.indexOf('Beta')).toBeLessThan(names.indexOf('Zeta'));
    expect(names.indexOf('Zeta')).toBeLessThan(names.indexOf('Alpha'));

    // Cleanup
    await prisma.phase.deleteMany({ where: { id: { in: [ph1.id, ph2.id, ph3.id] } } });
  });

  it('rejects a duplicate phase name with Conflict', async () => {
    await createPhase(ownerCtx, pid, { name: 'Design' } as any, null);
    await expect(createPhase(ownerCtx, pid, { name: 'Design' } as any, null)).rejects.toThrow(
      /conflict|exist/i,
    );
    // Cleanup
    await prisma.phase.deleteMany({ where: { projectId: pid, name: 'Design' } });
  });

  it('a VIEWER cannot create a phase (Forbidden)', async () => {
    await expect(createPhase(viewerCtx, pid, { name: 'X' } as any, null)).rejects.toThrow(
      /forbidden|cannot/i,
    );
  });

  it('a VIEWER can list phases (VIEW_PROJECT)', async () => {
    const ph = await createPhase(ownerCtx, pid, { name: 'ViewTest' } as any, null);
    const list = await listPhases(viewerCtx, pid);
    expect(list.some((p) => p.id === ph.id)).toBe(true);
    await prisma.phase.delete({ where: { id: ph.id } });
  });

  it('updatePhase returns the updated name', async () => {
    const ph = await createPhase(ownerCtx, pid, { name: 'OldName' } as any, null);
    const updated = await updatePhase(ownerCtx, pid, ph.id, { name: 'NewName' } as any, null);
    expect(updated.name).toBe('NewName');
    await prisma.phase.delete({ where: { id: ph.id } });
  });

  it('updatePhase throws NotFound for a phase in another project', async () => {
    await expect(updatePhase(ownerCtx, pid, 'nonexistent-id', { name: 'X' } as any, null)).rejects.toThrow(
      /not found/i,
    );
  });

  it('blocks deleting a phase still referenced by a task', async () => {
    const ph = await createPhase(ownerCtx, pid, { name: 'Build' } as any, null);
    await prisma.task.create({
      data: {
        projectId: pid,
        phaseId: ph.id,
        code: `T${Date.now()}`,
        title: 'task-in-phase',
        status: 'NOT_STARTED',
        priority: 'MEDIUM',
      },
    });
    await expect(deletePhase(ownerCtx, pid, ph.id, null)).rejects.toThrow(/conflict|referenc|in use|task|reassign/i);
    // Cleanup (task first, then phase)
    await prisma.task.deleteMany({ where: { phaseId: ph.id } });
    await prisma.phase.delete({ where: { id: ph.id } });
  });

  it('reorderPhases updates order in transaction', async () => {
    const ph1 = await createPhase(ownerCtx, pid, { name: 'R1', order: 10 } as any, null);
    const ph2 = await createPhase(ownerCtx, pid, { name: 'R2', order: 20 } as any, null);

    await reorderPhases(ownerCtx, pid, { items: [{ id: ph1.id, order: 5 }, { id: ph2.id, order: 3 }] }, null);

    const list = await listPhases(ownerCtx, pid);
    const r1 = list.find((p) => p.id === ph1.id)!;
    const r2 = list.find((p) => p.id === ph2.id)!;
    expect(r2.order).toBeLessThan(r1.order); // ph2 now order=3, ph1 order=5

    await prisma.phase.deleteMany({ where: { id: { in: [ph1.id, ph2.id] } } });
  });

  it('deletePhase succeeds when no tasks reference it', async () => {
    const ph = await createPhase(ownerCtx, pid, { name: 'SafeDelete' } as any, null);
    await expect(deletePhase(ownerCtx, pid, ph.id, null)).resolves.toBeUndefined();
  });
});
