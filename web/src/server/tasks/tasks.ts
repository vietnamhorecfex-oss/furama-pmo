/**
 * web/server port of backend TasksService — parts 1 & 2.
 * (backend/src/tasks/tasks.service.ts lines ~66–209, ~212–472)
 *
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - BadRequestException/ConflictException/NotFoundException → BadRequest/Conflict/NotFound from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.audit.record → auditRecord from ../audit/audit
 *  - this.realtime.emit → DROPPED (comment: realtime polling in Phase 5)
 *
 * Part 1 (list/get/myTasks/create): Task 2.5
 * Part 2 (update/progress/delete/assignments/dependencies): Task 2.6
 */
import type { Prisma, Task, TaskAssignment } from '@prisma/client';
import type {
  CreateTaskDto,
  ListTasksQuery,
  ProgressUpdateDto,
  SetAssignmentsDto,
  SetDependenciesDto,
  TaskDto,
  UpdateTaskDto,
} from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { BadRequest, Conflict, NotFound } from '../http/errors';
import { moneyToNumber } from '../http/serialize';
import type { Paginated } from '../http/serialize';
import { applyTaskInvariants } from './task-invariants';

const SORTABLE_FIELDS = new Set([
  'code',
  'title',
  'priority',
  'status',
  'deadline',
  'startDate',
  'updatedAt',
  'createdAt',
  'percent',
]);

/**
 * Guard that any provided phase / workstream / budget-category FK belongs to `projectId`.
 * Prisma `connect`/scalar FKs only require the row to exist, so without this a caller could
 * attach a task to ANOTHER project's phase/workstream/category — corrupting that project's
 * budget rollups and phase/workstream references. Throws BadRequest on a mismatch (was a raw
 * P2025/P2003 → 500). Only truthy ids are checked; null/undefined (disconnect / unchanged) skip.
 */
async function assertRefsInProject(
  projectId: string,
  refs: { phaseId?: string | null; workstreamId?: string | null; budgetCategoryId?: string | null },
): Promise<void> {
  const checks: Array<Promise<void>> = [];
  if (refs.phaseId) {
    checks.push(
      prisma.phase.count({ where: { id: refs.phaseId, projectId } }).then((n) => {
        if (n === 0) throw new BadRequest('phaseId does not belong to this project');
      }),
    );
  }
  if (refs.workstreamId) {
    checks.push(
      prisma.workstream.count({ where: { id: refs.workstreamId, projectId } }).then((n) => {
        if (n === 0) throw new BadRequest('workstreamId does not belong to this project');
      }),
    );
  }
  if (refs.budgetCategoryId) {
    checks.push(
      prisma.budgetCategory.count({ where: { id: refs.budgetCategoryId, projectId } }).then((n) => {
        if (n === 0) throw new BadRequest('budgetCategoryId does not belong to this project');
      }),
    );
  }
  await Promise.all(checks);
}

// ────────────────────────────────────────────────────────────────── READ ──────

export async function listTasks(
  ctx: AuthContext,
  projectId: string,
  q: ListTasksQuery,
): Promise<Paginated<TaskDto>> {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);

  const where: Prisma.TaskWhereInput = {
    projectId,
    ...(q.phaseId ? { phaseId: q.phaseId } : {}),
    ...(q.workstreamId ? { workstreamId: q.workstreamId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.priority ? { priority: q.priority } : {}),
    ...(q.assignee
      ? { assignments: { some: { label: { contains: q.assignee, mode: 'insensitive' } } } }
      : {}),
    ...(q.q
      ? {
          OR: [
            { title: { contains: q.q, mode: 'insensitive' } },
            { code: { contains: q.q, mode: 'insensitive' } },
            { description: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.TaskOrderByWithRelationInput = {
    [q.sort && SORTABLE_FIELDS.has(q.sort) ? q.sort : 'createdAt']: q.order,
  } as Prisma.TaskOrderByWithRelationInput;

  const [total, rows] = await prisma.$transaction([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { assignments: true },
    }),
  ]);

  return {
    data: rows.map((r) => toTaskDto(r, r.assignments)),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

export async function getTask(ctx: AuthContext, taskId: string): Promise<TaskDto> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignments: true,
      dependencies: { select: { dependsOnTaskId: true } },
    },
  });
  if (!task) throw new NotFound('Task not found');
  await assertCan(ctx, 'VIEW_PROJECT', task.projectId);
  return toTaskDto(task, task.assignments, task.dependencies.map((d) => d.dependsOnTaskId));
}

export async function myTasks(ctx: AuthContext, projectId: string): Promise<TaskDto[]> {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);

  const member = await prisma.projectMember.findFirst({
    where: { userId: ctx.userId, projectId },
    select: { memberLabel: true },
  });

  const labelClause: Prisma.TaskAssignmentWhereInput = member?.memberLabel
    ? { OR: [{ userId: ctx.userId }, { label: member.memberLabel }] }
    : { userId: ctx.userId };

  const rows = await prisma.task.findMany({
    where: { projectId, assignments: { some: labelClause } },
    include: { assignments: true },
    orderBy: [{ deadline: 'asc' }, { createdAt: 'asc' }],
  });

  return rows.map((r) => toTaskDto(r, r.assignments));
}

// ──────────────────────────────────────────────────────────────── CREATE ──────

export async function createTask(
  ctx: AuthContext,
  projectId: string,
  dto: CreateTaskDto,
  ip: string | null,
): Promise<TaskDto> {
  // For LEAD scope, the workstream the task is being created in must be the LEAD's.
  await assertCan(ctx, 'CREATE_TASK', projectId, {
    workstreamId: dto.workstreamId ?? null,
  });

  await assertRefsInProject(projectId, {
    phaseId: dto.phaseId,
    workstreamId: dto.workstreamId,
    budgetCategoryId: dto.budgetCategoryId,
  });

  if (dto.startDate && dto.deadline && new Date(dto.startDate) > new Date(dto.deadline)) {
    throw new BadRequest('deadline must be on or after startDate');
  }

  const code =
    dto.code?.trim() || (await generateCode(projectId, dto.workstreamId ?? null));

  const created = await prisma.$transaction(async (tx) => {
    // Unique guard on (projectId, code).
    const dup = await tx.task.findFirst({
      where: { projectId, code },
      select: { id: true },
    });
    if (dup) throw new Conflict(`Task code "${code}" already exists in this project`);

    const row = await tx.task.create({
      data: {
        projectId,
        code,
        title: dto.title,
        description: dto.description ?? null,
        phaseId: dto.phaseId ?? null,
        workstreamId: dto.workstreamId ?? null,
        category: dto.category ?? null,
        budgetCategoryId: dto.budgetCategoryId ?? null,
        startDate: toDate(dto.startDate),
        deadline: toDate(dto.deadline),
        durationDays: dto.durationDays ?? null,
        priority: dto.priority,
        status: dto.status,
        percent: dto.percent,
        budgetVnd: BigInt(dto.budgetVnd),
        actualVnd: BigInt(dto.actualVnd),
        kpi: dto.kpi ?? null,
        deliverable: dto.deliverable ?? null,
        dependencyText: dto.dependencyText ?? null,
        riskText: dto.riskText ?? null,
        audience: dto.audience ?? null,
        notes: dto.notes ?? null,
        inChargeLabel: dto.inChargeLabel ?? null,
        createdById: ctx.userId,
        updatedById: ctx.userId,
      },
    });

    if (dto.assignments?.length) {
      await tx.taskAssignment.createMany({
        data: dto.assignments.map((a) => ({
          taskId: row.id,
          userId: a.userId ?? null,
          label: a.label,
          role: a.role,
        })),
      });
    }

    return row;
  });

  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    {
      action: 'task.created',
      entityType: 'Task',
      entityId: created.id,
      after: { code: created.code, title: created.title },
    },
  );

  // realtime: was emit('task.created'); polling in Phase 5

  return getTask(ctx, created.id);
}

// ────────────────────────────────────────────────────────── UPDATE / DELETE ───

/**
 * Port of backend TasksService.update (~line 212).
 * Fetch task → assertCan EDIT_TASK; date-order check across merged before/after;
 * applyTaskInvariants → conflict ⇒ BadRequest; BigInt casts; audit task.updated.
 */
export async function updateTask(
  ctx: AuthContext,
  taskId: string,
  dto: UpdateTaskDto,
  ip: string | null,
): Promise<TaskDto> {
  const before = await prisma.task.findUnique({ where: { id: taskId } });
  if (!before) throw new NotFound('Task not found');
  await assertCan(ctx, 'EDIT_TASK', before.projectId, { taskId });

  await assertRefsInProject(before.projectId, {
    phaseId: dto.phaseId,
    workstreamId: dto.workstreamId,
    budgetCategoryId: dto.budgetCategoryId,
  });

  // Moving a task into a DIFFERENT workstream must also be permitted for the target workstream —
  // otherwise a LEAD who owns the current workstream could push the task into one they don't own,
  // escaping their scope. PM/OWNER hold EDIT_TASK unconditionally, so this is a no-op for them.
  if (dto.workstreamId && dto.workstreamId !== before.workstreamId) {
    await assertCan(ctx, 'EDIT_TASK', before.projectId, { workstreamId: dto.workstreamId });
  }

  // Date-order check across before/after merged values.
  const start = dto.startDate === undefined ? before.startDate : toDate(dto.startDate);
  const end = dto.deadline === undefined ? before.deadline : toDate(dto.deadline);
  if (start && end && start > end) {
    throw new BadRequest('deadline must be on or after startDate');
  }

  const inv = applyTaskInvariants({
    current: { status: before.status, percent: before.percent },
    next: { status: dto.status, percent: dto.percent },
  });
  if (inv.conflict) {
    throw new BadRequest('status and percent are inconsistent');
  }

  const data: Prisma.TaskUpdateInput = {
    updatedBy: { connect: { id: ctx.userId } },
    ...(dto.title !== undefined ? { title: dto.title } : {}),
    ...(dto.description !== undefined ? { description: dto.description } : {}),
    ...(dto.phaseId !== undefined ? { phase: dto.phaseId ? { connect: { id: dto.phaseId } } : { disconnect: true } } : {}),
    ...(dto.workstreamId !== undefined ? { workstream: dto.workstreamId ? { connect: { id: dto.workstreamId } } : { disconnect: true } } : {}),
    ...(dto.category !== undefined ? { category: dto.category } : {}),
    ...(dto.budgetCategoryId !== undefined ? { budgetCategory: dto.budgetCategoryId ? { connect: { id: dto.budgetCategoryId } } : { disconnect: true } } : {}),
    ...(dto.startDate !== undefined ? { startDate: toDate(dto.startDate) } : {}),
    ...(dto.deadline !== undefined ? { deadline: toDate(dto.deadline) } : {}),
    ...(dto.durationDays !== undefined ? { durationDays: dto.durationDays } : {}),
    ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
    ...(dto.kpi !== undefined ? { kpi: dto.kpi } : {}),
    ...(dto.deliverable !== undefined ? { deliverable: dto.deliverable } : {}),
    ...(dto.dependencyText !== undefined ? { dependencyText: dto.dependencyText } : {}),
    ...(dto.riskText !== undefined ? { riskText: dto.riskText } : {}),
    ...(dto.audience !== undefined ? { audience: dto.audience } : {}),
    ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    ...(dto.inChargeLabel !== undefined ? { inChargeLabel: dto.inChargeLabel } : {}),
    ...(dto.budgetVnd !== undefined ? { budgetVnd: BigInt(dto.budgetVnd) } : {}),
    ...(dto.actualVnd !== undefined ? { actualVnd: BigInt(dto.actualVnd) } : {}),
    status: inv.resolved.status,
    percent: inv.resolved.percent,
  };

  const after = await prisma.task.update({ where: { id: taskId }, data });
  await auditRecord(
    { actorId: ctx.userId, projectId: before.projectId, ip },
    {
      action: 'task.updated',
      entityType: 'Task',
      entityId: taskId,
      before: { status: before.status, percent: before.percent },
      after: { status: after.status, percent: after.percent },
    },
  );
  // realtime: was emit('task.updated'); polling in Phase 5

  return getTask(ctx, taskId);
}

/**
 * Port of backend TasksService.updateProgress (~line 274).
 * MEMBER caller is permitted ONLY if assignee — RbacService resolves both LEAD and MEMBER scopes.
 */
export async function updateTaskProgress(
  ctx: AuthContext,
  taskId: string,
  dto: ProgressUpdateDto,
  ip: string | null,
): Promise<TaskDto> {
  const before = await prisma.task.findUnique({ where: { id: taskId } });
  if (!before) throw new NotFound('Task not found');
  await assertCan(ctx, 'UPDATE_TASK_PROGRESS', before.projectId, { taskId });

  const inv = applyTaskInvariants({
    current: { status: before.status, percent: before.percent },
    next: { status: dto.status, percent: dto.percent },
    kanbanMove: dto.kanbanMove,
  });
  if (inv.conflict) throw new BadRequest('status and percent are inconsistent');

  const after = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: inv.resolved.status,
      percent: inv.resolved.percent,
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      updatedBy: { connect: { id: ctx.userId } },
    },
  });
  await auditRecord(
    { actorId: ctx.userId, projectId: before.projectId, ip },
    {
      action: 'task.progress',
      entityType: 'Task',
      entityId: taskId,
      before: { status: before.status, percent: before.percent },
      after: {
        status: after.status,
        percent: after.percent,
        ...(dto.notes !== undefined ? { note: dto.notes } : {}),
      },
    },
  );
  // realtime: was emit('task.progress'); polling in Phase 5

  return getTask(ctx, taskId);
}

/**
 * Port of backend TasksService.delete (~line 324).
 * Hard delete (assignments/comments/deps cascade via DB FK on delete cascade).
 * No scope hint — LEAD=false per the capability matrix.
 */
export async function deleteTask(
  ctx: AuthContext,
  taskId: string,
  ip: string | null,
): Promise<void> {
  const before = await prisma.task.findUnique({ where: { id: taskId } });
  if (!before) throw new NotFound('Task not found');
  await assertCan(ctx, 'DELETE_TASK', before.projectId);
  await prisma.task.delete({ where: { id: taskId } });
  await auditRecord(
    { actorId: ctx.userId, projectId: before.projectId, ip },
    { action: 'task.deleted', entityType: 'Task', entityId: taskId, before: { code: before.code } },
  );
  // realtime: was emit('task.deleted'); polling in Phase 5
}

// ──────────────────────────────────────────── ASSIGNMENTS / DEPENDENCIES ─────

/**
 * Port of backend TasksService.setAssignments (~line 341).
 * Replace-all in a transaction: delete all TaskAssignment for task, re-insert from dto.
 */
export async function setTaskAssignments(
  ctx: AuthContext,
  taskId: string,
  dto: SetAssignmentsDto,
  ip: string | null,
): Promise<TaskDto> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFound('Task not found');
  await assertCan(ctx, 'EDIT_TASK', task.projectId, { taskId });

  await prisma.$transaction(async (tx) => {
    await tx.taskAssignment.deleteMany({ where: { taskId } });
    if (dto.assignments.length > 0) {
      await tx.taskAssignment.createMany({
        data: dto.assignments.map((a) => ({
          taskId,
          userId: a.userId ?? null,
          label: a.label,
          role: a.role,
        })),
      });
    }
  });
  await auditRecord(
    { actorId: ctx.userId, projectId: task.projectId, ip },
    { action: 'task.assignmentsSet', entityType: 'Task', entityId: taskId },
  );
  // realtime: was emit('task.assignmentsSet'); polling in Phase 5

  return getTask(ctx, taskId);
}

/**
 * Port of backend TasksService.setDependencies (~line 371).
 * Dedupe + drop self-reference; all dep IDs must belong to same project; cycle detection via DFS.
 */
export async function setTaskDependencies(
  ctx: AuthContext,
  taskId: string,
  dto: SetDependenciesDto,
  ip: string | null,
): Promise<TaskDto> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFound('Task not found');
  await assertCan(ctx, 'EDIT_TASK', task.projectId, { taskId });

  // Dedupe and silently drop self-reference.
  const deps = Array.from(new Set(dto.dependsOnTaskIds.filter((id) => id !== taskId)));

  if (deps.length > 0) {
    // All deps must live in the same project (no cross-project leakage).
    const inProject = await prisma.task.count({
      where: { id: { in: deps }, projectId: task.projectId },
    });
    if (inProject !== deps.length) {
      throw new BadRequest('All dependencies must belong to the same project');
    }
    // Cycle check: DFS over the proposed graph — if taskId is reachable again, reject.
    if (await wouldCreateCycle(task.projectId, taskId, deps)) {
      throw new BadRequest('Dependency cycle detected');
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.taskDependency.deleteMany({ where: { taskId } });
    if (deps.length > 0) {
      await tx.taskDependency.createMany({
        data: deps.map((id) => ({ taskId, dependsOnTaskId: id })),
      });
    }
  });
  await auditRecord(
    { actorId: ctx.userId, projectId: task.projectId, ip },
    { action: 'task.dependenciesSet', entityType: 'Task', entityId: taskId, after: { count: deps.length } },
  );
  // realtime: was emit('task.dependenciesSet'); polling in Phase 5

  return getTask(ctx, taskId);
}

/**
 * Port of backend TasksService.wouldCreateCycle (~line 440).
 * Load the entire project's TaskDependency graph, build adjacency map with proposed edges,
 * then DFS from taskId — if taskId is reachable again ⇒ cycle.
 */
async function wouldCreateCycle(
  projectId: string,
  newTaskId: string,
  proposedDeps: string[],
): Promise<boolean> {
  const edges = await prisma.taskDependency.findMany({
    where: { task: { projectId } },
    select: { taskId: true, dependsOnTaskId: true },
  });
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.taskId === newTaskId) continue; // we're about to replace this node's edges
    const list = adj.get(e.taskId) ?? [];
    list.push(e.dependsOnTaskId);
    adj.set(e.taskId, list);
  }
  adj.set(newTaskId, [...proposedDeps]);

  // DFS from newTaskId following edges; if we ever visit newTaskId again → cycle.
  const seen = new Set<string>();
  const stack: string[] = [...proposedDeps];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === newTaskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const next = adj.get(cur);
    if (next) stack.push(...next);
  }
  return false;
}

// ─────────────────────────────────────────────────── CODE GENERATION ─────────

export async function generateCode(
  projectId: string,
  workstreamId: string | null,
): Promise<string> {
  const prefix = await resolveCodePrefix(projectId, workstreamId);
  // Find the highest existing N### for this prefix within the project.
  const existing = await prisma.task.findMany({
    where: { projectId, code: { startsWith: `${prefix}-` } },
    select: { code: true },
  });
  let max = 0;
  for (const row of existing) {
    const m = /-(\d+)$/.exec(row.code);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return `${prefix}-${(max + 1).toString().padStart(4, '0')}`;
}

async function resolveCodePrefix(
  projectId: string,
  workstreamId: string | null,
): Promise<string> {
  if (!workstreamId) return 'TSK';
  const ws = await prisma.workstream.findUnique({ where: { id: workstreamId } });
  if (!ws || ws.projectId !== projectId) return 'TSK';
  if (ws.track === 'MARKETING') return 'MKT';
  if (ws.track === 'OPERATIONS') return 'OPS';
  return 'EXE'; // PMO track keeps the seed's "EXE-####" convention
}

// ─────────────────────────────────────────────────────────── DTO MAPPER ──────

export function toTaskDto(
  t: Task,
  assignments: TaskAssignment[] = [],
  dependsOnTaskIds?: string[],
): TaskDto {
  return {
    id: t.id,
    projectId: t.projectId,
    code: t.code,
    title: t.title,
    description: t.description,
    phaseId: t.phaseId,
    workstreamId: t.workstreamId,
    category: t.category,
    budgetCategoryId: t.budgetCategoryId,
    startDate: t.startDate ? t.startDate.toISOString() : null,
    deadline: t.deadline ? t.deadline.toISOString() : null,
    durationDays: t.durationDays,
    priority: t.priority,
    status: t.status,
    percent: t.percent,
    budgetVnd: moneyToNumber(t.budgetVnd),
    actualVnd: moneyToNumber(t.actualVnd),
    kpi: t.kpi,
    deliverable: t.deliverable,
    dependencyText: t.dependencyText,
    riskText: t.riskText,
    audience: t.audience,
    notes: t.notes,
    inChargeLabel: t.inChargeLabel,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    assignments: assignments.map((a) => ({
      id: a.id,
      userId: a.userId,
      label: a.label,
      role: a.role,
    })),
    ...(dependsOnTaskIds !== undefined ? { dependsOnTaskIds } : {}),
  };
}

// ──────────────────────────────────────────────────────────────── UTILS ───────

function toDate(s: string | null | undefined): Date | null {
  if (s === null || s === undefined) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
