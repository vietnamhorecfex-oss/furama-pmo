import { NextResponse } from 'next/server';
import { registerSchema } from '@furama/shared';
import { route } from '../../../../../server/http/envelope';
import { registerUser } from '../../../../../server/auth/service';

function ip(req: Request) { return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null; }

export const POST = route(async (req) => {
  const dto = registerSchema.parse(await req.json());
  const out = await registerUser(dto, ip(req));
  return NextResponse.json(out, { status: 201 });
});
