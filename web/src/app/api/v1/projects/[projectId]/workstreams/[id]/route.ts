import { NextResponse } from 'next/server';
import { updateWorkstreamSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { updateWorkstream, deleteWorkstream } from '@/server/config/workstreams';

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, id } = await ctx.params;
  const dto = updateWorkstreamSchema.parse(await readJson(req));
  return NextResponse.json(await updateWorkstream(auth, projectId, id, dto, clientIp(req)), { status: 200 });
});

export const DELETE = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, id } = await ctx.params;
  await deleteWorkstream(auth, projectId, id, clientIp(req));
  return new NextResponse(null, { status: 204 });
});
