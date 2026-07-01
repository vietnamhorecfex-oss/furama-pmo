import { NextResponse } from 'next/server';
import { setMilestoneStatusSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { setMilestoneStatus } from '@/server/milestones/milestones';

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  const dto = setMilestoneStatusSchema.parse(await readJson(req));
  return NextResponse.json(await setMilestoneStatus(auth, id, dto, clientIp(req)), { status: 200 });
});
