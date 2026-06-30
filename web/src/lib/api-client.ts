'use client';
import { useAuth } from './auth-store';

async function refresh(): Promise<string | null> {
  const res = await fetch('/api/v1/auth/refresh', { method: 'POST' });
  if (!res.ok) return null;
  const { accessToken } = (await res.json()) as { accessToken: string };
  useAuth.getState().setToken(accessToken);
  return accessToken;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = (token: string | null) =>
    fetch(`/api/v1${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

  let token = useAuth.getState().accessToken;
  let res = await doFetch(token);
  if (res.status === 401) {
    token = await refresh();
    if (token) res = await doFetch(token);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { code: 'INTERNAL', message: res.statusText } }));
    throw body;
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
