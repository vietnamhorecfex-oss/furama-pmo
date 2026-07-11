import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { route } from '../../../../../server/http/envelope';
import { refreshSession } from '../../../../../server/auth/service';
import { setRefreshCookie, REFRESH_COOKIE } from '../../../../../server/auth/cookies';
import { Unauthorized } from '../../../../../server/http/errors';
import { clientIp } from '../../../../../server/http/request';
import { enforceRateLimit } from '../../../../../server/http/rate-limit';
import { getConfig } from '../../../../../server/config';

export const POST = route(async (req) => {
  // Refresh requires a valid httpOnly cookie (not a guessing target), and many users can
  // share one office IP — use the generous write limit, not the tight login limit.
  enforceRateLimit('auth-refresh', clientIp(req), getConfig().RATE_LIMIT_WRITE_PER_MIN);
  const raw = cookies().get(REFRESH_COOKIE)?.value;
  if (!raw) throw new Unauthorized('Missing refresh cookie');
  const tokens = await refreshSession(raw, clientIp(req));
  const res = NextResponse.json({ accessToken: tokens.accessToken }, { status: 200 });
  setRefreshCookie(res, tokens);
  return res;
});
