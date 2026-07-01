import { NextResponse } from 'next/server';
import { setAssignmentsSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { setTaskAssignments } from '@/server/tasks/tasks';

export const PUT = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  const dto = setAssignmentsSchema.parse(await readJson(req));
  return NextResponse.json(await setTaskAssignments(auth, id, dto, clientIp(req)), { status: 200 });
});
