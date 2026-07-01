/**
 * Integration tests for statuses service functions.
 * TDD: written before implementation — expect RED first, then GREEN after statuses.ts is created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { listStatusDefs, createStatusDef, updateStatusDef, deleteStatusDef, reorderStatusDefs } from './statuses';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerId: string;
let pid: string;
let ownerCtx: AuthContext;

beforeAll(async () => {
  const ts = Date.now();
  const org = await prisma.organization.create({ data: { slug: `st-${ts}`, name: 'StatusOrg' } });
  orgId = org.id;

  ownerId = (
    await prisma.user.create({
      data: { orgId, name: 'Owner', email: `st-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: { orgId, name: `StatusProject-${ts}`, budgetCapVnd: BigInt(0), createdById: ownerId },
  });
  pid = project.id;

  await prisma.projectMember.create({ data: { projectId: pid, userId: ownerId, role: 'OWNER' } });
  ownerCtx = { userId: ownerId, orgId };
});

afterAll(async () => {
  await prisma.taskAssignment.deleteMany({ where: { task: { projectId: pid } } });
  await prisma.task.deleteMany({ where: { projectId: pid } });
  await prisma.statusDef.deleteMany({ where: { projectId: pid } });
  await prisma.memberWorkstream.deleteMany({ where: { projectMember: { projectId: pid } } });
  await prisma.projectMember.deleteMany({ where: { projectId: pid } });
  await prisma.auditLog.deleteMany({ where: { projectId: pid } });
  await prisma.project.delete({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('statuses', () => {
  let statusId: string;

  it('creates a status and returns it', async () => {
    const s = await createStatusDef(ownerCtx, pid, { key: 'OPEN', color: '#ff0000', order: 1, isTerminal: false } as any, null);
    statusId = s.id;
    expect(s.key).toBe('OPEN');
    expect(s.projectId).toBe(pid);
  });

  it('lists statuses ordered by [order asc, key asc]', async () => {
    await createStatusDef(ownerCtx, pid, { key: 'ZZLAST', order: 99, color: '#000', isTerminal: false } as any, null);
    await createStatusDef(ownerCtx, pid, { key: 'AAFIRST', order: 1, color: '#000', isTerminal: false } as any, null);
    const list = await listStatusDefs(ownerCtx, pid);
    const keys = list.map((s) => s.key);
    // AAFIRST (order=1) and OPEN (order=1) both come before ZZLAST (order=99)
    expect(keys.indexOf('ZZLAST')).toBeGreaterThan(keys.indexOf('AAFIRST'));
    // Within same order, alphabetical: AAFIRST < OPEN
    expect(keys.indexOf('AAFIRST')).toBeLessThan(keys.indexOf('OPEN'));
  });

  it('rejects a duplicate key with Conflict', async () => {
    await expect(
      createStatusDef(ownerCtx, pid, { key: 'OPEN', color: '#000', order: 0, isTerminal: false } as any, null),
    ).rejects.toThrow(/conflict|exist/i);
  });

  it('deletes a status that has no task references', async () => {
    const s = await createStatusDef(ownerCtx, pid, { key: 'TODELETE', order: 0, color: '#000', isTerminal: false } as any, null);
    await expect(deleteStatusDef(ownerCtx, pid, s.id, {}, null)).resolves.toBeUndefined();
  });

  it('blocks deleting a status referenced by a task (Conflict)', async () => {
    // Create a status with a key matching a real enum value so task.count works
    const s = await createStatusDef(ownerCtx, pid, { key: 'NOT_STARTED', order: 0, color: '#000', isTerminal: false } as any, null);
    // Create a task with status NOT_STARTED
    await prisma.task.create({
      data: { projectId: pid, code: `ST-T${Date.now()}`, title: 'test task', status: 'NOT_STARTED', priority: 'MEDIUM' },
    });
    await expect(deleteStatusDef(ownerCtx, pid, s.id, {}, null)).rejects.toThrow(/conflict|replaceWithKey|task/i);
  });
});
