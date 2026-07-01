import { NextResponse } from 'next/server';
import { updateProjectMetaSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { getProject, updateProjectMeta } from '@/server/projects/projects';

export const GET = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  return NextResponse.json(await getProject(auth, projectId), { status: 200 });
});

export const PATCH = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = updateProjectMetaSchema.parse(await readJson(req));
  return NextResponse.json(await updateProjectMeta(auth, projectId, dto, clientIp(req)), { status: 200 });
});
