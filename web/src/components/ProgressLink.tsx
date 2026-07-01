'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition, type MouseEvent, type ReactNode } from 'react';
import { Spinner } from './Spinner';

interface Props {
  href: string;
  children: ReactNode;
  className?: string;
  /** Extra className applied to the inline spinner shown while navigating. */
  spinnerClassName?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * A next/link that shows an inline spinner the instant it's clicked and keeps it
 * visible until the target route has committed. Uses useTransition so the pending
 * state is per-link — only the clicked link spins.
 *
 * Modifier clicks (⌘/ctrl/shift/middle) fall through to the browser's default
 * new-tab behaviour instead of an in-app navigation.
 */
export function ProgressLink({ href, children, className, spinnerClassName = 'h-3.5 w-3.5', onClick }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    startTransition(() => router.push(href));
  }

  return (
    <Link href={href} onClick={handleClick} className={className} aria-busy={isPending || undefined}>
      {children}
      {isPending && <Spinner className={`inline-block ml-1.5 align-[-0.15em] ${spinnerClassName}`} />}
    </Link>
  );
}
