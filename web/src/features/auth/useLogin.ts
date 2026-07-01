'use client';
import { useMutation } from '@tanstack/react-query';
import type { LoginResponse } from '@furama/shared';
import { api } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-store';

export function useLogin() {
  const setSession = useAuth((s) => s.setSession);
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const { data } = await api.post<LoginResponse>('/auth/login', input);
      return data;
    },
    onSuccess: (data) => setSession(data.accessToken, data.user),
  });
}

export function useLogout() {
  const clear = useAuth((s) => s.clear);
  return useMutation({
    mutationFn: async () => {
      await api.post('/auth/logout');
    },
    onSettled: () => clear(),
  });
}
