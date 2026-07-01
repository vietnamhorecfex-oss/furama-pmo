'use client';
/**
 * C-05 — Import/Export panel.
 *
 *   Import: upload a packed-seed JSON file (cols/rows shape from docs/02 §6) →
 *     POST /projects/:pid/import → display the result counts inline.
 *   Export: trigger a GET that downloads the file (JSON or CSV); we open the
 *     authenticated request via axios then create a blob URL so the browser saves it.
 */
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../../lib/api-client';

interface Props { projectId: string }

interface ImportResult {
  inserted: number;
  updated: number;
  total: number;
  workstreamsCreated: number;
  phasesCreated: number;
  unknownStatuses: string[];
  unknownPriorities: string[];
}

export function ImportExportPanel({ projectId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const importMutation = useMutation({
    mutationFn: async (file: File): Promise<ImportResult> => {
      const text = await file.text();
      const body = JSON.parse(text);
      const { data } = await api.post<ImportResult>(`/projects/${projectId}/import`, body);
      return data;
    },
    onSuccess: (r) => setResult(r),
  });

  const downloadExport = async (kind: 'json' | 'csv') => {
    const url = kind === 'json'
      ? `/projects/${projectId}/export`
      : `/projects/${projectId}/export/tasks.csv`;
    const { data } = await api.get(url, { responseType: 'blob' });
    const blob = data as Blob;
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = kind === 'json' ? `project-${projectId}.json` : `tasks-${projectId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-800 mb-2">Import packed seed (JSON)</h3>
        <p className="text-xs text-slate-500 mb-3">
          Upsert by <code className="bg-slate-100 px-1">(projectId, code)</code>. Re-importing
          the same file leaves the row count unchanged (idempotent).
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="text-sm"
          />
          <button
            type="button"
            disabled={importMutation.isPending}
            onClick={() => {
              const f = fileRef.current?.files?.[0];
              if (f) importMutation.mutate(f);
            }}
            className="rounded bg-indigo-600 text-white text-sm px-3 py-1.5 disabled:opacity-60"
          >
            {importMutation.isPending ? 'Importing…' : 'Import'}
          </button>
        </div>
        {importMutation.isError && (
          <p className="text-sm text-red-700 mt-2">
            {(importMutation.error as { response?: { data?: { error?: { message?: string } } } })
              .response?.data?.error?.message ?? 'Import failed.'}
          </p>
        )}
        {result && (
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <Stat label="Inserted" value={result.inserted} />
            <Stat label="Updated" value={result.updated} />
            <Stat label="Total" value={result.total} />
            <Stat label="Workstreams +" value={result.workstreamsCreated} />
            <Stat label="Phases +" value={result.phasesCreated} />
            {result.unknownStatuses.length > 0 && (
              <Stat label="Unknown statuses" value={result.unknownStatuses.length} accent="text-amber-700" />
            )}
            {result.unknownPriorities.length > 0 && (
              <Stat label="Unknown priorities" value={result.unknownPriorities.length} accent="text-amber-700" />
            )}
          </dl>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-800 mb-2">Export</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => downloadExport('json')}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Download project JSON
          </button>
          <button
            type="button"
            onClick={() => downloadExport('csv')}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Download tasks CSV
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent = '' }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-500 tracking-wide">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${accent || 'text-slate-900'}`}>{value}</dd>
    </div>
  );
}