import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { confirmAction } from '@/server/ai/assistant';

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  return NextResponse.json(await confirmAction(auth, id), { status: 200 });
});
