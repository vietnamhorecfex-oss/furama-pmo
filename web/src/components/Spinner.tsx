export function Spinner({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin text-indigo-600 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="grid place-items-center py-24 text-slate-400">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-8 w-8" />
        {label && <p className="text-sm">{label}</p>}
      </div>
    </div>
  );
}
