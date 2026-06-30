import { BadRequest } from './errors';

/** Best-effort client IP from the forwarded-for header (proxy sets it). */
export function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

/** Parse a JSON request body, turning malformed/missing bodies into a 400 (not a 500). */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadRequest('Invalid or missing JSON body');
  }
}
