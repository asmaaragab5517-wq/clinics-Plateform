import type { Piastres } from './money';

/** EGP denominations in piastres (FR-BIL-6). */
export const DENOMINATIONS: Piastres[] = [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 25];

export function countCash(counts: Record<string, number>): Piastres {
  let total = 0;
  for (const [denom, n] of Object.entries(counts)) {
    const d = Number(denom);
    if (!DENOMINATIONS.includes(d)) throw new Error(`Unknown denomination ${denom}`);
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid count for ${denom}`);
    total += d * n;
  }
  return total;
}

export interface ShiftSummary {
  openingFloat: Piastres;
  cashIn: Piastres;
  cashOut: Piastres;
  expected: Piastres;
  counted: Piastres;
  variance: Piastres;
  needsApproval: boolean;
}

export function summariseShift(i: {
  openingFloat: Piastres;
  cashIn: Piastres;
  cashOut: Piastres;
  counted: Piastres;
  varianceThreshold: Piastres;
}): ShiftSummary {
  const expected = i.openingFloat + i.cashIn - i.cashOut;
  const variance = i.counted - expected;
  return { ...i, expected, variance, needsApproval: Math.abs(variance) > i.varianceThreshold };
}
