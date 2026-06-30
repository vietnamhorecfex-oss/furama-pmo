/**
 * CalendarView — monthly task calendar, tasks pinned to their deadline date.
 * Color-coded by status. Click task chip to open drawer.
 * Loads all tasks with deadlines in a 6-week window around the displayed month.
 */
import { useState, useMemo } from 'react';
import type { TaskDto, TaskStatus } from '@furama/shared';
import { useAllTasks } from '../tasks/useTasks';
import { useI18n } from '../../lib/i18n';

const STATUS_CHIP: Record<TaskStatus, string> = {
  NOT_STARTED: 'bg-slate-200 text-slate-700',
  IN_PROGRESS:  'bg-blue-200 text-blue-800',
  IN_REVIEW:    'bg-violet-200 text-violet-800',
  BLOCKED:      'bg-red-200 text-red-800',
  COMPLETED:    'bg-emerald-200 text-emerald-800',
};

const STATUS_DOT: Record<TaskStatus, string> = {
  NOT_STARTED: 'bg-slate-400',
  IN_PROGRESS:  'bg-blue-500',
  IN_REVIEW:    'bg-violet-500',
  BLOCKED:      'bg-red-500',
  COMPLETED:    'bg-emerald-500',
};

const WEEKDAYS_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  projectId: string;
  onOpen: (taskId: string) => void;
}

function startOfMonth(y: number, m: number) { return new Date(y, m, 1); }
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function isoDate(d: Date) { return d.toISOString().split('T')[0]; }

export function CalendarView({ projectId, onOpen }: Props) {
  const { t, lang } = useI18n();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Fetch all tasks (paged in chunks of 100); filter client-side to the month
  const list = useAllTasks(projectId, { sort: 'deadline', order: 'asc' });
  const tasks: TaskDto[] = list.data?.tasks ?? [];

  // Build calendar grid: 6 rows × 7 cols
  const firstDay = startOfMonth(year, month);
  const startOffset = firstDay.getDay(); // 0=Sun
  const totalDays = daysInMonth(year, month);

  // Map deadline → tasks
  const tasksByDate = useMemo(() => {
    const map = new Map<string, TaskDto[]>();
    for (const task of tasks) {
      if (!task.deadline) continue;
      const key = task.deadline.split('T')[0];
      const d = new Date(key);
      if (d.getFullYear() === year && d.getMonth() === month) {
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(task);
      }
    }
    return map;
  }, [tasks, year, month]);

  const selectedTasks = selectedDate ? (tasksByDate.get(selectedDate) ?? []) : [];

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
    setSelectedDate(null);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
    setSelectedDate(null);
  }

  const WEEKDAYS = lang === 'vi' ? WEEKDAYS_VI : WEEKDAYS_EN;
  const MONTH_NAMES = lang === 'vi'
    ? ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6',
       'Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']
    : ['January','February','March','April','May','June',
       'July','August','September','October','November','December'];

  const todayStr = isoDate(today);

  // Legend stats for the month
  const stats: Partial<Record<TaskStatus, number>> = {};
  for (const ts of tasksByDate.values()) {
    for (const t2 of ts) {
      stats[t2.status] = (stats[t2.status] ?? 0) + 1;
    }
  }
  const totalThisMonth = Object.values(stats).reduce((s, n) => s + n, 0);

  // Grid cells: 6 weeks × 7 days
  const cells: Array<{ date: string | null; day: number | null }> = [];
  for (let i = 0; i < startOffset; i++) cells.push({ date: null, day: null });
  for (let d = 1; d <= totalDays; d++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ date, day: d });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-slate-800">{t.calendarTitle}</h2>
          <button
            type="button"
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelectedDate(todayStr); }}
            className="text-xs px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
          >
            {t.today}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={prevMonth} className="p-1.5 rounded hover:bg-slate-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="font-semibold text-slate-700 min-w-[140px] text-center">
            {MONTH_NAMES[month]} {year}
          </span>
          <button type="button" onClick={nextMonth} className="p-1.5 rounded hover:bg-slate-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {totalThisMonth > 0 && (
            <span>{totalThisMonth} task deadline tháng này</span>
          )}
          {list.isFetching && <span className="text-indigo-500 animate-pulse">↻</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Calendar grid */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-slate-100">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-slate-500">{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7">
            {cells.map((cell, idx) => {
              if (!cell.date) {
                return <div key={`empty-${idx}`} className="min-h-[80px] bg-slate-50/50 border-b border-r border-slate-100" />;
              }
              const dayTasks = tasksByDate.get(cell.date) ?? [];
              const isToday = cell.date === todayStr;
              const isSelected = cell.date === selectedDate;
              const overflow = dayTasks.length > 3;

              return (
                <div
                  key={cell.date}
                  onClick={() => setSelectedDate(cell.date === selectedDate ? null : cell.date)}
                  className={`min-h-[80px] border-b border-r border-slate-100 p-1 cursor-pointer transition-colors ${
                    isSelected ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-400' :
                    isToday ? 'bg-amber-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className={`text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday ? 'bg-indigo-600 text-white' : 'text-slate-600'
                  }`}>
                    {cell.day}
                  </div>
                  <div className="space-y-0.5">
                    {dayTasks.slice(0, 3).map((task) => (
                      <div
                        key={task.id}
                        onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}
                        title={task.title}
                        className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] font-medium truncate cursor-pointer hover:opacity-80 ${STATUS_CHIP[task.status]}`}
                      >
                        <span className="truncate">{task.code || task.title}</span>
                      </div>
                    ))}
                    {overflow && (
                      <div className="text-[10px] text-slate-400 pl-1">+{dayTasks.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Side panel: selected day or legend */}
        <div className="space-y-4">
          {/* Status legend */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Chú giải trạng thái</h3>
            <div className="space-y-2">
              {(Object.keys(STATUS_DOT) as TaskStatus[]).map((s) => (
                <div key={s} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[s]}`} />
                    <span className="text-xs text-slate-600">{t[s as keyof typeof t] ?? s}</span>
                  </div>
                  <span className="text-xs font-medium text-slate-500">{stats[s] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Selected day tasks */}
          {selectedDate && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-indigo-50">
                <p className="text-sm font-semibold text-indigo-800">
                  {new Date(selectedDate + 'T00:00:00').toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
                <p className="text-xs text-indigo-600">{selectedTasks.length} task deadline</p>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-50">
                {selectedTasks.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">{t.noTasks}</p>
                ) : (
                  selectedTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onOpen(task.id)}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-mono text-slate-400">{task.code}</p>
                          <p className="text-sm text-slate-800 line-clamp-2">{task.title}</p>
                        </div>
                        <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${STATUS_CHIP[task.status]}`}>
                          {task.percent}%
                        </span>
                      </div>
                      <div className="mt-1 h-1 bg-slate-100 rounded">
                        <div className="h-1 rounded bg-indigo-400" style={{ width: `${task.percent}%` }} />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Mini progress summary for month */}
          {totalThisMonth > 0 && !selectedDate && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Tháng này</h3>
              <p className="text-3xl font-bold text-indigo-600">{totalThisMonth}</p>
              <p className="text-xs text-slate-500">task có deadline</p>
              <div className="mt-3 h-2 bg-slate-100 rounded overflow-hidden">
                <div
                  className="h-2 bg-emerald-500 rounded"
                  style={{ width: `${Math.round(((stats.COMPLETED ?? 0) / totalThisMonth) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {stats.COMPLETED ?? 0} / {totalThisMonth} hoàn thành
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
