import { describe, it, expect } from 'vitest';
import { paginationQuerySchema, moneyVndSchema, percentSchema } from './common';

describe('common schemas', () => {
  it('applies pagination defaults', () => {
    const parsed = paginationQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(25);
    expect(parsed.order).toBe('asc');
  });

  it('rejects unknown fields (strict)', () => {
    expect(() => paginationQuerySchema.parse({ nope: 1 })).toThrow();
  });

  it('rejects negative money and float percent', () => {
    expect(() => moneyVndSchema.parse(-1)).toThrow();
    expect(() => percentSchema.parse(50.5)).toThrow();
    expect(percentSchema.parse(100)).toBe(100);
  });
});
