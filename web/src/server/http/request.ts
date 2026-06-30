/** Best-effort client IP from the forwarded-for header (proxy sets it). */
export function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}
