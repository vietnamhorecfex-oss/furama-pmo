/**
 * web/server port of backend TasksService — part 1: list/get/myTasks/create + helpers.
 * (backend/src/tasks/tasks.service.ts lines ~66–209, ~412–437)
 *
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - BadRequestException/ConflictException/NotFoundException → BadRequest/Conflict/NotFound from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.audit.record → auditRecord from ../audit/audit
 *  - this.realtime.emit → DROPPED (comment: realtime polling in Phase 5)
 *
 * Part 2 (update/progress/delete/assignments/dependencies) is in Task 2.6.
 */
import type { Prisma, Task, TaskAssignment } from '@prisma/client';
import type { CreateTaskDto, ListTasksQuery, TaskDto } from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { BadRequest, Conflict, NotFound } from '../http/errors';
import { moneyToNumber } from '../http/serialize';
import type { Paginated } from '../http/serialize';

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
