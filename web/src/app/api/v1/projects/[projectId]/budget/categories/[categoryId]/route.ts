import { NextResponse } from 'next/server';
import { updateCategoryAmountsSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { setCategoryAmounts } from '@/server/budget/budget';

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, categoryId } = await ctx.params;
  const dto = updateCategoryAmountsSchema.parse(await readJson(req));
  return NextResponse.json(await setCategoryAmounts(auth, projectId, categoryId, dto, clientIp(req)), { status: 200 });
});
