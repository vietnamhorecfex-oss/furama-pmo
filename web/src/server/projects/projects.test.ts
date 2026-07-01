import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { createProject, listProjects, getProject, archiveProject, updateProjectMeta } from './projects';

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

  it('updateProjectMeta: partial update leaves other fields intact', async () => {
    const p = await createProject(ctx(), { name: 'Meta', budgetCapVnd: 100 } as any, null);
    const up = await updateProjectMeta(ctx(), p.id, { name: 'Meta2' } as any, null);
    expect(up.name).toBe('Meta2');
    expect(up.budgetCapVnd).toBe(100); // unspecified field unchanged
  });

  it('updateProjectMeta: rejects startDate after endDate (BadRequest)', async () => {
    const p = await createProject(ctx(), { name: 'Dates', budgetCapVnd: 0 } as any, null);
    await expect(
      updateProjectMeta(ctx(), p.id, { startDate: '2026-12-31T00:00:00.000Z', endDate: '2026-01-01T00:00:00.000Z' } as any, null),
    ).rejects.toThrow(/date|start|end|bad request/i);
  });

  it('updateProjectMeta: a non-manager member is Forbidden (MANAGE_CONFIG)', async () => {
    const p = await createProject(ctx(), { name: 'Deny', budgetCapVnd: 0 } as any, null);
    await prisma.projectMember.create({ data: { projectId: p.id, userId: otherUserId, role: 'MEMBER' } });
    await expect(
      updateProjectMeta({ userId: otherUserId, orgId }, p.id, { name: 'x' } as any, null),
    ).rejects.toThrow(/forbidden|cannot/i);
  });

  it('archiveProject: a non-OWNER member is Forbidden (OWNER-only)', async () => {
    const p = await createProject(ctx(), { name: 'ArchDeny', budgetCapVnd: 0 } as any, null);
    await prisma.projectMember.create({ data: { projectId: p.id, userId: otherUserId, role: 'PM' } });
    await expect(
      archiveProject({ userId: otherUserId, orgId }, p.id, null),
    ).rejects.toThrow(/forbidden|cannot|archive/i);
  });
});
