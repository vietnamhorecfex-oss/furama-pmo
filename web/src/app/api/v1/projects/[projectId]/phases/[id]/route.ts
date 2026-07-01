import { NextResponse } from 'next/server';
import { updatePhaseSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { updatePhase, deletePhase } from '@/server/config/phases';

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, id } = await ctx.params;
  const dto = updatePhaseSchema.parse(await readJson(req));
  return NextResponse.json(await updatePhase(auth, projectId, id, dto, clientIp(req)), { status: 200 });
});

export const DELETE = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, id } = await ctx.params;
  await deletePhase(auth, projectId, id, clientIp(req));
  return new NextResponse(null, { status: 204 });
});
