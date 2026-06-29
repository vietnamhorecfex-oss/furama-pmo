/**
 * Budget CSV round-trip helpers. Export writes a UTF-8-BOM CSV (opens cleanly in Excel)
 * with a leading __CAP__ row carrying the project cap, then one row per category. Import
 * parses the Category + Planned columns back out (committed/actual are derived from tasks
 * and ignored on import). The __CAP__ row, if present, sets the project cap.
 */
import type { BudgetImportDto, BudgetSummary } from '@furama/shared';

const CAP_SENTINEL = '__CAP__';

export function buildBudgetCsv(b: BudgetSummary): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  lines.push(['Category', 'Planned', 'Committed', 'Actual', 'Utilization%'].join(','));
  lines.push([CAP_SENTINEL, b.capVnd, '', '', ''].map(esc).join(','));
  for (const c of [...b.byCategory].sort((x, y) => y.committedVnd - x.committedVnd)) {
    const util = c.plannedVnd > 0 ? Math.round((c.committedVnd / c.plannedVnd) * 100) : 0;
    lines.push([c.name, c.plannedVnd, c.committedVnd, c.actualVnd, util].map(esc).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

export function downloadBudgetCsv(b: BudgetSummary, filename = 'budget.csv'): void {
  const blob = new Blob([buildBudgetCsv(b)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Parse a budget CSV (or the same format pasted) into an import payload. Tolerates the
 *  exported 5-column shape or a minimal 2-column Category,Planned file. */
export function parseBudgetCsv(text: string): BudgetImportDto {
  const clean = text.replace(/^﻿/, '');
  const rows: { name: string; plannedVnd: number }[] = [];
  let capVnd: number | undefined;

  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const name = (cells[0] ?? '').trim();
    if (!name) continue;
    // Skip a header row (non-numeric Planned).
    const plannedRaw = (cells[1] ?? '').trim();
    const planned = Number(plannedRaw.replace(/[^\d-]/g, ''));
    if (!Number.isFinite(planned)) continue;
    if (i === 0 && !/^\d/.test(plannedRaw)) continue; // header like "Planned"
    if (name === CAP_SENTINEL) { capVnd = Math.max(0, planned); continue; }
    rows.push({ name, plannedVnd: Math.max(0, Math.trunc(planned)) });
  }
  return capVnd !== undefined ? { capVnd, rows } : { rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
