import { NextResponse } from 'next/server';
import { loginSchema } from '@furama/shared';
import { route } from '../../../../../server/http/envelope';
import { loginUser } from '../../../../../server/auth/service';
import { setRefreshCookie } from '../../../../../server/auth/cookies';
import { clientIp, readJson } from '../../../../../server/http/request';
import { enforceRateLimit } from '../../../../../server/http/rate-limit';
import { getConfig } from '../../../../../server/config';

export const POST = route(async (req) => {
  enforceRateLimit('auth-login', clientIp(req), getConfig().RATE_LIMIT_AUTH_PER_MIN);
  const dto = loginSchema.parse(await readJson(req));
  const { tokens, response } = await loginUser(dto, clientIp(req));
  const res = NextResponse.json(response, { status: 200 });
  setRefreshCookie(res, tokens);
  return res;
});
