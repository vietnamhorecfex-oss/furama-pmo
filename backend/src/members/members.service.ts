/**
 * P-04 — MembersService.
 *
 * Last-OWNER guard: the system must always have at least one OWNER per project. Both
 * `updateRole` (OWNER→other) and `remove` (OWNER) check inside a transaction with a
 * SERIALIZABLE-like read; the count check happens AFTER any pending change would apply.
 * The only safe place for this rule is the service; controllers and the UI should not own it.
 *
 * Workstream scope: only meaningful when the member is a LEAD. For other roles, ignored.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, MemberRole } from '@prisma/client';
import type {
  AddMemberDto,
  MemberDto,
  UpdateMemberDto,
} from '@furama/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import type { AuthContext } from '../rbac/rbac.service';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async list(ctx: AuthContext, projectId: string): Promise<MemberDto[]> {
    await this.rbac.assertCan(ctx, 'VIEW_PROJECT', projectId);
    const rows = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: { workstreams: { select: { workstreamId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toMemberDto);
  }

  async add(
    ctx: AuthContext,
    projectId: string,
    dto: AddMemberDto,
    ip: string | null,
  ): Promise<MemberDto> {
    await this.rbac.assertCan(ctx, 'MANAGE_MEMBERS', projectId);

    // Reject duplicates upfront with a clean error (Prisma would throw P2002 otherwise).
    const existing = await this.prisma.projectMember.findFirst({
      where: { projectId, userId: dto.userId },
      select: { id: true },
    });
    if (existing) throw new ConflictException('User is already a member of this project');

    // memberLabel must be unique per project when set.
    if (dto.memberLabel) {
      await this.assertLabelFree(projectId, dto.memberLabel);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const member = await tx.projectMember.create({
        data: {
          projectId,
          userId: dto.userId,
          role: dto.role,
          memberLabel: dto.memberLabel ?? null,
        },
      });
      await this.applyScope(tx, member.id, projectId, dto.role, dto.workstreamIds);
      return member;
    });

    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      {
        action: 'member.added',
        entityType: 'ProjectMember',
        entityId: created.id,
        after: { userId: created.userId, role: created.role },
      },
    );

    return this.getOne(created.id);
  }

  async update(
    ctx: AuthContext,
    projectId: string,
    memberId: string,
    dto: UpdateMemberDto,
    ip: string | null,
  ): Promise<MemberDto> {
    await this.rbac.assertCan(ctx, 'MANAGE_MEMBERS', projectId);
    const before = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId },
    });
    if (!before) throw new NotFoundException('Member not found');

    if (dto.memberLabel && dto.memberLabel !== before.memberLabel) {
      await this.assertLabelFree(projectId, dto.memberLabel, memberId);
    }

    const newRole: MemberRole = dto.role ?? before.role;
    const data: Prisma.ProjectMemberUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.memberLabel !== undefined) data.memberLabel = dto.memberLabel;

    await this.prisma.$transaction(async (tx) => {
      if (before.role === 'OWNER' && newRole !== 'OWNER') {
        await this.assertNotLastOwner(tx, projectId, memberId);
      }
      await tx.projectMember.update({ where: { id: memberId }, data });
      // Scope changes apply only when role is/becomes LEAD; for others, the model auto-clears.
      if (dto.workstreamIds !== undefined || dto.role !== undefined) {
        await this.applyScope(tx, memberId, projectId, newRole, dto.workstreamIds);
      }
    });

    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      {
        action: 'member.updated',
        entityType: 'ProjectMember',
        entityId: memberId,
        before: { role: before.role, memberLabel: before.memberLabel },
        after: { role: newRole, memberLabel: dto.memberLabel ?? before.memberLabel },
      },
    );

    return this.getOne(memberId);
  }

  async remove(
    ctx: AuthContext,
    projectId: string,
    memberId: string,
    ip: string | null,
  ): Promise<void> {
    await this.rbac.assertCan(ctx, 'MANAGE_MEMBERS', projectId);
    const before = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId },
    });
    if (!before) throw new NotFoundException('Member not found');

    await this.prisma.$transaction(async (tx) => {
      if (before.role === 'OWNER') {
        await this.assertNotLastOwner(tx, projectId, memberId);
      }
      await tx.projectMember.delete({ where: { id: memberId } });
    });

    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      { action: 'member.removed', entityType: 'ProjectMember', entityId: memberId, before: { role: before.role } },
    );
  }

  // ----- helpers -----

  private async getOne(memberId: string): Promise<MemberDto> {
    const row = await this.prisma.projectMember.findUnique({
      where: { id: memberId },
      include: { workstreams: { select: { workstreamId: true } } },
    });
    if (!row) throw new NotFoundException('Member not found');
    return toMemberDto(row);
  }

  private async assertLabelFree(
    projectId: string,
    label: string,
    exceptMemberId?: string,
  ): Promise<void> {
    const clash = await this.prisma.projectMember.findFirst({
      where: {
        projectId,
        memberLabel: label,
        ...(exceptMemberId ? { NOT: { id: exceptMemberId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`memberLabel "${label}" already used in this project`);
  }

  private async assertNotLastOwner(
    tx: Prisma.TransactionClient,
    projectId: string,
    memberIdLeaving: string,
  ): Promise<void> {
    const owners = await tx.projectMember.count({
      where: { projectId, role: 'OWNER', NOT: { id: memberIdLeaving } },
    });
    if (owners < 1) {
      throw new BadRequestException('Cannot remove or demote the last OWNER of a project');
    }
  }

  private async applyScope(
    tx: Prisma.TransactionClient,
    memberId: string,
    projectId: string,
    role: MemberRole,
    workstreamIds?: string[],
  ): Promise<void> {
    // Non-LEAD roles never carry workstream scope — wipe any leftovers.
    if (role !== 'LEAD') {
      await tx.memberWorkstream.deleteMany({ where: { projectMemberId: memberId } });
      return;
    }
    if (workstreamIds === undefined) return; // nothing requested → leave as-is

    // Validate that all referenced workstreams belong to this project.
    if (workstreamIds.length > 0) {
      const valid = await tx.workstream.count({
        where: { projectId, id: { in: workstreamIds } },
      });
      if (valid !== workstreamIds.length) {
        throw new BadRequestException('One or more workstreamIds do not belong to this project');
      }
    }
    await tx.memberWorkstream.deleteMany({ where: { projectMemberId: memberId } });
    if (workstreamIds.length > 0) {
      await tx.memberWorkstream.createMany({
        data: workstreamIds.map((wid) => ({ projectMemberId: memberId, workstreamId: wid })),
      });
    }
  }
}

function toMemberDto(row: {
  id: string;
  projectId: string;
  userId: string;
  role: MemberRole;
  memberLabel: string | null;
  workstreams?: { workstreamId: string }[];
}): MemberDto {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
    memberLabel: row.memberLabel,
    workstreamIds: (row.workstreams ?? []).map((w) => w.workstreamId),
  };
}
