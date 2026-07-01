import { NextResponse } from 'next/server';
import { updateBudgetCategorySchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { updateBudgetCategory, deleteBudgetCategory } from '@/server/config/categories';

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, id } = await ctx.params;
  const dto = updateBudgetCategorySchema.parse(await readJson(req));
  return NextResponse.json(await updateBudgetCategory(auth, projectId, id, dto, clientIp(req)), { status: 200 });
});

export const DELETE = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId, id } = await ctx.params;
  // budget-categories DELETE has NO query param
  await deleteBudgetCategory(auth, projectId, id, clientIp(req));
  return new NextResponse(null, { status: 204 });
});
