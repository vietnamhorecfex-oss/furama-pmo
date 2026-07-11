import { NextResponse } from 'next/server';
import { registerSchema } from '@furama/shared';
import { route } from '../../../../../server/http/envelope';
import { registerUser } from '../../../../../server/auth/service';
import { clientIp, readJson } from '../../../../../server/http/request';
import { enforceRateLimit } from '../../../../../server/http/rate-limit';
import { getConfig } from '../../../../../server/config';

export const POST = route(async (req) => {
  enforceRateLimit('auth-register', clientIp(req), getConfig().RATE_LIMIT_AUTH_PER_MIN);
  const dto = registerSchema.parse(await readJson(req));
  const out = await registerUser(dto, clientIp(req));
  return NextResponse.json(out, { status: 201 });
});
