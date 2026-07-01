'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoginResponse } from '@furama/shared';
import { useAuth } from '../../lib/auth-store';

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuth((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    if (!res.ok) { setError('Sai email hoặc mật khẩu'); return; }
    const data = (await res.json()) as LoginResponse;
    setSession(data.accessToken, data.user);
    router.push('/projects');
  }

  return (
    <div className="min-h-screen grid place-items-center">
      <form onSubmit={onSubmit} className="w-80 space-y-3 rounded-xl border border-slate-200 bg-white p-6">
        <h1 className="text-lg font-bold text-indigo-700">Furama PMO</h1>
        <input className="w-full rounded border px-2 py-1.5" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="relative">
          <input
            className="w-full rounded border px-2 py-1.5 pr-16"
            type={showPassword ? 'text' : 'password'}
            placeholder="Mật khẩu"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 px-2 text-xs font-medium text-indigo-600 hover:text-indigo-800"
            aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          >
            {showPassword ? 'Ẩn' : 'Hiện'}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded bg-indigo-600 py-1.5 text-white">Đăng nhập</button>
      </form>
    </div>
  );
}
