import { catalogs, dir, type I18nKey, type Locale } from '@hf/shared/i18n';
import siteAr from '../i18n/ar.json';
import siteEn from '../i18n/en.json';

export type { Locale };
export const LOCALES = ['ar', 'en'] as const satisfies readonly Locale[];
export const DEFAULT_LOCALE: Locale = 'ar';

/** App catalogue merged over the shared one (LOC-1). Both files have identical key sets. */
export type Key = I18nKey | keyof typeof siteEn;
const messages: Record<Locale, Record<string, string>> = {
  ar: { ...catalogs.ar, ...siteAr },
  en: { ...catalogs.en, ...siteEn },
};

function render(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function isLocale(v: unknown): v is Locale {
  return v === 'ar' || v === 'en';
}

export function asLocale(v: unknown): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

/** Translate a known key. */
export function t(locale: Locale, key: Key, vars?: Record<string, string | number>): string {
  const s = messages[locale][key] ?? messages.en[key] ?? key;
  return vars ? render(s, vars) : s;
}

/** Translate a key built at runtime (e.g. `status.${s}`), falling back to `fallback` when missing. */
export function tDyn(locale: Locale, key: string, fallback?: string): string {
  return messages[locale][key] ?? messages.en[key] ?? fallback ?? key;
}

export function has(key: string): boolean {
  return key in messages.en;
}

export type T = (key: Key, vars?: Record<string, string | number>) => string;
export function getT(locale: Locale): T {
  return (key, vars) => t(locale, key, vars);
}

export { dir };
export const otherLocale = (l: Locale): Locale => (l === 'ar' ? 'en' : 'ar');
