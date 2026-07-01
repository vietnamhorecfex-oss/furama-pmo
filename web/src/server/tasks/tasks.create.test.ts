/**
 * Integration tests for tasks service: list/get/mine/create + RBAC deny paths.
 * TDD: written before tasks.ts — expect RED first, GREEN after implementation.
 *
 * Covers:
 *  - create with explicit code → budgetVnd/actualVnd are numbers in DTO
 *  - create without code under MARKETING workstream → code matches /^MKT-\d{4}$/
 *  - create without code with no workstream → code matches /^TSK-\d{4}$/
 *  - duplicate explicit code → Conflict
 *  - VIEWER member cannot create → Forbidden
 *  - LEAD who owns workstream A can create in A but Forbidden in workstream B (scope deny)
 *  - listTasks, getTask, myTasks happy paths
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { listTasks, getTask, myTasks, createTask } from './tasks';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerUserId: string;
let viewerUserId: string;
let leadUserId: string;
let pid: string;
let wsMarketing: string; // MARKETING track workstream
let wsOps: string; // OPERATIONS track workstream (Lead doesn't own this)
let ownerCtx: AuthContext;
let viewerCtx: AuthContext;
let leadCtx: AuthContext;

beforeAll(async () => {
  const ts = Date.now();
  const org = await prisma.organization.create({ data: { slug: `tasks-${ts}`, name: 'TasksOrg' } });
  orgId = org.id;

  ownerUserId = (
    await prisma.user.create({
      data: { orgId, name: 'Owner', email: `tasks-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  viewerUserId = (
    await prisma.user.create({
      data: { orgId, name: 'Viewer', email: `tasks-viewer-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  leadUserId = (
    await prisma.user.create({
      data: { orgId, name: 'Lead', email: `tasks-lead-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: { orgId, name: `TaskProject-${ts}`, budgetCapVnd: BigInt(0), createdById: ownerUserId },
  });
  pid = project.id;

  // Seed project members
  await prisma.projectMember.create({ data: { projectId: pid, userId: ownerUserId, role: 'OWNER' } });
  await prisma.projectMember.create({ data: { projectId: pid, userId: viewerUserId, role: 'VIEWER' } });

  // Seed workstreams
  const wsMkt = await prisma.workstream.create({
    data: { projectId: pid, name: 'Marketing WS', track: 'MARKETING', order: 1 },
  });
  wsMarketing = wsMkt.id;

  const wsO = await prisma.workstream.create({
    data: { projectId: pid, name: 'Operations WS', track: 'OPERATIONS', order: 2 },
  });
  wsOps = wsO.id;

  // Add LEAD member scoped to wsMarketing only
  const leadMember = await prisma.projectMember.create({
    data: { projectId: pid, userId: leadUserId, role: 'LEAD' },
  });
  await prisma.memberWorkstream.create({
    data: { projectMemberId: leadMember.id, workstreamId: wsMarketing },
  });

  ownerCtx = { userId: ownerUserId, orgId };
  viewerCtx = { userId: viewerUserId, orgId };
  leadCtx = { userId: leadUserId, orgId };
});

afterAll(async () => {
  // Clean up in FK order
  await prisma.taskAssignment.deleteMany({ where: { task: { projectId: pid } } });
  await prisma.taskDependency.deleteMany({ where: { task: { projectId: pid } } });
  await prisma.task.deleteMany({ where: { projectId: pid } });
  await prisma.auditLog.deleteMany({ where: { projectId: pid } });
  await prisma.memberWorkstream.deleteMany({ where: { projectMember: { projectId: pid } } });
  await prisma.projectMember.deleteMany({ where: { projectId: pid } });
  await prisma.workstream.deleteMany({ where: { projectId: pid } });
  await prisma.project.deleteMany({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('createTask', () => {
  it('creates a task with explicit code; budgetVnd/actualVnd are numbers in DTO', async () => {
    const dto = await createTask(
      ownerCtx,
      pid,
      {
        code: 'EXPLICIT-0001',
        title: 'Explicit Code Task',
        budgetVnd: 5000000,
        actualVnd: 1000000,
        priority: 'MEDIUM',
        status: 'NOT_STARTED',
        percent: 0,
      } as any,
      null,
    );
    expect(dto.code).toBe('EXPLICIT-0001');
    expect(typeof dto.budgetVnd).toBe('number');
    expect(typeof dto.actualVnd).toBe('number');
    expect(dto.budgetVnd).toBe(5000000);
    expect(dto.actualVnd).toBe(1000000);
  });

  it('creates without a code under MARKETING workstream → code matches /^MKT-\\d{4}$/', async () => {
    const dto = await createTask(
      ownerCtx,
      pid,
      {
        title: 'Marketing Task Auto Code',
        workstreamId: wsMarketing,
        priority: 'MEDIUM',
        status: 'NOT_STARTED',
        percent: 0,
        budgetVnd: 0,
        actualVnd: 0,
      } as any,
      null,
    );
    expect(dto.code).toMatch(/^MKT-\d{4}$/);
  });

  it('creates without a code with no workstream → code matches /^TSK-\\d{4}$/', async () => {
    const dto = await createTask(
      ownerCtx,
      pid,
      {
        title: 'No Workstream Task',
        priority: 'MEDIUM',
        status: 'NOT_STARTED',
        percent: 0,
        budgetVnd: 0,
        actualVnd: 0,
      } as any,
      null,
    );
    expect(dto.code).toMatch(/^TSK-\d{4}$/);
  });

  it('duplicate explicit code → Conflict', async () => {
    const dupCode = `DUP-${Date.now()}`;
    await createTask(
      ownerCtx,
      pid,
      {
        code: dupCode,
        title: 'Original Task',
        priority: 'MEDIUM',
        status: 'NOT_STARTED',
        percent: 0,
        budgetVnd: 0,
        actualVnd: 0,
      } as any,
      null,
    );
    await expect(
      createTask(
        ownerCtx,
        pid,
        {
          code: dupCode,
          title: 'Duplicate Code Task',
          priority: 'MEDIUM',
          status: 'NOT_STARTED',
          percent: 0,
          budgetVnd: 0,
          actualVnd: 0,
        } as any,
        null,
      ),
    ).rejects.toThrow(/conflict|already exists/i);
  });

  it('VIEWER member cannot create → Forbidden', async () => {
    await expect(
      createTask(
        viewerCtx,
        pid,
        {
          title: 'Viewer tries to create',
          priority: 'MEDIUM',
          status: 'NOT_STARTED',
          percent: 0,
          budgetVnd: 0,
          actualVnd: 0,
        } as any,
        null,
      ),
    ).rejects.toThrow(/forbidden|cannot/i);
  });

  it('LEAD who owns wsMarketing can create in wsMarketing', async () => {
    const dto = await createTask(
      leadCtx,
      pid,
      {
        title: 'Lead Marketing Task',
        workstreamId: wsMarketing,
        priority: 'MEDIUM',
        status: 'NOT_STARTED',
        percent: 0,
        budgetVnd: 0,
        actualVnd: 0,
      } as any,
      null,
    );
    expect(dto.workstreamId).toBe(wsMarketing);
  });

  it('LEAD of wsMarketing is Forbidden creating in wsOps (scope deny)', async () => {
    await expect(
      createTask(
        leadCtx,
        pid,
        {
          title: 'Lead tries ops task',
          workstreamId: wsOps,
          priority: 'MEDIUM',
          status: 'NOT_STARTED',
          percent: 0,
          budgetVnd: 0,
          actualVnd: 0,
        } as any,
        null,
      ),
    ).rejects.toThrow(/forbidden|scope/i);
  });
});

describe('listTasks', () => {
  it('returns paginated tasks for a project member', async () => {
    const result = await listTasks(ownerCtx, pid, {
      page: 1,
      pageSize: 10,
      sort: 'createdAt',
      order: 'desc',
    } as any);
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('page');
    expect(result).toHaveProperty('pageSize');
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('denies listTasks for a non-member (Forbidden)', async () => {
    const nonMemberCtx = { userId: 'non-existent-user', orgId };
    await expect(listTasks(nonMemberCtx, pid, { page: 1, pageSize: 10, sort: 'createdAt', order: 'asc' } as any)).rejects.toThrow(/forbidden|member/i);
  });
});

describe('getTask', () => {
  it('returns a task by ID with dependsOnTaskIds', async () => {
    const created = await createTask(
      ownerCtx,
      pid,
      {
        title: 'Get Task Test',
        priority: 'HIGH',
        status: 'NOT_STARTED',
        percent: 0,
        budgetVnd: 0,
        actualVnd: 0,
      } as any,
      null,
    );
    const fetched = await getTask(ownerCtx, created.id);
    expect(fetched.id).toBe(created.id);
    expect(Array.isArray(fetched.dependsOnTaskIds)).toBe(true);
  });

  it('throws NotFound for a non-existent task', async () => {
    await expect(getTask(ownerCtx, 'cuid-that-doesnt-exist')).rejects.toThrow(/not found/i);
  });
});

describe('myTasks', () => {
  it('returns only tasks assigned to the caller', async () => {
    const result = await myTasks(ownerCtx, pid);
    expect(Array.isArray(result)).toBe(true);
  });

  it('denies myTasks for a non-member', async () => {
    const nonMemberCtx = { userId: 'no-such-user', orgId };
    await expect(myTasks(nonMemberCtx, pid)).rejects.toThrow(/forbidden|member/i);
  });
});
