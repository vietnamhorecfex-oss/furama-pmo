import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { entityHistory } from '@/server/audit/activity';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, entityType, entityId } = await ctx.params;
  return NextResponse.json(await entityHistory(auth, projectId, entityType, entityId), { status: 200 });
});
