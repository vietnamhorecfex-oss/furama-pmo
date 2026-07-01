import { NextResponse } from 'next/server';
import { addCommentSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { listComments, addComment } from '@/server/comments/comments';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  return NextResponse.json(await listComments(auth, id), { status: 200 });
});

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { id } = await ctx.params;
  const dto = addCommentSchema.parse(await readJson(req));
  return NextResponse.json(await addComment(auth, id, dto.body, clientIp(req)), { status: 201 });
});
