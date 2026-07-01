import { NextResponse } from 'next/server';
import { createPhaseSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { listPhases, createPhase } from '@/server/config/phases';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  return NextResponse.json(await listPhases(auth, projectId), { status: 200 });
});

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = createPhaseSchema.parse(await readJson(req));
  return NextResponse.json(await createPhase(auth, projectId, dto, clientIp(req)), { status: 201 });
});
