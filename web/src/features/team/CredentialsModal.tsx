'use client';
/**
 * Shows the one-time initial password for a just-created user. The password is never
 * retrievable again, so the admin must copy it now and share it with the new user.
 */
import { useState } from 'react';
import type { CreateMemberUserResult } from '@furama/shared';
import { useI18n } from '../../lib/i18n';

interface Props {
  result: CreateMemberUserResult;
  onClose: () => void;
}

export function CredentialsModal({ result, onClose }: Props) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = `Email: ${result.user.email}\n${t.passwordLabel}: ${result.tempPassword}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* clipboard blocked — user can still read the values on screen */
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4">
        <h3 className="text-lg font-semibold text-slate-900">{t.userCreatedTitle}</h3>
        <p className="text-sm text-slate-600">{t.userCreatedHint}</p>

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Email</span>
            <span className="font-mono text-slate-900">{result.user.email}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">{t.passwordLabel}</span>
            <span className="font-mono font-semibold text-slate-900">{result.tempPassword}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={copy}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            {copied ? t.copied : t.copy}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-indigo-600 text-white text-sm px-4 py-1.5"
          >
            {t.done}
          </button>
        </div>
      </div>
    </div>
  );
}
