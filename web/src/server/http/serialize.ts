export type Paginated<T> = { data: T[]; page: number; pageSize: number; total: number };

/** Convert a DB money value (VND BigInt) to a JSON-safe number. Response.json throws on raw BigInt. */
export function moneyToNumber(v: bigint | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'bigint' ? Number(v) : v;
}
