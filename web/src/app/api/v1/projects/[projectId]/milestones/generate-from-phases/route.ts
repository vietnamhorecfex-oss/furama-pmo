import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp } from '@/server/http/request';
import { generateFromPhases } from '@/server/milestones/milestones';

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  return NextResponse.json(await generateFromPhases(auth, projectId, clientIp(req)), { status: 200 });
});
