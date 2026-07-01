import { NextResponse } from 'next/server';
import { addMemberSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { listMembers, addMember } from '@/server/members/members';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  return NextResponse.json(await listMembers(auth, projectId), { status: 200 });
});

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = addMemberSchema.parse(await readJson(req));
  return NextResponse.json(await addMember(auth, projectId, dto, clientIp(req)), { status: 201 });
});
