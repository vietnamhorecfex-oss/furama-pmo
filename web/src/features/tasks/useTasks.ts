import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuditLogDto,
  ListTasksQuery,
  Paginated,
  ProgressUpdateDto,
  TaskDto,
} from '@furama/shared';
import { api } from '../../lib/api-client';

export function useTasks(projectId: string | undefined, query: Partial<ListTasksQuery>) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ['tasks', projectId, query],
    queryFn: async (): Promise<Paginated<TaskDto>> => {
      const { data } = await api.get<Paginated<TaskDto>>(`/projects/${projectId}/tasks`, {
        params: query,
      });
      return data;
    },
  });
}

export function useTask(taskId: string | undefined) {
  return useQuery({
    enabled: !!taskId,
    queryKey: ['task', taskId],
    queryFn: async (): Promise<TaskDto> => {
      const { data } = await api.get<TaskDto>(`/tasks/${taskId}`);
      return data;
    },
  });
}

export function useUpdateProgress(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { taskId: string; payload: ProgressUpdateDto }) => {
      const { data } = await api.patch<TaskDto>(`/tasks/${vars.taskId}/progress`, vars.payload);
      return data;
    },
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
      qc.invalidateQueries({ queryKey: ['task-history', task.id] });
      qc.setQueryData(['task', task.id], task);
    },
  });
}

/** Full audit trail for one task (status/percent/note changes), newest first. */
export function useTaskHistory(projectId: string | undefined, taskId: string | undefined) {
  return useQuery({
    enabled: !!projectId && !!taskId,
    queryKey: ['task-history', taskId],
    queryFn: async (): Promise<AuditLogDto[]> => {
      const { data } = await api.get<AuditLogDto[]>(
        `/projects/${projectId}/activity/history/Task/${taskId}`,
      );
      return data;
    },
  });
}
