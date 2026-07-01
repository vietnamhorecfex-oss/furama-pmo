import { NextResponse } from 'next/server';
import { updateMemberSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { updateMember, removeMember } from '@/server/members/members';

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, memberId } = await ctx.params;
  const dto = updateMemberSchema.parse(await readJson(req));
  return NextResponse.json(await updateMember(auth, projectId, memberId, dto, clientIp(req)), { status: 200 });
});

export const DELETE = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, memberId } = await ctx.params;
  await removeMember(auth, projectId, memberId, clientIp(req));
  return new NextResponse(null, { status: 204 });
});
