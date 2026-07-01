'use client';
/**
 * C-03 — Settings page: project meta block + 5 config-dimension lists in tabs.
 * Editing is OWNER/PM-only on the server; the UI still shows the controls — failed mutations
 * surface the 403 message inline so users understand they need elevated rights.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProjectDto, UpdateProjectMetaDto } from '@furama/shared';
import { api } from '../../lib/api-client';
import { ConfigLists } from './ConfigLists';
import { useProjects } from '../projects/useProjects';
import { Spinner } from '../../components/Spinner';

interface Props { projectId: string }

export function SettingsPage({ projectId }: Props) {
  const projects = useProjects();
  const project = projects.data?.find((p) => p.id === projectId);
  return (
    <div className="space-y-4">
      {project ? <MetaBlock project={project} /> : <div className="py-6"><Spinner /></div>}
      <ConfigLists projectId={projectId} />
    </div>
  );
}

function MetaBlock({ project }: { project: ProjectDto }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<UpdateProjectMetaDto>({});
  const save = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch<ProjectDto>(`/projects/${project.id}`, form);
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setForm({}); },
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-800 mb-3">Project meta</h3>
      <form
        onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
        className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm"
      >
        <Field label="Name">
          <input
            type="text"
            defaultValue={project.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5"
          />
        </Field>
        <Field label="Location">
          <input
            type="text"
            defaultValue={project.location ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5"
          />
        </Field>
        <Field label="Start date">
          <input
            type="date"
            defaultValue={project.startDate?.slice(0, 10) ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value || null }))}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5"
          />
        </Field>
        <Field label="End date">
          <input
            type="date"
            defaultValue={project.endDate?.slice(0, 10) ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value || null }))}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5"
          />
        </Field>
        <Field label="Opening date">
          <input
            type="date"
            defaultValue={project.openingDate?.slice(0, 10) ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, openingDate: e.target.value || null }))}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5"
          />
        </Field>
        <Field label="Budget cap (VND)">
          <input
            type="number"
            min={0}
            defaultValue={project.budgetCapVnd}
            onChange={(e) => setForm((f) => ({ ...f, budgetCapVnd: Number(e.target.value) }))}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5"
          />
        </Field>
        <div className="md:col-span-2 flex justify-end items-center gap-3">
          {save.isError && (
            <span className="text-xs text-red-700">
              {(save.error as { response?: { data?: { error?: { message?: string } } } })
                .response?.data?.error?.message ?? 'Failed to save'}
            </span>
          )}
          {save.isSuccess && <span className="text-xs text-emerald-700">Saved</span>}
          <button
            type="submit"
            disabled={save.isPending || Object.keys(form).length === 0}
            className="rounded bg-indigo-600 text-white text-sm px-3 py-1.5 disabled:opacity-60"
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase text-slate-500 tracking-wide">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}