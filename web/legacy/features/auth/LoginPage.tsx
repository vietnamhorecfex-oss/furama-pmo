import { useState } from 'react';
import { useLogin } from './useLogin';

/**
 * W-03 — Plain email/password form. The seed admin (`seed-admin@furama.test` / the env
 * password) is pre-filled for dev convenience; remove the defaults before any non-dev
 * deployment.
 */
export function LoginPage() {
  const login = useLogin();
  const [email, setEmail] = useState('seed-admin@furama.test');
  const [password, setPassword] = useState('correctHorseBatteryStaple');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };

  const errorMessage = login.isError
    ? ((login.error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ??
        'Login failed')
    : null;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Furama PMO</h1>
          <p className="text-sm text-slate-500">Sign in to your project workspace.</p>
        </div>
        <label className="block text-sm">
          <span className="text-slate-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        {errorMessage && (
          <p className="text-sm text-red-600">{errorMessage}</p>
        )}
        <button
          type="submit"
          disabled={login.isPending}
          className="w-full rounded-md bg-indigo-600 text-white py-2 font-medium hover:bg-indigo-700 disabled:opacity-60"
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
