import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { assertCan, can } from './rbac';

let ids: { org: string; project: string; user: string; wsOwn: string; wsOther: string; taskOther: string };

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { slug: `r-${Date.now()}`, name: 'R' } });
  const user = await prisma.user.create({
    data: { orgId: org.id, name: 'L', email: `l-${Date.now()}@x.test`, passwordHash: 'x', isActive: true },
  });
  const project = await prisma.project.create({ data: { orgId: org.id, name: 'P' } });
  const wsOwn = await prisma.workstream.create({ data: { projectId: project.id, name: 'Mkt' } });
  const wsOther = await prisma.workstream.create({ data: { projectId: project.id, name: 'Ops' } });
  const member = await prisma.projectMember.create({
    data: { projectId: project.id, userId: user.id, role: 'LEAD', memberLabel: 'L' },
  });
  await prisma.memberWorkstream.create({ data: { projectMemberId: member.id, workstreamId: wsOwn.id } });
  const taskOther = await prisma.task.create({
    data: {
      projectId: project.id,
      workstreamId: wsOther.id,
      code: `T${Date.now()}`,
      title: 'x',
      status: 'NOT_STARTED',
      priority: 'MEDIUM',
    },
  });
  ids = {
    org: org.id,
    project: project.id,
    user: user.id,
    wsOwn: wsOwn.id,
    wsOther: wsOther.id,
    taskOther: taskOther.id,
  };
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { projectId: ids.project } });
  await prisma.memberWorkstream.deleteMany({ where: { workstream: { projectId: ids.project } } });
  await prisma.workstream.deleteMany({ where: { projectId: ids.project } });
  await prisma.projectMember.deleteMany({ where: { projectId: ids.project } });
  await prisma.project.delete({ where: { id: ids.project } });
  await prisma.user.delete({ where: { id: ids.user } });
  await prisma.organization.delete({ where: { id: ids.org } });
  await prisma.$disconnect();
});

describe('rbac scope', () => {
  it('LEAD can EDIT_TASK in own workstream', async () => {
    const ctx = { userId: ids.user, orgId: ids.org };
    await expect(assertCan(ctx, 'EDIT_TASK', ids.project, { workstreamId: ids.wsOwn })).resolves.toBe('LEAD');
  });
  it('LEAD is FORBIDDEN editing a task in another workstream', async () => {
    const ctx = { userId: ids.user, orgId: ids.org };
    expect(await can(ctx, 'EDIT_TASK', ids.project, { taskId: ids.taskOther })).toBe(false);
  });
});
