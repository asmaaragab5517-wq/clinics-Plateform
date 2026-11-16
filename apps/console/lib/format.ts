import { addDays, egpToPiastres, formatTime12, localDate, localTime, zonedToUtc, type Locale } from '@hf/shared';

/** Postgres bigint/numeric columns arrive as strings: coerce for display. */
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function patientName(p: { first_name_ar?: string | null; father_name_ar?: string | null; grandfather_name_ar?: string | null; family_name_ar?: string | null; name_en?: string | null } | null | undefined, locale: Locale = 'ar'): string {
  if (!p) return '';
  if (locale === 'en' && p.name_en) return p.name_en;
  return [p.first_name_ar, p.father_name_ar, p.grandfather_name_ar, p.family_name_ar].filter(Boolean).join(' ');
}

export function biName(o: { name_ar?: string | null; name_en?: string | null } | null | undefined, locale: Locale): string {
  if (!o) return '';
  return (locale === 'en' ? o.name_en || o.name_ar : o.name_ar || o.name_en) ?? '';
}

/** Parse an EGP amount typed by staff into integer piastres; null when invalid. */
export function parseEgp(input: string): number | null {
  const s = input.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.');
  if (!s) return null;
  try {
    const p = egpToPiastres(s);
    return p >= 0 ? p : null;
  } catch {
    return null;
  }
}

export function egpInput(piastres: number | null | undefined): string {
  if (piastres === null || piastres === undefined) return '';
  return (piastres / 100).toFixed(2);
}

export function todayCairo(): string {
  return localDate(new Date());
}

export function dayRange(date: string, days = 1): { from: string; to: string } {
  return { from: zonedToUtc(date, '00:00').toISOString(), to: zonedToUtc(addDays(date, days), '00:00').toISOString() };
}

export function time12(iso: string | Date, locale: Locale): string {
  return formatTime12(typeof iso === 'string' ? new Date(iso) : iso, locale);
}

export function cairoDate(iso: string | Date): string {
  return localDate(typeof iso === 'string' ? new Date(iso) : iso);
}

export function cairoTime(iso: string | Date): string {
  return localTime(typeof iso === 'string' ? new Date(iso) : iso);
}

export function ageFrom(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = todayCairo().split('-').map(Number) as [number, number, number];
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

export function isoDate(v: string | null | undefined): string {
  return v ? String(v).slice(0, 10) : '';
}

export function bmi(weightKg?: number | null, heightCm?: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  return Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}
