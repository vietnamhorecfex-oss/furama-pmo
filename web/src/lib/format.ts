/** Format VND amounts. Compact ("250M", "1.2B") for charts; full for tooltips. */
export function formatVnd(n: number): string {
  if (n === 0) return '₫0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `₫${(n / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
  if (abs >= 1_000_000) return `₫${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `₫${(n / 1_000).toFixed(0)}k`;
  return `₫${n}`;
}
