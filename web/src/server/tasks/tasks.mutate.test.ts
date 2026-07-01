/**
 * Integration tests for tasks service mutations:
 * update / updateProgress / delete / setAssignments / setTaskDependencies.
 *
 * TDD: written as part of Task 2.6 — run RED before implementations, GREEN after.
 *
 * Covers:
 *  - updateTask: setting COMPLETED forces percent=100 and writes a task.updated audit row
 *  - updateTask: contradictory (COMPLETED + percent=50) → BadRequest
 *  - updateTaskProgress: a MEMBER assignee can update their task
 *  - updateTaskProgress: a MEMBER non-assignee is Forbidden
 *  - setTaskAssignments: replace-all works
 *  - setTaskDependencies: self-edge is silently dropped
 *  - setTaskDependencies: a dependency cycle (A→B then B→A) → BadRequest
 *  - deleteTask: removes task; subsequent getTask throws NotFound
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import {
  createTask,
  deleteTask,
  getTask,
  setTaskAssignments,
  setTaskDependencies,
  updateTask,
  updateTaskProgress,
} from './tasks';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerUserId: string;
let memberUserId: string;
let nonAssigneeUserId: string;
let pid: string;
let taskA: string; // used for cycle tests
let taskB: string;
let taskIdForUpdate: string;
let taskIdForProgress: string;
let taskIdForDelete: string;
let taskIdForAssignments: string;
let ownerCtx: AuthContext;
let memberCtx: AuthContext;
let nonAssigneeCtx: AuthContext;

const TS = Date.now();

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { slug: `mutate-${TS}`, name: 'MutateOrg' },
  });
  orgId = org.id;

  ownerUserId = (
    await prisma.user.create({
      data: {
        orgId,
        name: 'Owner',
        email: `mut-owner-${TS}@x.test`,
        passwordHash: 'x',
        isActive: true,
      },
    })
  ).id;

  memberUserId = (
    await prisma.user.create({
      data: {
        orgId,
        name: 'Member',
        email: `mut-member-${TS}@x.test`,
        passwordHash: 'x',
        isActive: true,
      },
    })
  ).id;

  nonAssigneeUserId = (
    await prisma.user.create({
      data: {
        orgId,
        name: 'NonAssignee',
        email: `mut-nonassignee-${TS}@x.test`,
        passwordHash: 'x',
        isActive: true,
      },
    })
  ).id;

  const project = await prisma.project.create({
    data: {
      orgId,
      name: `MutateProject-${TS}`,
      budgetCapVnd: BigInt(0),
      createdById: ownerUserId,
    },
  });
  pid = project.id;

  // Project members
  await prisma.projectMember.create({
    data: { projectId: pid, userId: ownerUserId, role: 'OWNER' },
  });
  const memberRecord = await prisma.projectMember.create({
    data: {
      projectId: pid,
      userId: memberUserId,
      role: 'MEMBER',
      memberLabel: `member-label-${TS}`,
    },
  });
  await prisma.projectMember.create({
    data: { projectId: pid, userId: nonAssigneeUserId, role: 'MEMBER' },
  });

  ownerCtx = { userId: ownerUserId, orgId };
  memberCtx = { userId: memberUserId, orgId };
  nonAssigneeCtx = { userId: nonAssigneeUserId, orgId };

  // Seed reusable tasks
  const minDto = {
    title: 'Task A',
    priority: 'MEDIUM' as const,
    status: 'NOT_STARTED' as const,
    percent: 0,
    budgetVnd: 0,
    actualVnd: 0,
  };

  const tA = await createTask(ownerCtx, pid, { ...minDto, title: 'Task A', code: `TSTA-${TS}` } as any, null);
  taskA = tA.id;

  const tB = await createTask(ownerCtx, pid, { ...minDto, title: 'Task B', code: `TSTB-${TS}` } as any, null);
  taskB = tB.id;

  const tUpd = await createTask(ownerCtx, pid, { ...minDto, title: 'Update Task', code: `TUPD-${TS}` } as any, null);
  taskIdForUpdate = tUpd.id;

  const tProg = await createTask(ownerCtx, pid, { ...minDto, title: 'Progress Task', code: `TPRG-${TS}` } as any, null);
  taskIdForProgress = tProg.id;

  const tDel = await createTask(ownerCtx, pid, { ...minDto, title: 'Delete Task', code: `TDEL-${TS}` } as any, null);
  taskIdForDelete = tDel.id;

  const tAssign = await createTask(ownerCtx, pid, { ...minDto, title: 'Assign Task', code: `TASGN-${TS}` } as any, null);
  taskIdForAssignments = tAssign.id;

  // Assign memberUser to taskIdForProgress by their memberLabel
  await prisma.taskAssignment.create({
    data: {
      taskId: taskIdForProgress,
      userId: memberUserId,
      label: memberRecord.memberLabel!,
      role: 'IN_CHARGE',
    },
  });
});

afterAll(async () => {
  // Clean up in FK-safe order
  await prisma.taskDependency.deleteMany({ where: { task: { projectId: pid } } });
  await prisma.taskAssignment.deleteMany({ where: { task: { projectId: pid } } });
  await prisma.auditLog.deleteMany({ where: { projectId: pid } });
  await prisma.task.deleteMany({ where: { projectId: pid } });
  await prisma.memberWorkstream.deleteMany({ where: { projectMember: { projectId: pid } } });
  await prisma.projectMember.deleteMany({ where: { projectId: pid } });
  await prisma.project.deleteMany({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────── updateTask tests ─────

describe('updateTask', () => {
  it('setting COMPLETED forces percent=100 and writes a task.updated audit row', async () => {
    const t = await updateTask(
      ownerCtx,
      taskIdForUpdate,
      { status: 'COMPLETED' } as any,
      null,
    );
    expect(t.percent).toBe(100);
    expect(t.status).toBe('COMPLETED');

    const auditRow = await prisma.auditLog.findFirst({
      where: { entityId: taskIdForUpdate, action: 'task.updated' },
    });
    expect(auditRow).toBeTruthy();
  });

  it('contradictory update (COMPLETED + percent=50) → BadRequest', async () => {
    // Use taskA (NOT_STARTED) — taskIdForUpdate is now COMPLETED, same logic applies
    await expect(
      updateTask(
        ownerCtx,
        taskA,
        { status: 'COMPLETED', percent: 50 } as any,
        null,
      ),
    ).rejects.toThrow(/status and percent are inconsistent/i);
  });

  it('updates title without touching status/percent', async () => {
    const t = await updateTask(
      ownerCtx,
      taskB,
      { title: 'Updated Title B' } as any,
      null,
    );
    expect(t.title).toBe('Updated Title B');
  });
});

// ─────────────────────────────────────────────────── updateTaskProgress tests ─

describe('updateTaskProgress', () => {
  it('MEMBER who is an assignee can update progress on their task', async () => {
    const t = await updateTaskProgress(
      memberCtx,
      taskIdForProgress,
      { percent: 50 } as any,
      null,
    );
    expect(t.percent).toBe(50);
    expect(t.status).toBe('IN_PROGRESS');
  });

  it('MEMBER non-assignee is Forbidden on another task', async () => {
    // nonAssigneeUserId is a MEMBER but not assigned to taskA
    await expect(
      updateTaskProgress(
        nonAssigneeCtx,
        taskA,
        { percent: 10 } as any,
        null,
      ),
    ).rejects.toThrow(/forbidden|scope|cannot/i);
  });

  it('writes a task.progress audit row', async () => {
    await updateTaskProgress(memberCtx, taskIdForProgress, { percent: 60 } as any, null);
    const auditRow = await prisma.auditLog.findFirst({
      where: { entityId: taskIdForProgress, action: 'task.progress' },
    });
    expect(auditRow).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────── setTaskAssignments tests ─

describe('setTaskAssignments', () => {
  it('replaces all assignments with new ones', async () => {
    const t = await setTaskAssignments(
      ownerCtx,
      taskIdForAssignments,
      {
        assignments: [
          { label: 'Alice', role: 'IN_CHARGE' },
          { label: 'Bob', role: 'SUPPORT' },
        ],
      } as any,
      null,
    );
    expect(t.assignments).toHaveLength(2);
    const labels = t.assignments!.map((a) => a.label).sort();
    expect(labels).toEqual(['Alice', 'Bob']);
  });

  it('can clear all assignments (empty array)', async () => {
    const t = await setTaskAssignments(
      ownerCtx,
      taskIdForAssignments,
      { assignments: [] } as any,
      null,
    );
    expect(t.assignments).toHaveLength(0);
  });
});

// ────────────────────────────────────────────── setTaskDependencies tests ─────

describe('setTaskDependencies', () => {
  it('self-edge (taskA depends on taskA) is silently dropped', async () => {
    const t = await setTaskDependencies(
      ownerCtx,
      taskA,
      { dependsOnTaskIds: [taskA] } as any,
      null,
    );
    // Self-edge filtered, so no deps
    expect(t.dependsOnTaskIds ?? []).not.toContain(taskA);
  });

  it('sets a valid dependency (A depends on B)', async () => {
    // Reset taskA deps first
    await setTaskDependencies(ownerCtx, taskA, { dependsOnTaskIds: [] } as any, null);

    const t = await setTaskDependencies(
      ownerCtx,
      taskA,
      { dependsOnTaskIds: [taskB] } as any,
      null,
    );
    expect(t.dependsOnTaskIds).toContain(taskB);
  });

  it('dependency cycle (A depends on B, then B depends on A) → BadRequest', async () => {
    // Ensure A→B is set
    await setTaskDependencies(ownerCtx, taskA, { dependsOnTaskIds: [taskB] } as any, null);
    // B→A would close the loop
    await expect(
      setTaskDependencies(ownerCtx, taskB, { dependsOnTaskIds: [taskA] } as any, null),
    ).rejects.toThrow(/cycle/i);
  });

  it('rejects dep IDs that do not belong to the same project', async () => {
    await expect(
      setTaskDependencies(
        ownerCtx,
        taskB,
        { dependsOnTaskIds: ['cuid-from-another-project'] } as any,
        null,
      ),
    ).rejects.toThrow(/project/i);
  });
});

// ──────────────────────────────────────────────────── deleteTask tests ────────

describe('deleteTask', () => {
  it('deletes the task; subsequent getTask throws NotFound', async () => {
    await deleteTask(ownerCtx, taskIdForDelete, null);
    await expect(getTask(ownerCtx, taskIdForDelete)).rejects.toThrow(/not found/i);
  });

  it('throws NotFound for an already-deleted (non-existent) task', async () => {
    await expect(deleteTask(ownerCtx, 'does-not-exist', null)).rejects.toThrow(/not found/i);
  });
});
