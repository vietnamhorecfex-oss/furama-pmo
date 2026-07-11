'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LoginResponse } from '@furama/shared';
import { api } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-store';

export function useLogin() {
  const setSession = useAuth((s) => s.setSession);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const { data } = await api.post<LoginResponse>('/auth/login', input);
      return data;
    },
    onSuccess: (data) => {
      // Drop any cached data from a previous session on this tab before the new user's data loads.
      qc.clear();
      setSession(data.accessToken, data.user);
    },
  });
}

export function useLogout() {
  const clear = useAuth((s) => s.clear);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post('/auth/logout');
    },
    // Wipe the React Query cache too — otherwise the next user on this browser sees the previous
    // user's projects/tasks/budget/notifications rendered from cache (clear() only reset the auth store).
    onSettled: () => {
      clear();
      qc.clear();
    },
  });
}
