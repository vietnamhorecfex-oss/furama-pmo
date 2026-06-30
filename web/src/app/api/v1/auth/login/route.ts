import { NextResponse } from 'next/server';
import { loginSchema } from '@furama/shared';
import { route } from '../../../../../server/http/envelope';
import { loginUser } from '../../../../../server/auth/service';
import { setRefreshCookie } from '../../../../../server/auth/cookies';

function ip(req: Request) { return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null; }

export const POST = route(async (req) => {
  const dto = loginSchema.parse(await req.json());
  const { tokens, response } = await loginUser(dto, ip(req));
  const res = NextResponse.json(response, { status: 200 });
  setRefreshCookie(res, tokens);
  return res;
});
