'use client';
import { useQuery } from '@tanstack/react-query';
import type { UserLite } from '@furama/shared';
import { api } from '../../lib/api-client';

/** All active users in the caller's org — used to populate the add-member picker. */
export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async (): Promise<UserLite[]> => {
      const { data } = await api.get<UserLite[]>('/users');
      return data;
    },
  });
}
