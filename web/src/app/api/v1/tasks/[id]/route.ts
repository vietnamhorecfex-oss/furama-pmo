import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { getTask } from '@/server/tasks/tasks';

// GET only for now — PATCH and DELETE come in Task 2.6.
export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = ctx.params;
  return NextResponse.json(await getTask(auth, id), { status: 200 });
});
