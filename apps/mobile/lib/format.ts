import { formatDate, formatLocalPhone, formatMoney, formatTime12, type Locale } from '@hf/shared';

/** LOC-4..6 display helpers built on @hf/shared. Western digits (D6 default). */
export const money = (piastres: number | null | undefined, locale: Locale) => (piastres == null ? '—' : formatMoney(piastres, locale));
export const date = (iso: string | Date) => formatDate(typeof iso === 'string' ? new Date(iso) : iso);
export const time = (iso: string | Date, locale: Locale) => formatTime12(typeof iso === 'string' ? new Date(iso) : iso, locale);
export const dateTime = (iso: string, locale: Locale) => `${date(iso)} · ${time(iso, locale)}`;
export const phone = (e164: string) => formatLocalPhone(e164);

/** Date-only strings (YYYY-MM-DD) without timezone shifting. */
export const plainDate = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export const patientName = (p: { first_name_ar: string; father_name_ar?: string | null; family_name_ar?: string | null; name_en?: string | null }, locale: Locale) =>
  locale === 'en' && p.name_en ? p.name_en : [p.first_name_ar, p.father_name_ar, p.family_name_ar].filter(Boolean).join(' ');

/** Countdown as H:MM:SS (Western digits), for waiting-room timers. */
export const countdown = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
