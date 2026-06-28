/**
 * T-03 — TasksService. Owns the task lifecycle: list/get/create/update/delete,
 * progress update with invariants, assignment replacement, dependency setting with
 * cycle check, "my tasks" view, and auto-generated WBS codes.
 *
 * RBAC: every mutating method calls RbacService.assertCan with the appropriate
 * capability and a `taskId` scope hint so LEAD-workstream and MEMBER-assignee
 * scopes are enforced in one place (CLAUDE.md DoD).
 *
 * Code generation: `<TRACKPREFIX>-N###` where N## is the next sequence number for
 * tasks belonging to the same workstream track. Without a workstream, defaults to
 * `TSK-N###` over all tasks in the project.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Prisma,
  Task,
  TaskAssignment,
  Priority as PrismaPriority,
  TaskStatus as PrismaTaskStatus,
} from '@prisma/client';
import type {
  CreateTaskDto,
  ListTasksQuery,
  Paginated,
  ProgressUpdateDto,
  SetAssignmentsDto,
  SetDependenciesDto,
  TaskAssignmentInput,
  TaskDto,
  UpdateTaskDto,
} from '@furama/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService, type AuthContext } from '../rbac/rbac.service';
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

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // ====================================================================== READ
  async list(ctx: AuthContext, projectId: string, q: ListTasksQuery): Promise<Paginated<TaskDto>> {
    await this.rbac.assertCan(ctx, 'VIEW_PROJECT', projectId);
    const where: Prisma.TaskWhereInput = {
      projectId,
      ...(q.phaseId ? { phaseId: q.phaseId } : {}),
      ...(q.workstreamId ? { workstreamId: q.workstreamId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.assignee ? { assignments: { some: { label: { contains: q.assignee, mode: 'insensitive' } } } } : {}),
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

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
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

  async get(ctx: AuthContext, taskId: string): Promise<TaskDto> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { assignments: true, dependencies: { select: { dependsOnTaskId: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    await this.rbac.assertCan(ctx, 'VIEW_PROJECT', task.projectId);
    return toTaskDto(task, task.assignments, task.dependencies.map((d) => d.dependsOnTaskId));
  }

  async myTasks(ctx: AuthContext, projectId: string): Promise<TaskDto[]> {
    await this.rbac.assertCan(ctx, 'VIEW_PROJECT', projectId);
    const member = await this.prisma.projectMember.findFirst({
      where: { userId: ctx.userId, projectId },
      select: { memberLabel: true },
    });
    const labelClause: Prisma.TaskAssignmentWhereInput = member?.memberLabel
      ? { OR: [{ userId: ctx.userId }, { label: member.memberLabel }] }
      : { userId: ctx.userId };
    const rows = await this.prisma.task.findMany({
      where: { projectId, assignments: { some: labelClause } },
      include: { assignments: true },
      orderBy: [{ deadline: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => toTaskDto(r, r.assignments));
  }

  // ====================================================================== CREATE
  async create(
    ctx: AuthContext,
    projectId: string,
    dto: CreateTaskDto,
    ip: string | null,
  ): Promise<TaskDto> {
    // For LEAD scope, the workstream the task is being created in must be the LEAD's.
    await this.rbac.assertCan(ctx, 'CREATE_TASK', projectId, {
      workstreamId: dto.workstreamId ?? null,
    });
    if (dto.startDate && dto.deadline && new Date(dto.startDate) > new Date(dto.deadline)) {
      throw new BadRequestException('deadline must be on or after startDate');
    }
    const code = dto.code?.trim() || (await this.generateCode(projectId, dto.workstreamId ?? null));

    const created = await this.prisma.$transaction(async (tx) => {
      // Unique guard on (projectId, code).
      const dup = await tx.task.findFirst({ where: { projectId, code }, select: { id: true } });
      if (dup) throw new ConflictException(`Task code "${code}" already exists in this project`);

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

    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      { action: 'task.created', entityType: 'Task', entityId: created.id, after: { code: created.code, title: created.title } },
    );
    return this.get(ctx, created.id);
  }

  // ====================================================================== UPDATE / DELETE
  async update(
    ctx: AuthContext,
    taskId: string,
    dto: UpdateTaskDto,
    ip: string | null,
  ): Promise<TaskDto> {
    const before = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!before) throw new NotFoundException('Task not found');
    await this.rbac.assertCan(ctx, 'EDIT_TASK', before.projectId, { taskId });

    // Date-order check across before/after.
    const start = dto.startDate === undefined ? before.startDate : toDate(dto.startDate);
    const end = dto.deadline === undefined ? before.deadline : toDate(dto.deadline);
    if (start && end && start > end) {
      throw new BadRequestException('deadline must be on or after startDate');
    }

    const inv = applyTaskInvariants({
      current: { status: before.status, percent: before.percent },
      next: { status: dto.status, percent: dto.percent },
    });
    if (inv.conflict) {
      throw new BadRequestException('status and percent are inconsistent');
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
    const after = await this.prisma.task.update({ where: { id: taskId }, data });
    await this.audit.record(
      { actorId: ctx.userId, projectId: before.projectId, ip },
      { action: 'task.updated', entityType: 'Task', entityId: taskId, before: { status: before.status, percent: before.percent }, after: { status: after.status, percent: after.percent } },
    );
    return this.get(ctx, taskId);
  }

  async updateProgress(
    ctx: AuthContext,
    taskId: string,
    dto: ProgressUpdateDto,
    ip: string | null,
  ): Promise<TaskDto> {
    const before = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!before) throw new NotFoundException('Task not found');
    // MEMBER caller is permitted ONLY if assignee — RbacService resolves both LEAD and MEMBER scopes.
    await this.rbac.assertCan(ctx, 'UPDATE_TASK_PROGRESS', before.projectId, { taskId });

    const inv = applyTaskInvariants({
      current: { status: before.status, percent: before.percent },
      next: { status: dto.status, percent: dto.percent },
    });
    if (inv.conflict) throw new BadRequestException('status and percent are inconsistent');

    const after = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: inv.resolved.status,
        percent: inv.resolved.percent,
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        updatedBy: { connect: { id: ctx.userId } },
      },
    });
    await this.audit.record(
      { actorId: ctx.userId, projectId: before.projectId, ip },
      {
        action: 'task.progress',
        entityType: 'Task',
        entityId: taskId,
        before: { status: before.status, percent: before.percent },
        after: { status: after.status, percent: after.percent },
      },
    );
    return this.get(ctx, taskId);
  }

  async delete(ctx: AuthContext, taskId: string, ip: string | null): Promise<void> {
    const before = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!before) throw new NotFoundException('Task not found');
    await this.rbac.assertCan(ctx, 'DELETE_TASK', before.projectId);
    await this.prisma.task.delete({ where: { id: taskId } });
    await this.audit.record(
      { actorId: ctx.userId, projectId: before.projectId, ip },
      { action: 'task.deleted', entityType: 'Task', entityId: taskId, before: { code: before.code } },
    );
  }

  // ====================================================================== ASSIGNMENTS / DEPS
  async setAssignments(
    ctx: AuthContext,
    taskId: string,
    dto: SetAssignmentsDto,
    ip: string | null,
  ): Promise<TaskDto> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    await this.rbac.assertCan(ctx, 'EDIT_TASK', task.projectId, { taskId });

    await this.prisma.$transaction(async (tx) => {
      await tx.taskAssignment.deleteMany({ where: { taskId } });
      if (dto.assignments.length > 0) {
        await tx.taskAssignment.createMany({
          data: dto.assignments.map((a: TaskAssignmentInput) => ({
            taskId,
            userId: a.userId ?? null,
            label: a.label,
            role: a.role,
          })),
        });
      }
    });
    await this.audit.record(
      { actorId: ctx.userId, projectId: task.projectId, ip },
      { action: 'task.assignmentsSet', entityType: 'Task', entityId: taskId },
    );
    return this.get(ctx, taskId);
  }

  async setDependencies(
    ctx: AuthContext,
    taskId: string,
    dto: SetDependenciesDto,
    ip: string | null,
  ): Promise<TaskDto> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    await this.rbac.assertCan(ctx, 'EDIT_TASK', task.projectId, { taskId });

    const deps = Array.from(new Set(dto.dependsOnTaskIds.filter((id) => id !== taskId)));
    // All deps must live in the same project (no cross-project leakage).
    if (deps.length > 0) {
      const inProject = await this.prisma.task.count({
        where: { id: { in: deps }, projectId: task.projectId },
      });
      if (inProject !== deps.length) {
        throw new BadRequestException('All dependencies must belong to the same project');
      }
      // Cycle check: walk the proposed graph from each dep upward. If we hit taskId, reject.
      if (await this.wouldCreateCycle(task.projectId, taskId, deps)) {
        throw new BadRequestException('Dependency cycle detected');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.taskDependency.deleteMany({ where: { taskId } });
      if (deps.length > 0) {
        await tx.taskDependency.createMany({
          data: deps.map((id) => ({ taskId, dependsOnTaskId: id })),
        });
      }
    });
    await this.audit.record(
      { actorId: ctx.userId, projectId: task.projectId, ip },
      { action: 'task.dependenciesSet', entityType: 'Task', entityId: taskId, after: { count: deps.length } },
    );
    return this.get(ctx, taskId);
  }

  // ====================================================================== CODE GENERATION
  async generateCode(projectId: string, workstreamId: string | null): Promise<string> {
    const prefix = await this.resolveCodePrefix(projectId, workstreamId);
    // Find the highest existing N### for this prefix within the project.
    const existing = await this.prisma.task.findMany({
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

  private async resolveCodePrefix(projectId: string, workstreamId: string | null): Promise<string> {
    if (!workstreamId) return 'TSK';
    const ws = await this.prisma.workstream.findUnique({ where: { id: workstreamId } });
    if (!ws || ws.projectId !== projectId) return 'TSK';
    if (ws.track === 'MARKETING') return 'MKT';
    if (ws.track === 'OPERATIONS') return 'OPS';
    return 'EXE'; // PMO track keeps the seed's "EXE-####" convention
  }

  // ====================================================================== CYCLE CHECK
  private async wouldCreateCycle(
    projectId: string,
    newTaskId: string,
    proposedDeps: string[],
  ): Promise<boolean> {
    // Load the entire project's existing dependency graph once (project sizes ~600–1k tasks,
    // dep counts low — much cheaper than per-node queries in a recursive walk).
    const edges = await this.prisma.taskDependency.findMany({
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
}

// =========================================================================
// helpers
function toDate(s: string | null | undefined): Date | null {
  if (s === null || s === undefined) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
    priority: t.priority as PrismaPriority,
    status: t.status as PrismaTaskStatus,
    percent: t.percent,
    budgetVnd: Number(t.budgetVnd),
    actualVnd: Number(t.actualVnd),
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
