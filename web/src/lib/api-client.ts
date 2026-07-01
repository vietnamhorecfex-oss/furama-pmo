'use client';
/**
 * W-01 — HTTP client with automatic access-token attach + silent refresh on 401.
 *
 * Single in-flight refresh: parallel 401s share one /auth/refresh call to avoid a stampede
 * that would otherwise burn the rate limit (10/min/IP) and trigger family revocation.
 */
import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';
import { useAuth } from './auth-store';

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true, // send the refresh cookie
});

api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshInflight: Promise<string | null> | null = null;

async function refreshAccessTokenOnce(): Promise<string | null> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    try {
      const res = await axios.post<{ accessToken: string }>('/api/v1/auth/refresh', undefined, {
        withCredentials: true,
      });
      useAuth.getState().setAccessToken(res.data.accessToken);
      return res.data.accessToken;
    } catch {
      useAuth.getState().clear();
      return null;
    } finally {
      refreshInflight = null;
    }
  })();
  return refreshInflight;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !original.url?.includes('/auth/')
    ) {
      original._retry = true;
      const fresh = await refreshAccessTokenOnce();
      if (fresh) {
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${fresh}`;
        return api.request(original);
      }
    }
    return Promise.reject(error);
  },
);
