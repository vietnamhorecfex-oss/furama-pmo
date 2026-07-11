import { NextResponse } from 'next/server';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { clientIp, readJson } from '@/server/http/request';
import { importPackedSeed } from '@/server/import-export/import-export';

// The canonical 628-row seed runs thousands of sequential queries; give it headroom over the
// serverless default so a large import doesn't time out mid-way into a partial state.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  // Pass raw JSON straight to importPackedSeed — it does its own packedSeedSchema.safeParse.
  return NextResponse.json(await importPackedSeed(auth, projectId, await readJson(req), clientIp(req)), { status: 200 });
});
