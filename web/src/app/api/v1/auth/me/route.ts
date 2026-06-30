import { NextResponse } from 'next/server';
import { route } from '../../../../../server/http/envelope';
import { getAuthContext } from '../../../../../server/auth/session';
import { getMe } from '../../../../../server/auth/service';

export const GET = route(async (req) => {
  const ctx = getAuthContext(req);
  return NextResponse.json(await getMe(ctx.userId), { status: 200 });
});
