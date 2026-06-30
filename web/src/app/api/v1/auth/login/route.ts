import { NextResponse } from 'next/server';
import { loginSchema } from '@furama/shared';
import { route } from '../../../../../server/http/envelope';
import { loginUser } from '../../../../../server/auth/service';
import { setRefreshCookie } from '../../../../../server/auth/cookies';
import { clientIp } from '../../../../../server/http/request';

export const POST = route(async (req) => {
  const dto = loginSchema.parse(await req.json());
  const { tokens, response } = await loginUser(dto, clientIp(req));
  const res = NextResponse.json(response, { status: 200 });
  setRefreshCookie(res, tokens);
  return res;
});
