import { NextResponse } from 'next/server';
import { updateStatusDefSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { updateStatusDef, deleteStatusDef } from '@/server/config/statuses';

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, id } = await ctx.params;
  const dto = updateStatusDefSchema.parse(await readJson(req));
  return NextResponse.json(await updateStatusDef(auth, projectId, id, dto, clientIp(req)), { status: 200 });
});

export const DELETE = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, id } = await ctx.params;
  // replaceWithKey comes from the query string, not the body
  const replaceWithKey = new URL(req.url).searchParams.get('replaceWithKey') ?? undefined;
  await deleteStatusDef(auth, projectId, id, { replaceWithKey }, clientIp(req));
  return new NextResponse(null, { status: 204 });
});
