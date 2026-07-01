import { NextResponse } from 'next/server';
import { createMilestoneSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { listMilestones, createMilestone } from '@/server/milestones/milestones';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  return NextResponse.json(await listMilestones(auth, projectId), { status: 200 });
});

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = createMilestoneSchema.parse(await readJson(req));
  return NextResponse.json(await createMilestone(auth, projectId, dto, clientIp(req)), { status: 201 });
});
