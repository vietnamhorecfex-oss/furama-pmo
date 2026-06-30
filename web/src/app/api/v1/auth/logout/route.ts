import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { route } from '../../../../../server/http/envelope';
import { logoutSession } from '../../../../../server/auth/service';
import { clearRefreshCookie, REFRESH_COOKIE } from '../../../../../server/auth/cookies';

export const POST = route(async () => {
  const raw = cookies().get(REFRESH_COOKIE)?.value;
  await logoutSession(raw);
  const res = new NextResponse(null, { status: 204 });
  clearRefreshCookie(res);
  return res;
});
