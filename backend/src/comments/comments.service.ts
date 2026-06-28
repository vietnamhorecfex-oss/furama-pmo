/**
 * R-02 — CommentService.
 *
 * RBAC: COMMENT_TASK (everyone except VIEWER) — RbacService.assertCan enforces this.
 * Body is sanitised by stripping HTML tags + collapsing whitespace before write.
 *
 * Emits `comment.created` on the realtime gateway so connected project members get
 * the new comment immediately without a refetch.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Comment } from '@prisma/client';
import type { CommentDto } from '@furama/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService, type AuthContext } from '../rbac/rbac.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(ctx: AuthContext, taskId: string): Promise<CommentDto[]> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    await this.rbac.assertCan(ctx, 'VIEW_PROJECT', task.projectId);
    const rows = await this.prisma.comment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toCommentDto);
  }

  async add(
    ctx: AuthContext,
    taskId: string,
    body: string,
    ip: string | null,
  ): Promise<CommentDto> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    await this.rbac.assertCan(ctx, 'COMMENT_TASK', task.projectId);

    const clean = sanitise(body);
    const row = await this.prisma.comment.create({
      data: { taskId, authorId: ctx.userId, body: clean },
    });

    await this.audit.record(
      { actorId: ctx.userId, projectId: task.projectId, ip },
      { action: 'comment.created', entityType: 'Comment', entityId: row.id, after: { taskId } },
    );

    this.realtime.emit(task.projectId, 'comment.created', {
      projectId: task.projectId,
      taskId,
      comment: toCommentDto(row),
    });

    return toCommentDto(row);
  }
}

function toCommentDto(c: Comment): CommentDto {
  return {
    id: c.id,
    taskId: c.taskId,
    authorId: c.authorId,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * Strip HTML tags and dangerous protocols from comment bodies. We don't render HTML on the
 * web (markdown is fine), but we never want stored XSS payloads either.
 */
function sanitise(body: string): string {
  return body
    .replace(/<\/?(script|iframe|object|embed|svg|style)\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/(?:javascript|data|vbscript):/gi, '')
    .trim();
}
