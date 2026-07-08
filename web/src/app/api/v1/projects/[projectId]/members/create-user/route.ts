import { NextResponse } from 'next/server';
import { createMemberUserSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { createUserAndAddMember } from '@/server/members/members';

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = createMemberUserSchema.parse(await readJson(req));
  return NextResponse.json(
    await createUserAndAddMember(auth, projectId, dto, clientIp(req)),
    { status: 201 },
  );
});
