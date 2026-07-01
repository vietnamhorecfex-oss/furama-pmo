import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { importPackedSeed } from '@/server/import-export/import-export';

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  // Pass raw JSON straight to importPackedSeed — it does its own packedSeedSchema.safeParse.
  return NextResponse.json(await importPackedSeed(auth, projectId, await readJson(req), clientIp(req)), { status: 200 });
});
