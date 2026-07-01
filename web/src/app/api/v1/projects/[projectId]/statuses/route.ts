import { NextResponse } from 'next/server';
import { createStatusDefSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { listStatusDefs, createStatusDef } from '@/server/config/statuses';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  return NextResponse.json(await listStatusDefs(auth, projectId), { status: 200 });
});

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = createStatusDefSchema.parse(await readJson(req));
  return NextResponse.json(await createStatusDef(auth, projectId, dto, clientIp(req)), { status: 201 });
});
