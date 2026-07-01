import { NextResponse } from 'next/server';
import { updateMilestoneSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { getMilestone, updateMilestone, deleteMilestone } from '@/server/milestones/milestones';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  return NextResponse.json(await getMilestone(auth, id), { status: 200 });
});

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  const dto = updateMilestoneSchema.parse(await readJson(req));
  return NextResponse.json(await updateMilestone(auth, id, dto, clientIp(req)), { status: 200 });
});

export const DELETE = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  await deleteMilestone(auth, id, clientIp(req));
  return new NextResponse(null, { status: 204 });
});
