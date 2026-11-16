import { describe, expect, it } from 'vitest';
import { computeBill, computeLine, divRoundHalfUp, egpToPiastres, formatMoney, computeCommission, countCash, summariseShift, billPaymentStatus } from '../src';

describe('money', () => {
  it('rounds half up', () => {
    expect(divRoundHalfUp(5, 10)).toBe(1);
    expect(divRoundHalfUp(4, 10)).toBe(0);
    expect(divRoundHalfUp(-5, 10)).toBe(-1);
  });
  it('parses EGP', () => {
    expect(egpToPiastres('1,250.5')).toBe(125050);
    expect(egpToPiastres(10)).toBe(1000);
  });
  it('formats (LOC-6)', () => {
    expect(formatMoney(125000, 'ar')).toBe('1,250.00 ج.م');
    expect(formatMoney(125000, 'en')).toBe('EGP 1,250.00');
    expect(formatMoney(125000, 'ar', { arabicDigits: true })).toBe('١٬٢٥٠٫٠٠ ج.م');
  });
});

describe('tax engine (FR-BIL-2)', () => {
  it('applies 14% VAT on taxable lines after discount, half-up per line', () => {
    const l = computeLine({ qty: 1, unitPrice: 33333, vat: 'taxable', discount: { type: 'percent', value: 10 } });
    // 33333 - 3333 (3333.3 → 3333) = 30000; VAT 4200
    expect(l).toEqual({ gross: 33333, discount: 3333, net: 30000, vat: 4200, total: 34200 });
  });
  it('sums mixed bills', () => {
    const t = computeBill([
      { qty: 1, unitPrice: 50000, vat: 'exempt' },
      { qty: 2, unitPrice: 10050, vat: 'taxable', discount: { type: 'amount', value: 100 } },
    ]);
    expect(t.subtotal).toBe(70100);
    expect(t.discount).toBe(100);
    expect(t.taxableBase).toBe(20000);
    expect(t.vat).toBe(2800);
    expect(t.total).toBe(72800);
  });
  it('rejects discounts beyond gross', () => {
    expect(() => computeLine({ qty: 1, unitPrice: 100, vat: 'zero', discount: { type: 'amount', value: 101 } })).toThrow();
  });
  it('derives payment status', () => {
    expect(billPaymentStatus(1000, 0, 0)).toBe('issued');
    expect(billPaymentStatus(1000, 400, 0)).toBe('partially_paid');
    expect(billPaymentStatus(1000, 1000, 0)).toBe('paid');
    expect(billPaymentStatus(1000, 1000, 1000)).toBe('refunded');
  });
});

describe('cash & commission', () => {
  it('counts denominations', () => {
    expect(countCash({ '20000': 2, '25': 4 })).toBe(40100);
    expect(() => countCash({ '300': 1 })).toThrow();
  });
  it('summarises shift variance', () => {
    const s = summariseShift({ openingFloat: 50000, cashIn: 100000, cashOut: 10000, counted: 139000, varianceThreshold: 500 });
    expect(s.expected).toBe(140000);
    expect(s.variance).toBe(-1000);
    expect(s.needsApproval).toBe(true);
  });
  it('computes tiered marginal commission', () => {
    const share = computeCommission({ kind: 'tiered', tiers: [{ upTo: 100000, percent: 40 }, { upTo: null, percent: 50 }] }, [{ net: 150000 }]);
    expect(share).toBe(40000 + 25000);
    expect(computeCommission({ kind: 'percent', percent: 33.33 }, [{ net: 10000 }])).toBe(3333);
    expect(computeCommission({ kind: 'fixed', amount: 5000 }, [{ net: 1 }, { net: 2 }])).toBe(10000);
  });
});
