import { NextResponse } from 'next/server';
import { progressUpdateSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { updateTaskProgress } from '@/server/tasks/tasks';

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  const dto = progressUpdateSchema.parse(await readJson(req));
  return NextResponse.json(await updateTaskProgress(auth, id, dto, clientIp(req)), { status: 200 });
});
