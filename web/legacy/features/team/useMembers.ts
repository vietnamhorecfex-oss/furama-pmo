import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddMemberDto, MemberDto, UpdateMemberDto } from '@furama/shared';
import { api } from '../../lib/api-client';

export function useMembers(projectId: string | undefined) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ['members', projectId],
    queryFn: async (): Promise<MemberDto[]> => {
      const { data } = await api.get<MemberDto[]>(`/projects/${projectId}/members`);
      return data;
    },
  });
}

export function useAddMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: AddMemberDto) => {
      const { data } = await api.post<MemberDto>(`/projects/${projectId}/members`, dto);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', projectId] }),
  });
}

export function useUpdateMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { memberId: string; dto: UpdateMemberDto }) => {
      const { data } = await api.patch<MemberDto>(
        `/projects/${projectId}/members/${vars.memberId}`,
        vars.dto,
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', projectId] }),
  });
}

export function useRemoveMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      await api.delete(`/projects/${projectId}/members/${memberId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', projectId] }),
  });
}
