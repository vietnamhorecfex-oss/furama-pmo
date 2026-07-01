'use client';
/**
 * W-08 — Budget management dashboard.
 * KPI strip (cap / planned / committed / actual / remaining) with cap-utilization bar,
 * per-workstream breakdown, searchable per-category table (planned vs committed vs actual)
 * with overrun flags, and an overrun-alerts panel. All amounts from /budget/summary.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBudgetSummary } from '../dashboard/useDashboard';
import { useSetBudgetCap, useSetCategoryAmounts, useImportBudget } from './useBudget';
import type { BudgetCategorySummary } from '@furama/shared';
import { downloadBudgetCsv, parseBudgetCsv } from './budgetCsv';
import { formatVnd, formatVndFull } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { usePermissions } from '../../lib/permissions';
import { PageLoader } from '../../components/Spinner';

interface Props { projectId: string }

const TOP_N = 12;

export function BudgetPanel({ projectId }: Props) {
  const { t } = useI18n();
  const q = useBudgetSummary(projectId);
  const { can } = usePermissions(projectId);
  const canEdit = can('MANAGE_BUDGET');
  const setCap = useSetBudgetCap(projectId);
  const setCategory = useSetCategoryAmounts(projectId);
  const importBudget = useImportBudget(projectId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    importBudget.mutate(parseBudgetCsv(text));
  }

  const b = q.data;
  const overrunIds = useMemo(
    () => new Set((b?.overruns ?? []).map((o) => o.categoryId)),
    [b],
  );

  const filteredCats = useMemo(() => {
    if (!b) return [];
    const term = search.trim().toLowerCase();
    return b.byCategory
      .filter((c) => !term || c.name.toLowerCase().includes(term))
      .sort((x, y) => y.committedVnd - x.committedVnd);
  }, [b, search]);

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !b) return <p className="text-red-600">{t.error}</p>;

  const remaining = b.capVnd - b.committedVnd;
  const capPct = b.capVnd > 0 ? (b.committedVnd / b.capVnd) * 100 : 0;
  const actualPct = b.capVnd > 0 ? (b.actualVnd / b.capVnd) * 100 : 0;
  const totalCommitted = b.committedVnd || 1;
  const visibleCats = showAll || search ? filteredCats : filteredCats.slice(0, TOP_N);

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h3 className="font-semibold text-slate-800">{t.projectTotals}</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => downloadBudgetCsv(b, `budget-${projectId}.csv`)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              ↓ {t.exportExcel}
            </button>
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={importBudget.isPending}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
                  title={t.importHint}
                >
                  ↑ {importBudget.isPending ? t.importingBudget : t.importExcel}
                </button>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onImportFile} />
              </>
            )}
          </div>
        </div>
        {importBudget.isSuccess && importBudget.data && (
          <p className="text-xs text-emerald-700 mb-2">
            {t.budgetImportedMsg.replace('{u}', String(importBudget.data.updated)).replace('{c}', String(importBudget.data.created))}
          </p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div>
            <p className="text-xs uppercase text-slate-500 tracking-wide">{t.cap}</p>
            <EditableAmount
              value={b.capVnd}
              canEdit={canEdit}
              pending={setCap.isPending}
              onSave={(v) => setCap.mutate(v)}
              className="text-lg font-semibold text-slate-900"
            />
          </div>
          <Cell label={t.planned} value={formatVnd(b.plannedVnd)} title={formatVndFull(b.plannedVnd)} />
          <Cell label={t.committed} value={formatVnd(b.committedVnd)} title={formatVndFull(b.committedVnd)} accent={b.overCap ? 'text-red-700' : 'text-slate-900'} />
          <Cell label={t.actual} value={formatVnd(b.actualVnd)} title={formatVndFull(b.actualVnd)} />
          <Cell
            label={t.remaining}
            value={formatVnd(remaining)}
            title={formatVndFull(remaining)}
            accent={remaining < 0 ? 'text-red-700' : 'text-emerald-700'}
          />
        </div>

        {/* Cap utilization bar */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>{t.capUtilization}</span>
            <span className="tabular-nums">
              {capPct.toFixed(1)}% {t.ofCap}
              {remaining >= 0 && <span className="text-emerald-600"> · {t.headroom} {formatVnd(remaining)}</span>}
            </span>
          </div>
          <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
            {/* committed */}
            <div
              className={`absolute inset-y-0 left-0 ${b.overCap ? 'bg-red-500' : 'bg-indigo-500'}`}
              style={{ width: `${Math.min(100, capPct)}%` }}
            />
            {/* actual (on top, darker) */}
            <div
              className="absolute inset-y-0 left-0 bg-emerald-600"
              style={{ width: `${Math.min(100, actualPct)}%` }}
            />
          </div>
          <div className="flex gap-4 mt-1.5 text-[11px] text-slate-500">
            <Legend color="bg-indigo-500" label={`${t.committed} ${formatVnd(b.committedVnd)}`} />
            <Legend color="bg-emerald-600" label={`${t.actual} ${formatVnd(b.actualVnd)}`} />
          </div>
        </div>

        {b.overCap && (
          <p className="text-sm text-red-700 mt-3 bg-red-50 border border-red-200 rounded px-2 py-1.5">
            ⚠ {t.overCapWarn} — {t.overCapBy} {formatVndFull(b.committedVnd - b.capVnd)}.
          </p>
        )}
      </div>

      {/* By workstream */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-800 mb-3">{t.byWorkstream}</h3>
        <ul className="space-y-3">
          {b.byWorkstream
            .slice()
            .sort((x, y) => y.committedVnd - x.committedVnd)
            .map((w) => {
              const pct = (w.committedVnd / totalCommitted) * 100;
              return (
                <li key={w.workstreamId ?? 'unassigned'}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-800 font-medium">{w.name}</span>
                    <span className="text-slate-500 tabular-nums" title={formatVndFull(w.committedVnd)}>
                      {formatVnd(w.committedVnd)}
                      <span className="text-slate-400"> · {pct.toFixed(0)}% {t.ofTotal}</span>
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-2.5 bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          {b.byWorkstream.length === 0 && <li className="text-sm text-slate-400">{t.noSpendYet}</li>}
        </ul>
      </div>

      {/* Overrun alerts */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-800 mb-3">{t.overrunsTitle}</h3>
        {b.overruns.length === 0 ? (
          <p className="text-sm text-emerald-700 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> {t.noOverruns}
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {b.overruns
              .slice()
              .sort((x, y) => y.overByVnd - x.overByVnd)
              .map((o) => (
                <li key={o.categoryId} className="flex justify-between bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                  <span className="text-amber-900">{o.name}</span>
                  <span className="text-amber-800 tabular-nums" title={formatVndFull(o.committedVnd)}>
                    {formatVnd(o.committedVnd)} / {formatVnd(o.plannedVnd)}
                    <span className="font-semibold"> (+{formatVnd(o.overByVnd)})</span>
                  </span>
                </li>
              ))}
          </ul>
        )}
      </div>

      {/* By category */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h3 className="font-semibold text-slate-800">
            {t.byCategory}
            <span className="ml-2 text-xs font-normal text-slate-400">
              {filteredCats.length} {t.categories}
            </span>
          </h3>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchCategory}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm w-48"
          />
        </div>

        <ul className="space-y-3">
          {visibleCats.map((c) => (
            <CategoryRow
              key={c.categoryId}
              c={c}
              isOverrun={overrunIds.has(c.categoryId)}
              canEdit={canEdit}
              pending={setCategory.isPending}
              onSave={(plannedVnd, actualVnd) => setCategory.mutate({ categoryId: c.categoryId, plannedVnd, actualVnd })}
              t={t}
            />
          ))}
          {filteredCats.length === 0 && (
            <li className="text-sm text-slate-400">{t.noCategoriesConfigured}</li>
          )}
        </ul>

        {!search && filteredCats.length > TOP_N && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="mt-3 text-sm text-indigo-600 hover:text-indigo-800"
          >
            {showAll ? t.showLess : `${t.showAll} (${filteredCats.length})`}
          </button>
        )}
      </div>
    </div>
  );
}

/** One category row: bars + amounts; click Edit to change Planned & Actual, then Save. */
function CategoryRow({
  c, isOverrun, canEdit, pending, onSave, t,
}: {
  c: BudgetCategorySummary;
  isOverrun: boolean;
  canEdit: boolean;
  pending: boolean;
  onSave: (plannedVnd: number, actualVnd: number) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const [editing, setEditing] = useState(false);
  const [planned, setPlanned] = useState(c.plannedVnd);
  const [actual, setActual] = useState(c.actualVnd);
  useEffect(() => { setPlanned(c.plannedVnd); setActual(c.actualVnd); }, [c.plannedVnd, c.actualVnd]);

  const max = Math.max(c.plannedVnd, c.committedVnd, c.actualVnd, 1);
  const util = c.plannedVnd > 0 ? (c.committedVnd / c.plannedVnd) * 100 : 0;

  function save() {
    onSave(Math.max(0, Math.trunc(planned)), Math.max(0, Math.trunc(actual)));
    setEditing(false);
  }

  return (
    <li className="rounded-lg border border-transparent hover:border-slate-100 hover:bg-slate-50/40 px-1 py-1">
      <div className="flex justify-between items-center text-sm gap-2">
        <span className="text-slate-800">
          {c.name}
          {isOverrun ? (
            <span className="ml-2 text-xs rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5">{t.overrun}</span>
          ) : (
            <span className="ml-2 text-xs rounded-full bg-emerald-50 text-emerald-700 px-1.5 py-0.5">{util.toFixed(0)}%</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-slate-500 tabular-nums" title={`${formatVndFull(c.committedVnd)} / ${formatVndFull(c.plannedVnd)}`}>
            {formatVnd(c.committedVnd)} / {formatVnd(c.plannedVnd)}
          </span>
          {canEdit && !editing && (
            <button type="button" onClick={() => setEditing(true)}
              className="text-xs text-indigo-600 hover:text-indigo-800 border border-slate-200 rounded px-2 py-0.5">
              {t.edit}
            </button>
          )}
        </span>
      </div>

      {editing ? (
        <div className="mt-2 flex flex-wrap items-end gap-3 bg-white border border-indigo-100 rounded-lg p-2">
          <label className="text-xs text-slate-500">
            <span className="block mb-0.5">{t.planned}</span>
            <input type="number" min={0} step={1_000_000} value={planned} disabled={pending}
              onChange={(e) => setPlanned(Number(e.target.value))}
              className="w-40 rounded border border-slate-300 px-2 py-1 text-sm tabular-nums" />
          </label>
          <label className="text-xs text-slate-500">
            <span className="block mb-0.5">{t.actual}</span>
            <input type="number" min={0} step={1_000_000} value={actual} disabled={pending} autoFocus
              onChange={(e) => setActual(Number(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
              className="w-40 rounded border border-slate-300 px-2 py-1 text-sm tabular-nums" />
          </label>
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={() => { setEditing(false); setPlanned(c.plannedVnd); setActual(c.actualVnd); }}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">{t.cancel}</button>
            <button type="button" onClick={save} disabled={pending}
              className="rounded bg-indigo-600 text-white px-3 py-1 text-sm disabled:opacity-60">
              {pending ? t.savingProgress : t.save}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 grid grid-cols-1 gap-1">
          <Bar fill="bg-slate-300" pct={(c.plannedVnd / max) * 100} label={t.planned} />
          <Bar fill={isOverrun ? 'bg-red-500' : 'bg-indigo-500'} pct={(c.committedVnd / max) * 100} label={t.committed} />
          <Bar fill="bg-emerald-600" pct={(c.actualVnd / max) * 100} label={`${t.actual} ${formatVnd(c.actualVnd)}`} />
        </div>
      )}
    </li>
  );
}

/** Shows a formatted VND amount; click (when editable) to edit it inline. */
function EditableAmount({
  value, canEdit, pending, onSave, className = '',
}: {
  value: number;
  canEdit: boolean;
  pending: boolean;
  onSave: (v: number) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  if (!canEdit) {
    return <span className={`tabular-nums ${className}`} title={formatVndFull(value)}>{formatVnd(value)}</span>;
  }
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(value); setEditing(true); }}
        className={`tabular-nums border-b border-dashed border-slate-300 hover:border-indigo-400 ${className}`}
        title={`${formatVndFull(value)} — ${'click to edit'}`}
      >
        {formatVnd(value)}
      </button>
    );
  }
  const commit = () => { setEditing(false); if (draft !== value) onSave(Math.max(0, Math.trunc(draft))); };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min={0}
        step={1_000_000}
        autoFocus
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(Number(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        onBlur={commit}
        className="w-36 rounded border border-indigo-300 px-1.5 py-0.5 text-sm tabular-nums"
      />
    </span>
  );
}

function Cell({ label, value, accent = 'text-slate-900', title }: { label: string; value: string; accent?: string; title?: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-slate-500 tracking-wide">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${accent}`} title={title}>{value}</p>
    </div>
  );
}

function Bar({ fill, pct, label }: { fill: string; pct: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-20 text-slate-500 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded overflow-hidden">
        <div className={`h-2 ${fill}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`w-2.5 h-2.5 rounded-sm ${color}`} /> {label}
    </span>
  );
}