/**
 * Integration tests for milestones service functions.
 * TDD: written before implementation — expect RED first, then GREEN after milestones.ts.
 *
 * Load-bearing cases:
 *  - GATE: OWNER can setMilestoneStatus on any gate.
 *  - GATE: LEAD is Forbidden when gate spans a workstream they do NOT own.
 *  - GATE: LEAD CAN setMilestoneStatus when all criteria.taskIds are in their owned workstream.
 *  - generateFromPhases is idempotent (2nd run: created=0, updated=same as 1st).
 *  - createMilestone with a foreign taskId → BadRequest.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import {
  listMilestones,
  getMilestone,
  createMilestone,
  generateFromPhases,
  updateMilestone,
  setMilestoneStatus,
  deleteMilestone,
} from './milestones';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerUserId: string;
let leadUserId: string;
let pid: string;
let wsAId: string; // workstream A — owned by LEAD
let wsBId: string; // workstream B — NOT owned by LEAD
let tAId: string; // task in workstream A
let tBId: string; // task in workstream B
let gateAllId: string; // GATE milestone: criteria=[tA, tB] (spans A+B)
let gateOwnId: string; // GATE milestone: criteria=[tA] (only A)
let ownerCtx: AuthContext;
let leadCtx: AuthContext;

// A separate project for the "foreign taskId" test
let otherPid: string;
let otherOwnerId: string;

beforeAll(async () => {
  const ts = Date.now();

  const org = await prisma.organization.create({
    data: { slug: `ms-${ts}`, name: 'MilestoneOrg' },
  });
  orgId = org.id;

  ownerUserId = (
    await prisma.user.create({
      data: { orgId, name: 'MSOwner', email: `ms-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  leadUserId = (
    await prisma.user.create({
      data: { orgId, name: 'MSLead', email: `ms-lead-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: {
      orgId,
      name: `MSProject-${ts}`,
      budgetCapVnd: BigInt(0),
      createdById: ownerUserId,
    },
  });
  pid = project.id;

  // OWNER member
  await prisma.projectMember.create({ data: { projectId: pid, userId: ownerUserId, role: 'OWNER' } });

  // LEAD member
  const leadMember = await prisma.projectMember.create({
    data: { projectId: pid, userId: leadUserId, role: 'LEAD' },
  });

  // Workstreams
  const wsA = await prisma.workstream.create({
    data: { projectId: pid, name: `WS-A-${ts}`, track: 'MARKETING', order: 0 },
  });
  wsAId = wsA.id;
  const wsB = await prisma.workstream.create({
    data: { projectId: pid, name: `WS-B-${ts}`, track: 'OPERATIONS', order: 1 },
  });
  wsBId = wsB.id;

  // LEAD owns workstream A only
  await prisma.memberWorkstream.create({
    data: { projectMemberId: leadMember.id, workstreamId: wsAId },
  });

  // Tasks
  const taskA = await prisma.task.create({
    data: {
      projectId: pid,
      code: `MST-A-${ts}`,
      title: 'Task in WS-A',
      priority: 'MEDIUM',
      status: 'NOT_STARTED',
      percent: 0,
      workstreamId: wsAId,
      createdById: ownerUserId,
      updatedById: ownerUserId,
    },
  });
  tAId = taskA.id;

  const taskB = await prisma.task.create({
    data: {
      projectId: pid,
      code: `MST-B-${ts}`,
      title: 'Task in WS-B',
      priority: 'MEDIUM',
      status: 'NOT_STARTED',
      percent: 0,
      workstreamId: wsBId,
      createdById: ownerUserId,
      updatedById: ownerUserId,
    },
  });
  tBId = taskB.id;

  // GATE milestones
  const gateAll = await prisma.milestone.create({
    data: {
      projectId: pid,
      name: 'Gate All',
      type: 'GATE',
      status: 'PENDING',
      criteria: { taskIds: [tAId, tBId] },
    },
  });
  gateAllId = gateAll.id;

  const gateOwn = await prisma.milestone.create({
    data: {
      projectId: pid,
      name: 'Gate Own',
      type: 'GATE',
      status: 'PENDING',
      criteria: { taskIds: [tAId] },
    },
  });
  gateOwnId = gateOwn.id;

  ownerCtx = { userId: ownerUserId, orgId };
  leadCtx = { userId: leadUserId, orgId };

  // A separate project + user for the "foreign taskId" test
  otherOwnerId = (
    await prisma.user.create({
      data: { orgId, name: 'OtherOwner', email: `ms-other-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;
  const otherProject = await prisma.project.create({
    data: {
      orgId,
      name: `OtherProject-${ts}`,
      budgetCapVnd: BigInt(0),
      createdById: otherOwnerId,
    },
  });
  otherPid = otherProject.id;
  await prisma.projectMember.create({ data: { projectId: otherPid, userId: otherOwnerId, role: 'OWNER' } });
  await prisma.projectMember.create({ data: { projectId: otherPid, userId: ownerUserId, role: 'OWNER' } });
});

afterAll(async () => {
  // Clean up by deleting the created projects (cascade deletes everything)
  await prisma.project.deleteMany({ where: { id: { in: [pid, otherPid] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, leadUserId, otherOwnerId] } } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

// ─── list / get ───────────────────────────────────────────────────────────────

describe('listMilestones', () => {
  it('returns all milestones with hydration fields', async () => {
    const list = await listMilestones(ownerCtx, pid);
    expect(list.length).toBeGreaterThanOrEqual(2);
    const gate = list.find((m) => m.id === gateAllId);
    expect(gate).toBeDefined();
    // Two tasks in criteria, none completed → 0%
    expect(gate!.readinessPct).toBe(0);
    expect(gate!.totalCount).toBe(2);
    expect(gate!.completedCount).toBe(0);
  });

  it('LEAD can list (VIEW_PROJECT)', async () => {
    const list = await listMilestones(leadCtx, pid);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });
});

describe('getMilestone', () => {
  it('returns a single milestone with hydration', async () => {
    const m = await getMilestone(ownerCtx, gateOwnId);
    expect(m.id).toBe(gateOwnId);
    expect(m.criteria?.taskIds).toContain(tAId);
    expect(m.totalCount).toBe(1);
  });

  it('throws NotFound for unknown id', async () => {
    await expect(getMilestone(ownerCtx, 'cuid-does-not-exist')).rejects.toThrow(/not found/i);
  });
});

// ─── THE GATE ─────────────────────────────────────────────────────────────────

describe('setMilestoneStatus — gate RBAC', () => {
  it('OWNER can set status on gateAll (spans both workstreams)', async () => {
    await expect(
      setMilestoneStatus(ownerCtx, gateAllId, { status: 'PASSED' }, null),
    ).resolves.toBeTruthy();
    // reset for subsequent tests
    await prisma.milestone.update({ where: { id: gateAllId }, data: { status: 'PENDING' } });
  });

  it('LEAD is Forbidden on gateAll (gate spans workstream B, LEAD does not own B)', async () => {
    await expect(
      setMilestoneStatus(leadCtx, gateAllId, { status: 'PASSED' }, null),
    ).rejects.toThrow(/forbidden|scope|cannot/i);
  });

  it('LEAD can set status on gateOwn (gate only spans workstream A, which LEAD owns)', async () => {
    await expect(
      setMilestoneStatus(leadCtx, gateOwnId, { status: 'PASSED' }, null),
    ).resolves.toBeTruthy();
    // reset for subsequent tests
    await prisma.milestone.update({ where: { id: gateOwnId }, data: { status: 'PENDING' } });
  });
});

// ─── createMilestone ──────────────────────────────────────────────────────────

describe('createMilestone', () => {
  it('creates a milestone and returns hydrated DTO', async () => {
    const m = await createMilestone(
      ownerCtx,
      pid,
      { name: 'New Milestone', type: 'MILESTONE', status: 'PENDING' },
      null,
    );
    expect(m.id).toBeTruthy();
    expect(m.name).toBe('New Milestone');
    expect(m.readinessPct).toBeNull();
    // cleanup
    await prisma.milestone.delete({ where: { id: m.id } });
  });

  it('throws BadRequest when criteria.taskIds contains a foreign taskId', async () => {
    // Create a task in the OTHER project
    const foreignTask = await prisma.task.create({
      data: {
        projectId: otherPid,
        code: `FOREIGN-${Date.now()}`,
        title: 'Foreign Task',
        priority: 'MEDIUM',
        status: 'NOT_STARTED',
        percent: 0,
        createdById: otherOwnerId,
        updatedById: otherOwnerId,
      },
    });
    await expect(
      createMilestone(
        ownerCtx,
        pid,
        { name: 'Bad Milestone', type: 'GATE', status: 'PENDING', criteria: { taskIds: [foreignTask.id] } },
        null,
      ),
    ).rejects.toThrow(/criteria\.taskIds|project/i);
    // cleanup
    await prisma.task.delete({ where: { id: foreignTask.id } });
  });
});

// ─── generateFromPhases ───────────────────────────────────────────────────────

describe('generateFromPhases', () => {
  let phaseId: string;

  beforeAll(async () => {
    const ts = Date.now();
    // Create a phase with tasks so generateFromPhases has something to do
    const phase = await prisma.phase.create({
      data: { projectId: pid, name: `Phase-Gen-${ts}`, order: 0 },
    });
    phaseId = phase.id;
    // Link existing tasks to this phase
    await prisma.task.updateMany({
      where: { id: { in: [tAId, tBId] } },
      data: { phaseId: phase.id },
    });
  });

  afterAll(async () => {
    // Unlink tasks from phase, delete generated milestones, delete phase
    await prisma.task.updateMany({
      where: { id: { in: [tAId, tBId] } },
      data: { phaseId: null },
    });
    await prisma.milestone.deleteMany({
      where: { projectId: pid, id: { notIn: [gateAllId, gateOwnId] } },
    });
    await prisma.phase.delete({ where: { id: phaseId } });
  });

  it('first run: creates milestones from phases', async () => {
    const first = await generateFromPhases(ownerCtx, pid, null);
    expect(first.created).toBeGreaterThan(0);
    expect(first.total).toBe(first.created + first.updated);
  });

  it('second run: idempotent — created=0, updated=same as first', async () => {
    const second = await generateFromPhases(ownerCtx, pid, null);
    expect(second.created).toBe(0);
    expect(second.updated).toBeGreaterThan(0);
  });
});

// ─── updateMilestone ──────────────────────────────────────────────────────────

describe('updateMilestone', () => {
  it('updates name and returns hydrated DTO', async () => {
    const m = await createMilestone(
      ownerCtx,
      pid,
      { name: 'Update Me', type: 'MILESTONE', status: 'PENDING' },
      null,
    );
    const updated = await updateMilestone(ownerCtx, m.id, { name: 'Updated Name' }, null);
    expect(updated.name).toBe('Updated Name');
    // cleanup
    await prisma.milestone.delete({ where: { id: m.id } });
  });

  it('throws NotFound for unknown id', async () => {
    await expect(updateMilestone(ownerCtx, 'nonexistent-cuid', { name: 'X' }, null)).rejects.toThrow(
      /not found/i,
    );
  });
});

// ─── deleteMilestone ──────────────────────────────────────────────────────────

describe('deleteMilestone', () => {
  it('deletes successfully', async () => {
    const m = await createMilestone(
      ownerCtx,
      pid,
      { name: 'To Delete', type: 'MILESTONE', status: 'PENDING' },
      null,
    );
    await expect(deleteMilestone(ownerCtx, m.id, null)).resolves.toBeUndefined();
    // Verify gone
    const row = await prisma.milestone.findUnique({ where: { id: m.id } });
    expect(row).toBeNull();
  });
});
