import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { listOrgUsers } from '@/server/users/users';

export const GET = route(async (req) => {
  const auth = getAuthContext(req);
  return NextResponse.json(await listOrgUsers(auth), { status: 200 });
});
