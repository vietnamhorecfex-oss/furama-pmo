import { NextResponse } from 'next/server';
import { reorderSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { reorderPhases } from '@/server/config/phases';

// This folder (reorder/) must exist as a literal segment so Next.js does NOT
// capture "reorder" as the [id] dynamic param.
export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = reorderSchema.parse(await readJson(req));
  await reorderPhases(auth, projectId, dto, clientIp(req));
  return NextResponse.json(null, { status: 200 });
});
