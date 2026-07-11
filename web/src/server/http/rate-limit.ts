/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * Scope: single Next.js instance (no Redis in this architecture — see CLAUDE.md migration note).
 * It is intentionally process-local; behind multiple instances each replica limits independently,
 * which is still a meaningful brute-force / flood brake for the auth endpoints. For a horizontally
 * scaled deployment, back this with a shared store.
 *
 * The window is a fixed number of hits per rolling 60s per (bucket, key). `key` is normally the
 * client IP; when the IP is unknown we fall back to a shared bucket so the limit still applies.
 */
import { TooManyRequests } from './errors';

interface Hit {
  count: number;
  resetAt: number; // epoch ms when the current window expires
}

const WINDOW_MS = 60_000;
const store = new Map<string, Hit>();

// Opportunistic sweep so the map can't grow unbounded from one-off IPs.
function sweep(now: number): void {
  if (store.size < 5_000) return;
  for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
}

/**
 * Records one hit for `bucket:key` and throws {@link TooManyRequests} once `limit` is exceeded
 * within the rolling 60s window. Returns silently while under the limit.
 */
export function enforceRateLimit(bucket: string, key: string | null, limit: number): void {
  const now = Date.now();
  sweep(now);
  const id = `${bucket}:${key ?? 'unknown'}`;
  const hit = store.get(id);
  if (!hit || hit.resetAt <= now) {
    store.set(id, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  hit.count += 1;
  if (hit.count > limit) {
    const retryS = Math.ceil((hit.resetAt - now) / 1000);
    throw new TooManyRequests(`Too many requests. Try again in ${retryS}s.`);
  }
}

/** Test-only: clear all counters. */
export function resetRateLimits(): void {
  store.clear();
}
