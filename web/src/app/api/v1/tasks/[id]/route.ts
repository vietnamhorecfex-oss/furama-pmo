import { NextResponse } from 'next/server';
import { updateTaskSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { deleteTask, getTask, updateTask } from '@/server/tasks/tasks';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  return NextResponse.json(await getTask(auth, id), { status: 200 });
});

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  const dto = updateTaskSchema.parse(await readJson(req));
  return NextResponse.json(await updateTask(auth, id, dto, clientIp(req)), { status: 200 });
});

export const DELETE = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  await deleteTask(auth, id, clientIp(req));
  return new NextResponse(null, { status: 204 });
});
