'use client';
/**
 * AI Digest panel — one-click "Nhắc việc" (reminders) and "Tổng kết dự án" (recap).
 * Calls the read-only GET /ai/reminders and /ai/summary endpoints and renders the
 * returned Vietnamese markdown. A badge shows whether the text came from the LLM or
 * the deterministic rule-based fallback (when no AI key is configured).
 */
import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { Spinner } from '../../components/Spinner';

interface DigestResult {
  markdown: string;
  generatedByAI: boolean;
  data: unknown;
}

type Kind = 'reminders' | 'summary';

export function DigestPanel({ projectId }: { projectId: string }) {
  const [active, setActive] = useState<Kind | null>(null);
  const [result, setResult] = useState<DigestResult | null>(null);

  const run = useMutation({
    mutationFn: async (kind: Kind) => {
      const res = await api.get<DigestResult>(`/projects/${projectId}/ai/${kind}`);
      return res.data;
    },
    onSuccess: (data) => setResult(data),
  });

  function trigger(kind: Kind) {
    setActive(kind);
    setResult(null);
    run.mutate(kind);
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => trigger('reminders')}
          disabled={run.isPending}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            active === 'reminders' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          🔔 Nhắc việc
        </button>
        <button
          type="button"
          onClick={() => trigger('summary')}
          disabled={run.isPending}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            active === 'summary' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          📋 Tổng kết dự án
        </button>
        {result && (
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
              result.generatedByAI ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'
            }`}
            title={result.generatedByAI ? 'Do AI soạn' : 'Tự động (chưa bật AI — cần GEMINI_API_KEY hoặc ANTHROPIC_API_KEY)'}
          >
            {result.generatedByAI ? '✨ AI' : '⚙️ Tự động'}
          </span>
        )}
      </div>

      <div className="mt-3 min-h-[60px]">
        {run.isPending && (
          <div className="flex items-center gap-2 py-6 text-slate-400">
            <Spinner className="h-5 w-5" />
            <span className="text-sm">Đang tạo…</span>
          </div>
        )}
        {run.isError && !run.isPending && (
          <p className="py-4 text-sm text-red-600">Không tạo được. Vui lòng thử lại.</p>
        )}
        {result && !run.isPending && (
          <div className="prose-sm max-w-none text-sm leading-relaxed text-slate-700">
            {renderMarkdown(result.markdown)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── minimal, safe markdown renderer (headings, bold, italic, bullet lists) ──────

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*([^*]+)\*\*|_([^_]+)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) nodes.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<em key={key++}>{m[3]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderMarkdown(md: string): ReactNode {
  const lines = md.split('\n');
  const out: ReactNode[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (!list.length) return;
    out.push(
      <ul key={`ul-${key++}`} className="my-1 list-disc space-y-0.5 pl-5">
        {list.map((li, i) => (
          <li key={i}>{renderInline(li)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*-\s+/.test(line)) {
      list.push(line.replace(/^\s*-\s+/, ''));
      continue;
    }
    flushList();
    if (line.startsWith('### ')) {
      out.push(<h4 key={key++} className="mt-3 mb-1 font-semibold text-slate-800">{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith('## ')) {
      out.push(<h3 key={key++} className="mt-2 mb-1 text-base font-bold text-slate-900">{renderInline(line.slice(3))}</h3>);
    } else if (line.trim() === '') {
      out.push(<div key={key++} className="h-2" />);
    } else {
      out.push(<p key={key++} className="my-0.5">{renderInline(line)}</p>);
    }
  }
  flushList();
  return out;
}
