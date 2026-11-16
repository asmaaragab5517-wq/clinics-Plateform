import type { VatStatus } from './enums';
import { divRoundHalfUp, type Piastres } from './money';

export const VAT_RATE_BPS = 1400; // 14.00%

export interface BillLineInput {
  qty: number; // integer quantity
  unitPrice: Piastres;
  discount?: { type: 'amount'; value: Piastres } | { type: 'percent'; value: number }; // percent may have 2 decimals
  vat: VatStatus;
}

export interface BillLineTotals {
  gross: Piastres;
  discount: Piastres;
  net: Piastres;
  vat: Piastres;
  total: Piastres;
}

export interface BillTotals {
  subtotal: Piastres;
  discount: Piastres;
  taxableBase: Piastres;
  vat: Piastres;
  total: Piastres;
  lines: BillLineTotals[];
}

/** Compute one line (FR-BIL-2). Rounding is half-up at line level. */
export function computeLine(l: BillLineInput): BillLineTotals {
  if (!Number.isInteger(l.qty) || l.qty <= 0) throw new Error('qty must be a positive integer');
  if (!Number.isSafeInteger(l.unitPrice) || l.unitPrice < 0) throw new Error('unitPrice must be non-negative piastres');
  const gross = l.qty * l.unitPrice;
  let discount = 0;
  if (l.discount?.type === 'amount') discount = l.discount.value;
  else if (l.discount?.type === 'percent') {
    const bps = Math.round(l.discount.value * 100);
    if (bps < 0 || bps > 10000) throw new Error('discount percent must be 0..100');
    discount = divRoundHalfUp(gross * bps, 10000);
  }
  if (discount < 0 || discount > gross) throw new Error('discount out of range');
  const net = gross - discount;
  const vat = l.vat === 'taxable' ? divRoundHalfUp(net * VAT_RATE_BPS, 10000) : 0;
  return { gross, discount, net, vat, total: net + vat };
}

export function computeBill(lines: BillLineInput[]): BillTotals {
  const computed = lines.map(computeLine);
  const sum = (f: (l: BillLineTotals) => number) => computed.reduce((a, l) => a + f(l), 0);
  return {
    subtotal: sum((l) => l.gross),
    discount: sum((l) => l.discount),
    taxableBase: computed.reduce((a, l, i) => a + (lines[i]!.vat === 'taxable' ? l.net : 0), 0),
    vat: sum((l) => l.vat),
    total: sum((l) => l.total),
    lines: computed,
  };
}

/** Effective discount percent of a bill (for approval thresholds). */
export function discountPercent(t: Pick<BillTotals, 'subtotal' | 'discount'>): number {
  return t.subtotal === 0 ? 0 : (t.discount * 100) / t.subtotal;
}
