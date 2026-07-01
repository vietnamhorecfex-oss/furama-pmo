import { NextResponse } from 'next/server';
import { activityQuerySchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { activityFeed } from '@/server/audit/activity';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const q = activityQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return NextResponse.json(await activityFeed(auth, projectId, q), { status: 200 });
});
