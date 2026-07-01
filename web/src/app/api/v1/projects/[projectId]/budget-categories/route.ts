import { NextResponse } from 'next/server';
import { createBudgetCategorySchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { listBudgetCategories, createBudgetCategory } from '@/server/config/categories';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  return NextResponse.json(await listBudgetCategories(auth, projectId), { status: 200 });
});

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = createBudgetCategorySchema.parse(await readJson(req));
  return NextResponse.json(await createBudgetCategory(auth, projectId, dto, clientIp(req)), { status: 201 });
});
