import { NextResponse } from 'next/server';
import { setBudgetCapSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { setBudgetCap } from '@/server/budget/budget';

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = setBudgetCapSchema.parse(await readJson(req));
  return NextResponse.json(await setBudgetCap(auth, projectId, dto.capVnd, clientIp(req)), { status: 200 });
});
