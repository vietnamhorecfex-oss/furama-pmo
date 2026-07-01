import { NextResponse } from 'next/server';
import { createWorkstreamSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { listWorkstreams, createWorkstream } from '@/server/config/workstreams';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  return NextResponse.json(await listWorkstreams(auth, projectId), { status: 200 });
});

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = createWorkstreamSchema.parse(await readJson(req));
  return NextResponse.json(await createWorkstream(auth, projectId, dto, clientIp(req)), { status: 201 });
});
