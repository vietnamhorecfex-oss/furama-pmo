import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata = { title: 'Furama PMO' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
