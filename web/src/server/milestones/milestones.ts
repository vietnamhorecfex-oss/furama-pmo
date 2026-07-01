/**
 * web/server port of backend MilestonesService (backend/src/milestones/milestones.service.ts).
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - NestJS exceptions → typed errors from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.rbac.effectiveRole → effectiveRole from ../rbac/rbac
 *  - this.rbac.leadOwnsWorkstream → leadOwnsWorkstream from ../rbac/rbac
 *  - this.audit.record → auditRecord from ../audit/audit
 *  - WebSocket broadcasts dropped (Phase 4 concern)
 *
 * RBAC (docs/03 §2):
 *  - MANAGE_MILESTONE — OWNER/PM = full CRUD; LEAD = setStatus only AND only when
 *    the gate's linked tasks all belong to one of the LEAD's workstreams.
 *  - VIEW_PROJECT — everyone in the project can list/get.
 *
 * Readiness: criteria.taskIds drives readiness; readinessPct = % of those tasks COMPLETED.
 * Without taskIds, readiness is null (gate is purely manually managed).
 */
import { Prisma } from '@prisma/client';
import type {
  CreateMilestoneDto,
  GenerateMilestonesResult,
  MilestoneCriteria,
  MilestoneDto,
  SetMilestoneStatusDto,
  UpdateMilestoneDto,
} from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan, effectiveRole, leadOwnsWorkstream } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { BadRequest, Forbidden, NotFound } from '../http/errors';

interface MilestoneRow {
  id: string;
  projectId: string;
  name: string;
  date: Date | null;
  type: 'MILESTONE' | 'GATE';
  status: 'PENDING' | 'PASSED' | 'FAILED' | 'NA';
  criteria: Prisma.JsonValue | null;
  notes: string | null;
}

// ─── public API ───────────────────────────────────────────────────────────────

export async function listMilestones(ctx: AuthContext, projectId: string): Promise<MilestoneDto[]> {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);
  const rows = await prisma.milestone.findMany({
    where: { projectId },
    orderBy: [{ date: 'asc' }, { name: 'asc' }],
  });
  // PERF: N×2 queries per milestone. Could batch via task.groupBy over all
  // criteria taskIds then stitch results. Acceptable for current milestone counts (<100).
  return Promise.all(rows.map((r) => hydrate(r as MilestoneRow)));
}

export async function getMilestone(ctx: AuthContext, milestoneId: string): Promise<MilestoneDto> {
  const row = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!row) throw new NotFound('Milestone not found');
  await assertCan(ctx, 'VIEW_PROJECT', row.projectId);
  return hydrate(row as MilestoneRow);
}

export async function createMilestone(
  ctx: AuthContext,
  projectId: string,
  dto: CreateMilestoneDto,
  ip: string | null,
): Promise<MilestoneDto> {
  await assertCan(ctx, 'MANAGE_MILESTONE', projectId);
  await validateCriteriaProjectScope(projectId, dto.criteria);
  const row = await prisma.milestone.create({
    data: {
      projectId,
      name: dto.name,
      date: dto.date ? new Date(dto.date) : null,
      type: dto.type,
      status: dto.status,
      criteria: dto.criteria ? (dto.criteria as Prisma.InputJsonValue) : Prisma.JsonNull,
      notes: dto.notes ?? null,
    },
  });
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'milestone.created', entityType: 'Milestone', entityId: row.id, after: { name: dto.name, type: dto.type } },
  );
  return hydrate(row as MilestoneRow);
}

/**
 * Auto-generate milestones from the project's phases (the seed/Excel "phase" column).
 * Each non-empty phase becomes a MILESTONE: date = latest task deadline, criteria =
 * phase task ids (drives readiness). Idempotent — matches existing milestones by
 * name.toLowerCase(), updating their date + criteria instead of duplicating.
 */
export async function generateFromPhases(
  ctx: AuthContext,
  projectId: string,
  ip: string | null,
): Promise<GenerateMilestonesResult> {
  await assertCan(ctx, 'MANAGE_MILESTONE', projectId);

  const [phases, tasks, existing] = await Promise.all([
    prisma.phase.findMany({ where: { projectId }, orderBy: { order: 'asc' } }),
    prisma.task.findMany({
      where: { projectId, phaseId: { not: null } },
      select: { id: true, phaseId: true, deadline: true },
    }),
    prisma.milestone.findMany({ where: { projectId }, select: { id: true, name: true } }),
  ]);

  const byPhase = new Map<string, { ids: string[]; maxDeadline: Date | null }>();
  for (const t of tasks) {
    if (!t.phaseId) continue;
    const g = byPhase.get(t.phaseId) ?? { ids: [], maxDeadline: null };
    g.ids.push(t.id);
    if (t.deadline && (!g.maxDeadline || t.deadline > g.maxDeadline)) g.maxDeadline = t.deadline;
    byPhase.set(t.phaseId, g);
  }
  const idByName = new Map(existing.map((m) => [m.name.toLowerCase(), m.id]));

  let created = 0;
  let updated = 0;
  for (const ph of phases) {
    const g = byPhase.get(ph.id);
    if (!g || g.ids.length === 0) continue; // skip phases with no tasks
    const criteria = { taskIds: g.ids.slice(0, 200) } as unknown as Prisma.InputJsonValue;
    const existingId = idByName.get(ph.name.toLowerCase());
    if (existingId) {
      await prisma.milestone.update({
        where: { id: existingId },
        data: { date: g.maxDeadline, criteria },
      });
      updated++;
    } else {
      await prisma.milestone.create({
        data: { projectId, name: ph.name, date: g.maxDeadline, type: 'MILESTONE', status: 'PENDING', criteria },
      });
      created++;
    }
  }

  const result: GenerateMilestonesResult = { created, updated, total: created + updated };
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'milestone.generatedFromPhases', entityType: 'Project', entityId: projectId, after: { ...result } },
  );
  return result;
}

export async function updateMilestone(
  ctx: AuthContext,
  milestoneId: string,
  dto: UpdateMilestoneDto,
  ip: string | null,
): Promise<MilestoneDto> {
  const before = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!before) throw new NotFound('Milestone not found');
  await assertCan(ctx, 'MANAGE_MILESTONE', before.projectId);
  if (dto.criteria !== undefined) {
    await validateCriteriaProjectScope(before.projectId, dto.criteria ?? undefined);
  }
  const after = await prisma.milestone.update({
    where: { id: milestoneId },
    data: {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.date !== undefined ? { date: dto.date ? new Date(dto.date) : null } : {}),
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.criteria !== undefined
        ? { criteria: dto.criteria ? (dto.criteria as Prisma.InputJsonValue) : Prisma.JsonNull }
        : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    },
  });
  await auditRecord(
    { actorId: ctx.userId, projectId: before.projectId, ip },
    { action: 'milestone.updated', entityType: 'Milestone', entityId: milestoneId, before: { status: before.status }, after: { status: after.status } },
  );
  return hydrate(after as MilestoneRow);
}

/**
 * Status-only update path — THE GATE.
 * Does NOT use assertCan. Uses effectiveRole directly:
 *  - OWNER/PM: always allowed.
 *  - LEAD: allowed only when every linked task is in one of the LEAD's workstreams.
 *  - MEMBER/VIEWER: always Forbidden.
 */
export async function setMilestoneStatus(
  ctx: AuthContext,
  milestoneId: string,
  dto: SetMilestoneStatusDto,
  ip: string | null,
): Promise<MilestoneDto> {
  const before = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!before) throw new NotFound('Milestone not found');

  const role = await effectiveRole(ctx.userId, before.projectId);
  if (!role) throw new Forbidden('Not a member of this project');

  if (role === 'OWNER' || role === 'PM') {
    // proceed — no further checks needed
  } else if (role === 'LEAD') {
    await assertLeadScopeCoversCriteria(ctx.userId, before.projectId, before.criteria);
  } else {
    throw new Forbidden(`Role ${role} cannot change milestone status`);
  }

  const after = await prisma.milestone.update({
    where: { id: milestoneId },
    data: {
      status: dto.status,
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    },
  });
  await auditRecord(
    { actorId: ctx.userId, projectId: before.projectId, ip },
    {
      action: 'milestone.status',
      entityType: 'Milestone',
      entityId: milestoneId,
      before: { status: before.status },
      after: { status: after.status },
    },
  );
  return hydrate(after as MilestoneRow);
}

export async function deleteMilestone(
  ctx: AuthContext,
  milestoneId: string,
  ip: string | null,
): Promise<void> {
  const before = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!before) throw new NotFound('Milestone not found');
  await assertCan(ctx, 'MANAGE_MILESTONE', before.projectId);
  await prisma.milestone.delete({ where: { id: milestoneId } });
  await auditRecord(
    { actorId: ctx.userId, projectId: before.projectId, ip },
    { action: 'milestone.deleted', entityType: 'Milestone', entityId: milestoneId },
  );
}

// ─── private helpers ──────────────────────────────────────────────────────────

async function hydrate(row: MilestoneRow): Promise<MilestoneDto> {
  const criteria = parseCriteria(row.criteria);
  let readinessPct: number | null = null;
  let completedCount: number | null = null;
  let totalCount: number | null = null;
  if (criteria?.taskIds && criteria.taskIds.length > 0) {
    const ids = criteria.taskIds;
    const [total, done] = await prisma.$transaction([
      prisma.task.count({ where: { projectId: row.projectId, id: { in: ids } } }),
      prisma.task.count({
        where: { projectId: row.projectId, id: { in: ids }, status: 'COMPLETED' },
      }),
    ]);
    totalCount = total;
    completedCount = done;
    readinessPct = total === 0 ? 0 : Math.round((done / total) * 100);
  }
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    date: row.date ? row.date.toISOString() : null,
    type: row.type,
    status: row.status,
    criteria,
    notes: row.notes,
    readinessPct,
    completedCount,
    totalCount,
  };
}

async function validateCriteriaProjectScope(
  projectId: string,
  criteria: MilestoneCriteria | undefined,
): Promise<void> {
  if (!criteria?.taskIds || criteria.taskIds.length === 0) return;
  const valid = await prisma.task.count({
    where: { projectId, id: { in: criteria.taskIds } },
  });
  if (valid !== criteria.taskIds.length) {
    throw new BadRequest('criteria.taskIds must all belong to this project');
  }
}

async function assertLeadScopeCoversCriteria(
  userId: string,
  projectId: string,
  criteriaJson: Prisma.JsonValue | null,
): Promise<void> {
  const criteria = parseCriteria(criteriaJson);
  if (!criteria?.taskIds || criteria.taskIds.length === 0) {
    throw new Forbidden('LEAD can only set status on gates with task-bound criteria');
  }
  const tasks = await prisma.task.findMany({
    where: { projectId, id: { in: criteria.taskIds } },
    select: { workstreamId: true },
  });
  const wsIds = Array.from(new Set(tasks.map((t) => t.workstreamId).filter(Boolean) as string[]));
  if (wsIds.length === 0) {
    throw new Forbidden('Gate criteria do not belong to any workstream');
  }
  for (const wsId of wsIds) {
    const owns = await leadOwnsWorkstream(userId, projectId, wsId);
    if (!owns) {
      throw new Forbidden('Gate spans a workstream outside your scope');
    }
  }
}

function parseCriteria(j: Prisma.JsonValue | null): MilestoneCriteria | null {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const obj = j as { taskIds?: unknown; notes?: unknown };
  const taskIds = Array.isArray(obj.taskIds)
    ? obj.taskIds.filter((x): x is string => typeof x === 'string')
    : undefined;
  const notes = Array.isArray(obj.notes)
    ? obj.notes.filter((x): x is string => typeof x === 'string')
    : undefined;
  if (!taskIds && !notes) return null;
  return { taskIds, notes };
}
