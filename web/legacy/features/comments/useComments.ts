import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommentDto } from '@furama/shared';
import { api } from '../../lib/api-client';

export function useComments(taskId: string | undefined) {
  return useQuery({
    enabled: !!taskId,
    queryKey: ['comments', taskId],
    queryFn: async (): Promise<CommentDto[]> => {
      const { data } = await api.get<CommentDto[]>(`/tasks/${taskId}/comments`);
      return data;
    },
  });
}

export function useAddComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const { data } = await api.post<CommentDto>(`/tasks/${taskId}/comments`, { body });
      return data;
    },
    onSuccess: (c) => {
      qc.setQueryData<CommentDto[] | undefined>(['comments', taskId], (prev) =>
        prev ? [...prev, c] : [c],
      );
    },
  });
}
