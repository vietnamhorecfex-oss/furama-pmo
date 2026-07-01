import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { markRead } from '@/server/ai/notifications';

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  await markRead(auth, id);
  return new NextResponse(null, { status: 204 });
});
