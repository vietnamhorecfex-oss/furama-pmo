import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/server/http/envelope';
import { getAuthContext } from '@/server/auth/session';
import { readJson } from '@/server/http/request';
import { chat } from '@/server/ai/assistant';

export const maxDuration = 60;

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
}).strict();

export const POST = route(async (req, ctx) => {
  const auth = getAuthContext(req);
  const { projectId } = await ctx.params;
  const dto = chatSchema.parse(await readJson(req));
  return NextResponse.json(
    await chat(auth, projectId, dto.message, dto.conversationId),
    { status: 200 },
  );
});
