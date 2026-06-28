/**
 * P-02 — ProjectsService.
 *
 * `create`: bootstraps the project under the caller's org and inserts a ProjectMember row
 * for the caller with role=OWNER in the same transaction. Without that atomicity, a crash
 * after the project insert would leave an orphan project no one can administer.
 *
 * `list`: scoped to projects the caller is a member of — cross-tenant leakage cannot happen
 * via this endpoint because the predicate is on `members.userId`, not on org.
 *
 * `archive`: soft-delete via `archivedAt`; the audit trail and history stay intact (ADR-6).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Project } from '@prisma/client';
import type {
  CreateProjectDto,
  ProjectDto,
  UpdateProjectMetaDto,
} from '@furama/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import type { AuthContext } from '../rbac/rbac.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async create(ctx: AuthContext, dto: CreateProjectDto, ip: string | null): Promise<ProjectDto> {
    assertDateOrder(dto.startDate, dto.endDate);

    const project = await this.prisma.$transaction(async (tx) => {
      const row = await tx.project.create({
        data: {
          orgId: ctx.orgId,
          name: dto.name,
          location: dto.location ?? null,
          status: dto.status,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          openingDate: dto.openingDate ? new Date(dto.openingDate) : null,
          budgetCapVnd: BigInt(dto.budgetCapVnd),
          createdById: ctx.userId,
        },
      });
      await tx.projectMember.create({
        data: { projectId: row.id, userId: ctx.userId, role: 'OWNER' },
      });
      return row;
    });

    await this.audit.record(
      { actorId: ctx.userId, projectId: project.id, ip },
      { action: 'project.created', entityType: 'Project', entityId: project.id, after: toAuditJson(project) },
    );

    return toProjectDto(project);
  }

  async list(ctx: AuthContext): Promise<ProjectDto[]> {
    const rows = await this.prisma.project.findMany({
      where: {
        archivedAt: null,
        members: { some: { userId: ctx.userId } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toProjectDto);
  }

  async get(ctx: AuthContext, projectId: string): Promise<ProjectDto> {
    await this.rbac.assertCan(ctx, 'VIEW_PROJECT', projectId);
    const row = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!row) throw new NotFoundException('Project not found');
    return toProjectDto(row);
  }

  async updateMeta(
    ctx: AuthContext,
    projectId: string,
    dto: UpdateProjectMetaDto,
    ip: string | null,
  ): Promise<ProjectDto> {
    await this.rbac.assertCan(ctx, 'MANAGE_CONFIG', projectId);
    const before = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!before) throw new NotFoundException('Project not found');

    // Resolve the post-update date pair to validate ordering once.
    const start = dto.startDate === undefined ? before.startDate : dto.startDate === null ? null : new Date(dto.startDate);
    const end = dto.endDate === undefined ? before.endDate : dto.endDate === null ? null : new Date(dto.endDate);
    if (start && end && start > end) {
      throw new BadRequestException('startDate must be on or before endDate');
    }

    const data: Prisma.ProjectUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.startDate !== undefined) data.startDate = dto.startDate === null ? null : new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = dto.endDate === null ? null : new Date(dto.endDate);
    if (dto.openingDate !== undefined) data.openingDate = dto.openingDate === null ? null : new Date(dto.openingDate);
    if (dto.budgetCapVnd !== undefined) data.budgetCapVnd = BigInt(dto.budgetCapVnd);

    const after = await this.prisma.project.update({ where: { id: projectId }, data });

    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      {
        action: 'project.updated',
        entityType: 'Project',
        entityId: projectId,
        before: toAuditJson(before),
        after: toAuditJson(after),
      },
    );
    return toProjectDto(after);
  }

  async archive(ctx: AuthContext, projectId: string, ip: string | null): Promise<ProjectDto> {
    await this.rbac.assertCan(ctx, 'ARCHIVE_PROJECT', projectId);
    const before = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!before) throw new NotFoundException('Project not found');
    if (before.archivedAt) {
      throw new ConflictException('Project already archived');
    }
    const after = await this.prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: new Date(), status: 'ARCHIVED' },
    });
    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      { action: 'project.archived', entityType: 'Project', entityId: projectId },
    );
    return toProjectDto(after);
  }
}

function assertDateOrder(start?: string, end?: string): void {
  if (start && end && new Date(start) > new Date(end)) {
    throw new BadRequestException('startDate must be on or before endDate');
  }
}

function toProjectDto(p: Project): ProjectDto {
  return {
    id: p.id,
    orgId: p.orgId,
    name: p.name,
    location: p.location,
    status: p.status,
    startDate: p.startDate ? p.startDate.toISOString() : null,
    endDate: p.endDate ? p.endDate.toISOString() : null,
    openingDate: p.openingDate ? p.openingDate.toISOString() : null,
    budgetCapVnd: Number(p.budgetCapVnd),
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

function toAuditJson(p: Project): Prisma.InputJsonValue {
  return { ...toProjectDto(p) } as Prisma.InputJsonValue;
}
