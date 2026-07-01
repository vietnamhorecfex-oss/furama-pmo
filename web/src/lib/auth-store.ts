'use client';
import { create } from 'zustand';
import type { PublicUser } from '@furama/shared';

interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  setSession: (token: string, user: PublicUser) => void;
  setToken: (token: string) => void;
  setAccessToken: (token: string) => void;
  clear: () => void;
}
export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => set({ accessToken, user }),
  setToken: (accessToken) => set({ accessToken }),
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: () => set({ accessToken: null, user: null }),
}));
