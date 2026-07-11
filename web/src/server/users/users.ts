/**
 * Org-scoped user directory. Powers the add-member picker so callers select a real
 * userId instead of pasting a raw cuid (which caused P2003 FK errors).
 */
import type { UserLite } from '@furama/shared';
import { prisma } from '../prisma';
import type { AuthContext } from '../rbac/rbac';
import { Forbidden } from '../http/errors';

export async function listOrgUsers(ctx: AuthContext): Promise<UserLite[]> {
  // The org-wide directory (name + email = PII) powers the add-member picker, a
  // MANAGE_MEMBERS feature. Restrict it to callers who can manage members somewhere —
  // i.e. hold OWNER/PM in at least one project — so a plain VIEWER/MEMBER cannot harvest it.
  const canManage = await prisma.projectMember.findFirst({
    where: { userId: ctx.userId, role: { in: ['OWNER', 'PM'] } },
    select: { id: true },
  });
  if (!canManage) throw new Forbidden('Insufficient permission to list users');

  const rows = await prisma.user.findMany({
    where: { orgId: ctx.orgId, isActive: true },
    select: { id: true, name: true, email: true, avatarColor: true },
    orderBy: { name: 'asc' },
  });
  return rows;
}
