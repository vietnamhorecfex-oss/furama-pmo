/**
 * W-01 — Auth store. Holds the access token in memory only (NEVER in localStorage —
 * XSS could exfiltrate it). The refresh cookie is httpOnly + SameSite=Strict; the SPA
 * does silent refresh by calling /auth/refresh which sets a fresh cookie + returns a
 * new access token.
 */
import { create } from 'zustand';
import type { PublicUser } from '@furama/shared';

interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  setSession: (accessToken: string, user: PublicUser) => void;
  setAccessToken: (token: string) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => set({ accessToken, user }),
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: () => set({ accessToken: null, user: null }),
}));
