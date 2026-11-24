// Subpath imports: this module runs in client components, and the package index would bring zod with it.
import { addDays, formatDate, formatTime12, localDate } from '@hf/shared/datetime';
import { GOVERNORATES } from '@hf/shared/egypt/governorates';
import { formatMoney } from '@hf/shared/money';
import { has, t, tDyn, type Locale } from './i18n';
import type { Named, Num } from './types';

/** Bilingual record → display name; Arabic is the fallback (LOC-1). */
export function nameOf(locale: Locale, r: Named | null | undefined): string {
  if (!r) return '';
  return (locale === 'en' && r.name_en) || r.name_ar;
}

export function pick(locale: Locale, ar: string | null | undefined, en: string | null | undefined): string {
  return (locale === 'en' && en) || ar || en || '';
}

export function num(v: Num | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function governorateName(locale: Locale, slug: string | null | undefined): string {
  const g = GOVERNORATES.find((x) => x.slug === slug);
  return g ? g[locale] : slug ?? '';
}

export function money(piastres: number | null | undefined, locale: Locale): string {
  return piastres === null || piastres === undefined ? '' : formatMoney(piastres, locale);
}

export function dateTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  return `${formatDate(d)} ${formatTime12(d, locale)}`;
}

export function dateOnly(iso: string | null | undefined): string {
  return iso ? formatDate(new Date(iso)) : '';
}

/** Weekday + date label for a YYYY-MM-DD local date, e.g. "السبت 21/11". */
export function dayLabel(date: string, locale: Locale): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${tDyn(locale, `weekday.${wd}`)} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export function doctorTitle(locale: Locale, title: string | null | undefined): string {
  if (!title) return '';
  const k = `doctor.title.${title}`;
  return has(k) ? tDyn(locale, k) : '';
}

export function osmEmbed(lat: number, lng: number, zoom = 0.01): string {
  const bbox = [lng - zoom, lat - zoom, lng + zoom, lat + zoom].map((n) => n.toFixed(5)).join('%2C');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(5)}%2C${lng.toFixed(5)}`;
}

export function osmBboxEmbed(points: { lat: number; lng: number }[]): string | null {
  if (!points.length) return null;
  if (points.length === 1) return osmEmbed(points[0]!.lat, points[0]!.lng, 0.02);
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const pad = 0.05;
  const bbox = [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad].map((n) => n.toFixed(5)).join('%2C');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik`;
}

export function osmLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

/** Plain-text article bodies → paragraphs (no HTML is ever injected). */
export function paragraphs(body: string | null | undefined): string[] {
  return (body ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

/** List separator: Arabic comma in Arabic. */
export function listSep(locale: Locale): string {
  return locale === 'ar' ? '، ' : ', ';
}

/** Defensive defaults so a partial API payload never crashes a page. */
export function normDoctor<T extends { specialties?: unknown; clinics?: unknown }>(d: T): T {
  return { ...d, specialties: Array.isArray(d.specialties) ? d.specialties : [], clinics: Array.isArray(d.clinics) ? d.clinics : [] };
}

/** "Today 3:00 PM", "Tomorrow 9:30 AM" or "Tue 18/11 3:00 PM" in clinic time (FR-WEB-2 next available). */
export function nextAvailableText(iso: string, locale: Locale, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = localDate(d);
  const today = localDate(now);
  const time = formatTime12(d, locale);
  if (day === today) return t(locale, 'doctor.availableToday', { time });
  if (day === addDays(today, 1)) return t(locale, 'doctor.availableTomorrow', { time });
  return `${dayLabel(day, locale)} ${time}`;
}

/** Same-origin URL of a doctor's public photo, or null when the doctor has none (initial fallback). */
export function doctorPhotoSrc(d: { slug: string; photo_url?: string | null; photo_key?: string | null }): string | null {
  return d.photo_url || d.photo_key ? `/api/public/doctors/${encodeURIComponent(d.slug)}/photo` : null;
}

/** Cities of a governorate (LOC-7). Clinics store the Arabic city name, which is also the filter value. */
export function citiesOf(governorate: string | null | undefined): { ar: string; en: string }[] {
  return GOVERNORATES.find((g) => g.slug === governorate)?.cities ?? [];
}

/** Initial of a doctor's name without the "Dr." / "\u062F." prefix (photo fallback). */
export function initialOf(name: string): string {
  return name.replace(/^(\u062F\.|Dr\.?)\s*/u, '').trim().slice(0, 1);
}
