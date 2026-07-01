/**
 * web/server port of backend CommentsService.
 * (backend/src/comments/comments.service.ts)
 *
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - NotFoundException → NotFound from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.audit.record → auditRecord from ../audit/audit
 *  - this.realtime.emit → DROPPED (comment: realtime polling in Phase 5)
 *
 * RBAC: COMMENT_TASK (everyone except VIEWER) — assertCan enforces this.
 * Body is sanitised by stripping HTML tags + dangerous protocols before write.
 */
import type { Comment } from '@prisma/client';
import type { CommentDto } from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { NotFound } from '../http/errors';

export async function listComments(ctx: AuthContext, taskId: string): Promise<CommentDto[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) throw new NotFound('Task not found');
  await assertCan(ctx, 'VIEW_PROJECT', task.projectId);
  const rows = await prisma.comment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toCommentDto);
}

export async function addComment(
  ctx: AuthContext,
  taskId: string,
  body: string,
  ip: string | null,
): Promise<CommentDto> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) throw new NotFound('Task not found');
  await assertCan(ctx, 'COMMENT_TASK', task.projectId);

  const clean = sanitise(body);
  const row = await prisma.comment.create({
    data: { taskId, authorId: ctx.userId, body: clean },
  });

  await auditRecord(
    { actorId: ctx.userId, projectId: task.projectId, ip },
    { action: 'comment.created', entityType: 'Comment', entityId: row.id, after: { taskId } },
  );

  // realtime: was emit('comment.created'); polling in Phase 5

  return toCommentDto(row);
}

export function toCommentDto(c: Comment): CommentDto {
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
 *
 * Ported VERBATIM from backend/src/comments/comments.service.ts.
 */
function sanitise(body: string): string {
  return body
    .replace(/<\/?(script|iframe|object|embed|svg|style)\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/(?:javascript|data|vbscript):/gi, '')
    .trim();
}
