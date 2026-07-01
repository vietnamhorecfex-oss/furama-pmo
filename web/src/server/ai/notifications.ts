import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { Forbidden, NotFound } from '../http/errors';

export async function listNotifications(ctx: AuthContext, projectId: string, unreadOnly = false) {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);
  return prisma.notification.findMany({
    where: { projectId, userId: ctx.userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function markRead(ctx: AuthContext, notificationId: string): Promise<void> {
  const notif = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notif) throw new NotFound('Notification not found');
  if (notif.userId !== ctx.userId) throw new Forbidden();
  await prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
}
