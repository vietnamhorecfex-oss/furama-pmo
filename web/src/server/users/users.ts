/**
 * Org-scoped user directory. Powers the add-member picker so callers select a real
 * userId instead of pasting a raw cuid (which caused P2003 FK errors).
 */
import type { UserLite } from '@furama/shared';
import { prisma } from '../prisma';
import type { AuthContext } from '../rbac/rbac';

export async function listOrgUsers(ctx: AuthContext): Promise<UserLite[]> {
  const rows = await prisma.user.findMany({
    where: { orgId: ctx.orgId, isActive: true },
    select: { id: true, name: true, email: true, avatarColor: true },
    orderBy: { name: 'asc' },
  });
  return rows;
}
