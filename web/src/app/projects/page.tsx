'use client';
import { useAuth } from '../../lib/auth-store';
export default function ProjectsPage() {
  const user = useAuth((s) => s.user);
  return <main className="p-6">Đăng nhập thành công: {user?.email ?? '(reload mất session — Phase 4 thêm silent refresh)'}</main>;
}
