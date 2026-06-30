import { dbHealthy } from '../../../server/prisma';
export const dynamic = 'force-dynamic';
export async function GET() {
  const ok = await dbHealthy();
  return Response.json({ status: ok ? 'ready' : 'unhealthy' }, { status: ok ? 200 : 503 });
}
