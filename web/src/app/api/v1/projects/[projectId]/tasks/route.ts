import { NextResponse } from 'next/server';
import { createTaskSchema, listTasksQuerySchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { listTasks, createTask } from '@/server/tasks/tasks';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const q = listTasksQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return NextResponse.json(await listTasks(auth, projectId, q), { status: 200 });
});

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = createTaskSchema.parse(await readJson(req));
  return NextResponse.json(await createTask(auth, projectId, dto, clientIp(req)), { status: 201 });
});
