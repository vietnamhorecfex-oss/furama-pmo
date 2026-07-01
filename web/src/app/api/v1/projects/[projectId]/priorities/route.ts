import { NextResponse } from 'next/server';
import { createPriorityDefSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { listPriorityDefs, createPriorityDef } from '@/server/config/priorities';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  return NextResponse.json(await listPriorityDefs(auth, projectId), { status: 200 });
});

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = createPriorityDefSchema.parse(await readJson(req));
  return NextResponse.json(await createPriorityDef(auth, projectId, dto, clientIp(req)), { status: 201 });
});
