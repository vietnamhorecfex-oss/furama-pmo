/**
 * B-02 — MilestoneService.
 *
 * RBAC (docs/03 §2):
 *  - MANAGE_MILESTONE — OWNER/PM = full CRUD; LEAD = setStatus only AND only when the gate's
 *    linked tasks all belong to one of the LEAD's workstreams. Other roles read-only.
 *  - VIEW_PROJECT — everyone in the project can list/get.
 *
 * Readiness: a GATE's criteria.taskIds list drives its readiness; `readinessPct` is the
 * % of those tasks that are COMPLETED. Without taskIds, readiness is null and the gate is
 * purely manually managed.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateMilestoneDto,
  GenerateMilestonesResult,
  MilestoneCriteria,
  MilestoneDto,
  SetMilestoneStatusDto,
  UpdateMilestoneDto,
} from '@furama/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService, type AuthContext } from '../rbac/rbac.service';

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

@Injectable()
export class MilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async list(ctx: AuthContext, projectId: string): Promise<MilestoneDto[]> {
    await this.rbac.assertCan(ctx, 'VIEW_PROJECT', projectId);
    const rows = await this.prisma.milestone.findMany({
      where: { projectId },
      orderBy: [{ date: 'asc' }, { name: 'asc' }],
    });
    return Promise.all(rows.map((r) => this.hydrate(r as MilestoneRow)));
  }

  async get(ctx: AuthContext, milestoneId: string): Promise<MilestoneDto> {
    const row = await this.prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!row) throw new NotFoundException('Milestone not found');
    await this.rbac.assertCan(ctx, 'VIEW_PROJECT', row.projectId);
    return this.hydrate(row as MilestoneRow);
  }

  async create(
    ctx: AuthContext,
    projectId: string,
    dto: CreateMilestoneDto,
    ip: string | null,
  ): Promise<MilestoneDto> {
    await this.rbac.assertCan(ctx, 'MANAGE_MILESTONE', projectId);
    await this.validateCriteriaProjectScope(projectId, dto.criteria);
    const row = await this.prisma.milestone.create({
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
    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      { action: 'milestone.created', entityType: 'Milestone', entityId: row.id, after: { name: dto.name, type: dto.type } },
    );
    return this.hydrate(row as MilestoneRow);
  }

  /**
   * Auto-pickup milestones from the project's phases (the seed/Excel "phase" column).
   * Each non-empty phase becomes a MILESTONE: date = its latest task deadline, criteria =
   * the phase's task ids (drives readiness). Idempotent — matches existing milestones by
   * name, updating their date + criteria instead of duplicating.
   */
  async generateFromPhases(
    ctx: AuthContext,
    projectId: string,
    ip: string | null,
  ): Promise<GenerateMilestonesResult> {
    await this.rbac.assertCan(ctx, 'MANAGE_MILESTONE', projectId);

    const [phases, tasks, existing] = await Promise.all([
      this.prisma.phase.findMany({ where: { projectId }, orderBy: { order: 'asc' } }),
      this.prisma.task.findMany({
        where: { projectId, phaseId: { not: null } },
        select: { id: true, phaseId: true, deadline: true },
      }),
      this.prisma.milestone.findMany({ where: { projectId }, select: { id: true, name: true } }),
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
        await this.prisma.milestone.update({
          where: { id: existingId },
          data: { date: g.maxDeadline, criteria },
        });
        updated++;
      } else {
        await this.prisma.milestone.create({
          data: { projectId, name: ph.name, date: g.maxDeadline, type: 'MILESTONE', status: 'PENDING', criteria },
        });
        created++;
      }
    }

    const result: GenerateMilestonesResult = { created, updated, total: created + updated };
    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      { action: 'milestone.generatedFromPhases', entityType: 'Project', entityId: projectId, after: { ...result } },
    );
    return result;
  }

  async update(
    ctx: AuthContext,
    milestoneId: string,
    dto: UpdateMilestoneDto,
    ip: string | null,
  ): Promise<MilestoneDto> {
    const before = await this.prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!before) throw new NotFoundException('Milestone not found');
    await this.rbac.assertCan(ctx, 'MANAGE_MILESTONE', before.projectId);
    if (dto.criteria !== undefined) {
      await this.validateCriteriaProjectScope(before.projectId, dto.criteria ?? undefined);
    }
    const after = await this.prisma.milestone.update({
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
    await this.audit.record(
      { actorId: ctx.userId, projectId: before.projectId, ip },
      { action: 'milestone.updated', entityType: 'Milestone', entityId: milestoneId, before: { status: before.status }, after: { status: after.status } },
    );
    return this.hydrate(after as MilestoneRow);
  }

  /**
   * Status-only update path. OWNER/PM may always; LEAD may only when every linked task is in
   * one of the LEAD's workstreams (otherwise the gate spans territory they don't own).
   */
  async setStatus(
    ctx: AuthContext,
    milestoneId: string,
    dto: SetMilestoneStatusDto,
    ip: string | null,
  ): Promise<MilestoneDto> {
    const before = await this.prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!before) throw new NotFoundException('Milestone not found');

    const role = await this.rbac.effectiveRole(ctx.userId, before.projectId);
    if (!role) throw new ForbiddenException('Not a member of this project');

    if (role === 'OWNER' || role === 'PM') {
      // proceed
    } else if (role === 'LEAD') {
      await this.assertLeadScopeCoversCriteria(ctx.userId, before.projectId, before.criteria);
    } else {
      throw new ForbiddenException(`Role ${role} cannot change milestone status`);
    }

    const after = await this.prisma.milestone.update({
      where: { id: milestoneId },
      data: {
        status: dto.status,
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    await this.audit.record(
      { actorId: ctx.userId, projectId: before.projectId, ip },
      {
        action: 'milestone.status',
        entityType: 'Milestone',
        entityId: milestoneId,
        before: { status: before.status },
        after: { status: after.status },
      },
    );
    return this.hydrate(after as MilestoneRow);
  }

  async delete(ctx: AuthContext, milestoneId: string, ip: string | null): Promise<void> {
    const before = await this.prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!before) throw new NotFoundException('Milestone not found');
    await this.rbac.assertCan(ctx, 'MANAGE_MILESTONE', before.projectId);
    await this.prisma.milestone.delete({ where: { id: milestoneId } });
    await this.audit.record(
      { actorId: ctx.userId, projectId: before.projectId, ip },
      { action: 'milestone.deleted', entityType: 'Milestone', entityId: milestoneId },
    );
  }

  // ----- helpers -----

  private async hydrate(row: MilestoneRow): Promise<MilestoneDto> {
    const criteria = parseCriteria(row.criteria);
    let readinessPct: number | null = null;
    let completedCount: number | null = null;
    let totalCount: number | null = null;
    if (criteria?.taskIds && criteria.taskIds.length > 0) {
      const ids = criteria.taskIds;
      const [total, done] = await this.prisma.$transaction([
        this.prisma.task.count({ where: { projectId: row.projectId, id: { in: ids } } }),
        this.prisma.task.count({
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

  private async validateCriteriaProjectScope(
    projectId: string,
    criteria: MilestoneCriteria | undefined,
  ): Promise<void> {
    if (!criteria?.taskIds || criteria.taskIds.length === 0) return;
    const valid = await this.prisma.task.count({
      where: { projectId, id: { in: criteria.taskIds } },
    });
    if (valid !== criteria.taskIds.length) {
      throw new BadRequestException('criteria.taskIds must all belong to this project');
    }
  }

  private async assertLeadScopeCoversCriteria(
    userId: string,
    projectId: string,
    criteriaJson: Prisma.JsonValue | null,
  ): Promise<void> {
    const criteria = parseCriteria(criteriaJson);
    if (!criteria?.taskIds || criteria.taskIds.length === 0) {
      throw new ForbiddenException('LEAD can only set status on gates with task-bound criteria');
    }
    const tasks = await this.prisma.task.findMany({
      where: { projectId, id: { in: criteria.taskIds } },
      select: { workstreamId: true },
    });
    const wsIds = Array.from(new Set(tasks.map((t) => t.workstreamId).filter(Boolean) as string[]));
    if (wsIds.length === 0) {
      throw new ForbiddenException('Gate criteria do not belong to any workstream');
    }
    for (const wsId of wsIds) {
      const owns = await this.rbac.leadOwnsWorkstream(userId, projectId, wsId);
      if (!owns) {
        throw new ForbiddenException('Gate spans a workstream outside your scope');
      }
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
