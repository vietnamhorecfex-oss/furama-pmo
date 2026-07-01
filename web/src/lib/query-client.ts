import { QueryClient } from '@tanstack/react-query';

export const POLL_MS = 20_000;

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 10_000, refetchOnWindowFocus: true, retry: 1 },
    },
  });
}
