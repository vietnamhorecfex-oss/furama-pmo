/**
 * M8 — AI Assistant chat panel.
 *
 * Renders a chat UI with message history. Write-tool proposals appear as
 * inline action cards with Confirm / Reject buttons.
 *
 * Messages: user bubbles on the right, assistant on the left.
 * Proposed actions: indigo card below the assistant message with a preview
 * and confirm/reject buttons; confirming calls POST /ai/actions/:id/confirm.
 */
import { useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api-client';

interface ProposedAction {
  actionId: string;
  tool: string;
  preview: unknown;
  args: unknown;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  actions?: ProposedAction[];
}

interface ChatResponse {
  reply: string;
  proposedActions: ProposedAction[];
  conversationId: string;
}

export function AssistantPanel({ projectId }: { projectId: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [convId, setConvId] = useState<string | undefined>(undefined);
  const [actionStates, setActionStates] = useState<Record<string, 'pending' | 'confirmed' | 'rejected'>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await api.post<ChatResponse>(`/projects/${projectId}/ai/chat`, {
        message,
        conversationId: convId,
      });
      return res.data;
    },
    onMutate: (message) => {
      setTurns((prev) => [...prev, { role: 'user', content: message }]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    },
    onSuccess: (data) => {
      if (!convId) setConvId(data.conversationId);
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply, actions: data.proposedActions },
      ]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (actionId: string) => {
      const res = await api.post<{ message: string }>(`/ai/actions/${actionId}/confirm`);
      return res.data;
    },
    onSuccess: (_data, actionId) => {
      setActionStates((prev) => ({ ...prev, [actionId]: 'confirmed' }));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (actionId: string) => {
      await api.post(`/ai/actions/${actionId}/reject`);
    },
    onSuccess: (_data, actionId) => {
      setActionStates((prev) => ({ ...prev, [actionId]: 'rejected' }));
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || chatMutation.isPending) return;
    setInput('');
    chatMutation.mutate(msg);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] min-h-[400px]">
      {/* Chat history */}
      <div className="flex-1 overflow-y-auto space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
        {turns.length === 0 && (
          <div className="text-center text-slate-400 mt-8">
            <p className="text-2xl mb-2">🤖</p>
            <p className="text-sm">Furama Copilot sẵn sàng hỗ trợ bạn.</p>
            <p className="text-xs mt-1 text-slate-300">Thử hỏi: "Hôm nay có task gì cần làm?" hoặc "Tổng quan dự án ra sao?"</p>
          </div>
        )}

        {turns.map((turn, idx) => (
          <div key={idx} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] space-y-2`}>
              <div
                className={`rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  turn.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-800'
                }`}
              >
                {turn.content}
              </div>

              {/* Proposed action cards */}
              {turn.actions?.map((action) => {
                const state = actionStates[action.actionId] ?? 'pending';
                return (
                  <div
                    key={action.actionId}
                    className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">
                        Đề xuất: {action.tool.replace(/_/g, ' ')}
                      </span>
                      {state !== 'pending' && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          state === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {state === 'confirmed' ? 'Đã thực hiện' : 'Đã hủy'}
                        </span>
                      )}
                    </div>
                    <pre className="text-xs text-slate-600 bg-white rounded p-2 overflow-auto max-h-32 mb-3">
                      {JSON.stringify(action.args, null, 2)}
                    </pre>
                    {state === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => confirmMutation.mutate(action.actionId)}
                          disabled={confirmMutation.isPending}
                          className="px-3 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          Xác nhận
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectMutation.mutate(action.actionId)}
                          disabled={rejectMutation.isPending}
                          className="px-3 py-1 text-xs rounded border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                        >
                          Hủy
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {chatMutation.isPending && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-400 animate-pulse">
              Đang xử lý…
            </div>
          </div>
        )}

        {chatMutation.isError && (
          <div className="flex justify-start">
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600">
              Lỗi: {(chatMutation.error as Error).message}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Nhập tin nhắn…"
          disabled={chatMutation.isPending}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!input.trim() || chatMutation.isPending}
          className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Gửi
        </button>
      </form>
    </div>
  );
}
