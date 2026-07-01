import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { myTasks } from '@/server/tasks/tasks';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = ctx.params;
  return NextResponse.json(await myTasks(auth, projectId), { status: 200 });
});
