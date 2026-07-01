import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp } from '@/server/http/request';
import { archiveProject } from '@/server/projects/projects';

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  return NextResponse.json(await archiveProject(auth, projectId, clientIp(req)), { status: 200 });
});
