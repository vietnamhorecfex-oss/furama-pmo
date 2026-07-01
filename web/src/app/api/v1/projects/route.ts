import { NextResponse } from 'next/server';
import { createProjectSchema } from '@furama/shared';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { listProjects, createProject } from '@/server/projects/projects';

export const GET = route(async (req) => {
  const ctx = getAuthContext(req);
  return NextResponse.json(await listProjects(ctx), { status: 200 });
});

export const POST = route(async (req) => {
  const ctx = getAuthContext(req);
  const dto = createProjectSchema.parse(await readJson(req));
  return NextResponse.json(await createProject(ctx, dto, clientIp(req)), { status: 201 });
});
