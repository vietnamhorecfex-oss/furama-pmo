import { useEffect, useState } from 'react';

/**
 * S-10 — App shell. M0 placeholder: pings the API readiness endpoint to prove the
 * web ↔ api wiring works. Real routes/features land per TASK-BREAKDOWN (M4+).
 */
export function App() {
  const [api, setApi] = useState<'checking' | 'up' | 'down'>('checking');

  useEffect(() => {
    fetch('/health')
      .then((r) => setApi(r.ok ? 'up' : 'down'))
      .catch(() => setApi('down'));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center">
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-bold">Furama PMO</h1>
        <p className="text-slate-500">Restaurant Opening Project Management — scaffold (M0)</p>
        <p className="text-sm">
          API:{' '}
          <span
            className={
              api === 'up'
                ? 'text-green-600 font-semibold'
                : api === 'down'
                  ? 'text-red-600 font-semibold'
                  : 'text-slate-400'
            }
          >
            {api}
          </span>
        </p>
      </div>
    </div>
  );
}
