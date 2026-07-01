import { NextResponse } from 'next/server';
import { setDependenciesSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { setTaskDependencies } from '@/server/tasks/tasks';

export const PUT = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  const dto = setDependenciesSchema.parse(await readJson(req));
  return NextResponse.json(await setTaskDependencies(auth, id, dto, clientIp(req)), { status: 200 });
});
