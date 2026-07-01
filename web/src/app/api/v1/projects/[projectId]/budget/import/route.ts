import { NextResponse } from 'next/server';
import { budgetImportSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { importBudget } from '@/server/budget/budget';

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = budgetImportSchema.parse(await readJson(req));
  return NextResponse.json(await importBudget(auth, projectId, dto, clientIp(req)), { status: 200 });
});
