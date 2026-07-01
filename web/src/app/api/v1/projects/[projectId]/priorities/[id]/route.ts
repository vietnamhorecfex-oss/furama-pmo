import { NextResponse } from 'next/server';
import { updatePriorityDefSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { updatePriorityDef, deletePriorityDef } from '@/server/config/priorities';

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, id } = await ctx.params;
  const dto = updatePriorityDefSchema.parse(await readJson(req));
  return NextResponse.json(await updatePriorityDef(auth, projectId, id, dto, clientIp(req)), { status: 200 });
});

export const DELETE = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, id } = await ctx.params;
  // replaceWithKey comes from the query string, not the body
  const replaceWithKey = new URL(req.url).searchParams.get('replaceWithKey') ?? undefined;
  await deletePriorityDef(auth, projectId, id, { replaceWithKey }, clientIp(req));
  return new NextResponse(null, { status: 204 });
});
