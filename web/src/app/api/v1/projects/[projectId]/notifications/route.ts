import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { listNotifications } from '@/server/ai/notifications';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const unread = new URL(req.url).searchParams.get('unread') === 'true';
  return NextResponse.json(await listNotifications(auth, projectId, unread), { status: 200 });
});
