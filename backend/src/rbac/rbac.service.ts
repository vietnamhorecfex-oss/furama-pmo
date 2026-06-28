/**
 * A-09 — RbacService. Single source of authorization truth.
 *
 * Every mutating service MUST call assertCan(...) before doing the work. Guards in
 * `./guards.ts` cover the common "must be authenticated" and "must be a project member"
 * cases declaratively; resource-scope checks (LEAD workstream, MEMBER assignee) require
 * fetching the resource and so live here.
 *
 * Note: keeping this in one file is intentional — the deny-path tests (A-12) read the
 * matrix from capability.enum.ts and assert it round-trips through assertCan().
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { MemberRole, Capability } from '@furama/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  CAPABILITY_MATRIX,
  roleHasCapability,
  type CapabilityGrant,
} from './capability.enum';

export interface AuthContext {
  userId: string;
  orgId: string;
}

export interface ScopeHints {
  workstreamId?: string | null;
  taskId?: string | null;
}

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  async effectiveRole(userId: string, projectId: string): Promise<MemberRole | null> {
    const member = await this.prisma.projectMember.findFirst({
      where: { userId, projectId },
      select: { role: true },
    });
    return member?.role ?? null;
  }

  /**
   * Throws ForbiddenException unless the caller is allowed to perform `capability` on the
   * given project, taking into account LEAD workstream scope and MEMBER assignee scope.
   *
   * Internal services should pass the relevant scope hints. If the hint is absent for a
   * 'scope'-grant capability, we deny by default — the caller forgot to supply the resource.
   */
  async assertCan(
    ctx: AuthContext,
    capability: Capability,
    projectId: string,
    scope: ScopeHints = {},
  ): Promise<MemberRole> {
    const role = await this.effectiveRole(ctx.userId, projectId);
    if (!role) {
      throw new ForbiddenException('Not a member of this project');
    }
    const grant = roleHasCapability(role, capability);
    if (grant === true) return role;
    if (grant === false) {
      throw new ForbiddenException(`Role ${role} cannot ${capability}`);
    }
    // 'scope' branch
    const inScope = await this.isInScope(ctx.userId, projectId, role, capability, scope);
    if (!inScope) {
      throw new ForbiddenException(`Role ${role} can ${capability} only within own scope`);
    }
    return role;
  }

  /** Pure predicate version of assertCan — never throws. */
  async can(
    ctx: AuthContext,
    capability: Capability,
    projectId: string,
    scope: ScopeHints = {},
  ): Promise<boolean> {
    try {
      await this.assertCan(ctx, capability, projectId, scope);
      return true;
    } catch {
      return false;
    }
  }

  /** True if the LEAD owns the given workstream in this project. */
  async leadOwnsWorkstream(
    userId: string,
    projectId: string,
    workstreamId: string,
  ): Promise<boolean> {
    const row = await this.prisma.memberWorkstream.findFirst({
      where: {
        workstreamId,
        projectMember: { userId, projectId, role: 'LEAD' },
      },
      select: { id: true },
    });
    return row !== null;
  }

  /** True if the caller is named (by userId OR by memberLabel) on a task assignment. */
  async isAssignee(userId: string, projectId: string, taskId: string): Promise<boolean> {
    // Resolve the caller's memberLabel for this project; assignments may be label-only.
    const member = await this.prisma.projectMember.findFirst({
      where: { userId, projectId },
      select: { memberLabel: true },
    });
    if (!member) return false;

    const count = await this.prisma.taskAssignment.count({
      where: {
        taskId,
        OR: [
          { userId },
          ...(member.memberLabel ? [{ label: member.memberLabel }] : []),
        ],
      },
    });
    return count > 0;
  }

  // -----

  private async isInScope(
    userId: string,
    projectId: string,
    role: MemberRole,
    capability: Capability,
    scope: ScopeHints,
  ): Promise<boolean> {
    if (role === 'LEAD') {
      // LEAD scope is always a workstream. For task-scoped capabilities, resolve the task's workstream.
      let workstreamId = scope.workstreamId ?? null;
      if (!workstreamId && scope.taskId) {
        const task = await this.prisma.task.findUnique({
          where: { id: scope.taskId },
          select: { workstreamId: true, projectId: true },
        });
        if (!task) throw new NotFoundException('Task not found');
        if (task.projectId !== projectId) return false;
        workstreamId = task.workstreamId;
      }
      if (!workstreamId) return false;
      return this.leadOwnsWorkstream(userId, projectId, workstreamId);
    }
    if (role === 'MEMBER') {
      if (!scope.taskId) return false;
      // MEMBER scope only meaningful for UPDATE_TASK_PROGRESS — capability matrix already pins this.
      if (capability !== 'UPDATE_TASK_PROGRESS') return false;
      return this.isAssignee(userId, projectId, scope.taskId);
    }
    // OWNER/PM/VIEWER never hit 'scope' branch in the matrix.
    return false;
  }
}

// Re-export for convenience in tests/services.
export { CAPABILITY_MATRIX };
export type { CapabilityGrant };
