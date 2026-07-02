import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { projectSummary } from '@/server/ai/digest';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  return NextResponse.json(await projectSummary(auth, projectId), { status: 200 });
});
