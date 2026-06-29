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

/**
 * Fetch every task for a project for views that need the whole set (Board, Calendar).
 * The list API caps pageSize at 100, so we page through in chunks of 100 (page 1 first
 * to learn the total, then the rest in parallel) up to `cap` items. The query key is
 * prefixed with ['tasks', projectId, …] so WS task events invalidate it like the table.
 */
export function useAllTasks(
  projectId: string | undefined,
  opts?: { sort?: string; order?: 'asc' | 'desc'; cap?: number },
) {
  const sort = opts?.sort ?? 'code';
  const order = opts?.order ?? 'asc';
  const cap = opts?.cap ?? 2000;
  return useQuery({
    enabled: !!projectId,
    queryKey: ['tasks', projectId, 'all', sort, order, cap],
    queryFn: async (): Promise<{ tasks: TaskDto[]; total: number; truncated: boolean }> => {
      const pageSize = 100;
      const fetchPage = async (page: number) => {
        const { data } = await api.get<Paginated<TaskDto>>(`/projects/${projectId}/tasks`, {
          params: { page, pageSize, sort, order },
        });
        return data;
      };
      const first = await fetchPage(1);
      const tasks = [...first.data];
      const wanted = Math.min(first.total, cap);
      const pages = Math.ceil(wanted / pageSize);
      if (pages > 1) {
        const rest = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) => fetchPage(i + 2)),
        );
        for (const r of rest) tasks.push(...r.data);
      }
      return { tasks, total: first.total, truncated: first.total > wanted };
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
