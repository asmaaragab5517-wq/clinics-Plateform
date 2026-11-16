import { toArabicIndicDigits } from './arabic';

/** All money is held as integer piastres (1 EGP = 100 piastres). */
export type Piastres = number;

export function assertPiastres(v: number): asserts v is Piastres {
  if (!Number.isSafeInteger(v)) throw new Error(`Money must be an integer number of piastres, got ${v}`);
}

/** Integer division rounding half away from zero. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new Error('denominator must be positive');
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  return sign * Math.floor((2 * n + denominator) / (2 * denominator));
}

export function egpToPiastres(egp: string | number): Piastres {
  const s = typeof egp === 'number' ? egp.toFixed(2) : egp.trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s.replace(/,/g, ''));
  if (!m) throw new Error(`Invalid EGP amount: ${egp}`);
  const v = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -v : v;
}

/** Format piastres for display (LOC-6): `1,250.00 ج.م` (ar) or `EGP 1,250.00` (en). */
export function formatMoney(p: Piastres, locale: 'ar' | 'en', opts: { arabicDigits?: boolean } = {}): string {
  const neg = p < 0;
  const abs = Math.abs(p);
  const pounds = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `${pounds}.${String(abs % 100).padStart(2, '0')}`;
  const signed = neg ? `-${body}` : body;
  if (locale === 'ar') {
    const digits = opts.arabicDigits ? toArabicIndicDigits(signed).replace(/,/g, '٬').replace('.', '٫') : signed;
    return `${digits} ج.م`;
  }
  return `EGP ${signed}`;
}
