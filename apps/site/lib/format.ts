import { GOVERNORATES, formatDate, formatMoney, formatTime12 } from '@hf/shared';
import { has, tDyn, type Locale } from './i18n';
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
