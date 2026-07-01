import { describe, it, expect } from 'vitest';
import { moneyToNumber } from './serialize';

describe('moneyToNumber', () => {
  it('converts bigint to number', () => { expect(moneyToNumber(1234567890n)).toBe(1234567890); });
  it('passes through number', () => { expect(moneyToNumber(42)).toBe(42); });
  it('maps null/undefined to 0', () => { expect(moneyToNumber(null)).toBe(0); expect(moneyToNumber(undefined)).toBe(0); });
});
