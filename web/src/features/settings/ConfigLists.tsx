'use client';
/**
 * C-03 — Config dimension lists: phases / workstreams / statuses / priorities / budget
 * categories. Each list supports create + delete. Edit + reorder happen via the REST API
 * directly; the UI exposes a Delete button per row and a Create form per tab.
 *
 * Referential guards and last-OWNER errors surface inline (server returns 409 / 400 with
 * a human-readable message that we render under the form).
 */
import { useState } from 'react';
import { useCreateDim, useDeleteDim, useDim, type DimKind, type DimRow } from './useConfig';
import { Spinner } from '../../components/Spinner';

type Field = { name: string; label: string; type: 'text' | 'number'; placeholder?: string; required?: boolean; default?: string };

const DIMS: Array<{ kind: DimKind; label: string; fields: Field[]; primary: 'name' | 'key' }> = [
  {
    kind: 'phases',
    label: 'Phases',
    primary: 'name',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'P0 - Executive Setup' },
      { name: 'order', label: 'Order', type: 'number', default: '0' },
    ],
  },
  {
    kind: 'workstreams',
    label: 'Workstreams',
    primary: 'name',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'track', label: 'Track (PMO|MARKETING|OPERATIONS)', type: 'text', default: 'PMO' },
      { name: 'order', label: 'Order', type: 'number', default: '0' },
    ],
  },
  {
    kind: 'statuses',
    label: 'Statuses',
    primary: 'key',
    fields: [
      { name: 'key', label: 'Key', type: 'text', required: true, placeholder: 'IN_REVIEW' },
      { name: 'color', label: 'Color (#hex)', type: 'text', default: '#94A3B8' },
      { name: 'order', label: 'Order', type: 'number', default: '0' },
    ],
  },
  {
    kind: 'priorities',
    label: 'Priorities',
    primary: 'key',
    fields: [
      { name: 'key', label: 'Key', type: 'text', required: true, placeholder: 'CRITICAL' },
      { name: 'color', label: 'Color (#hex)', type: 'text', default: '#7A8B99' },
      { name: 'order', label: 'Order', type: 'number', default: '0' },
    ],
  },
  {
    kind: 'budget-categories',
    label: 'Budget categories',
    primary: 'name',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'plannedVnd', label: 'Planned (VND)', type: 'number', default: '0' },
      { name: 'order', label: 'Order', type: 'number', default: '0' },
    ],
  },
];

interface Props { projectId: string }

export function ConfigLists({ projectId }: Props) {
  const [activeKind, setActiveKind] = useState<DimKind>('phases');
  const active = DIMS.find((d) => d.kind === activeKind)!;

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 px-4 py-2 flex gap-1 flex-wrap">
        {DIMS.map((d) => (
          <button
            key={d.kind}
            type="button"
            onClick={() => setActiveKind(d.kind)}
            className={`px-2 py-1 text-sm rounded ${activeKind === d.kind ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {d.label}
          </button>
        ))}
      </div>
      {/* key per dimension → remount on tab switch so the create-form state (which is seeded
          once from THIS dim's field defaults) doesn't bleed values across tabs. */}
      <DimSection key={active.kind} projectId={projectId} dim={active} />
    </div>
  );
}

function DimSection({
  projectId,
  dim,
}: {
  projectId: string;
  dim: (typeof DIMS)[number];
}) {
  const list = useDim(projectId, dim.kind);
  const create = useCreateDim(projectId, dim.kind);
  const del = useDeleteDim(projectId, dim.kind);
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(dim.fields.map((f) => [f.name, f.default ?? ''])),
  );

  return (
    <div className="p-4 space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = {};
          for (const f of dim.fields) {
            const raw = vals[f.name];
            if (raw === undefined || raw === '') continue;
            body[f.name] = f.type === 'number' ? Number(raw) : raw;
          }
          create.mutate(body, {
            onSuccess: () => {
              setVals(Object.fromEntries(dim.fields.map((f) => [f.name, f.default ?? ''])));
            },
          });
        }}
        className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end"
      >
        {dim.fields.map((f) => (
          <label key={f.name} className="block text-sm">
            <span className="text-xs text-slate-500">{f.label}{f.required ? ' *' : ''}</span>
            <input
              type={f.type}
              required={f.required}
              placeholder={f.placeholder}
              value={vals[f.name] ?? ''}
              onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
        ))}
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-indigo-600 text-white text-sm px-3 py-1.5 disabled:opacity-60"
        >
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>
      {(create.isError || del.isError) && (
        <p className="text-xs text-red-700">
          {((create.error ?? del.error) as { response?: { data?: { error?: { message?: string } } } })
            ?.response?.data?.error?.message ?? 'Operation failed.'}
        </p>
      )}

      {list.isLoading ? (
        <div className="py-4"><Spinner className="h-5 w-5" /></div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.data?.map((row: DimRow) => (
            <li key={row.id} className="py-2 flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-mono w-8 tabular-nums">{row.order}</span>
                <span className="text-slate-800">
                  {dim.primary === 'name' ? row.name : row.key}
                </span>
                {row.track && <span className="text-xs text-slate-500">· {row.track}</span>}
                {row.color && (
                  <span
                    className="inline-block w-3 h-3 rounded-sm border border-slate-300"
                    style={{ backgroundColor: row.color }}
                    title={row.color}
                  />
                )}
                {row.plannedVnd !== undefined && (
                  <span className="text-xs text-slate-500">· planned ₫{row.plannedVnd.toLocaleString()}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => { if (confirm('Delete this entry?')) del.mutate(row.id); }}
                className="text-xs text-red-600 hover:underline"
              >Delete</button>
            </li>
          ))}
          {list.data && list.data.length === 0 && (
            <li className="text-sm text-slate-400 py-2">No entries yet.</li>
          )}
        </ul>
      )}
    </div>
  );
}