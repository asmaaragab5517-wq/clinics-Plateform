import { catalogs, type Locale } from '@hf/shared/i18n';
import appAr from '../i18n/ar.json';
import appEn from '../i18n/en.json';

/** App catalogue merged over the shared catalogue (LOC-1). Arabic is the default locale. */
const merged: Record<Locale, Record<string, string>> = {
  ar: { ...catalogs.ar, ...(appAr as Record<string, string>) },
  en: { ...catalogs.en, ...(appEn as Record<string, string>) },
};

export const LOCALE_COOKIE = 'hf_locale';
export const CLINIC_COOKIE = 'hf_clinic';

export type Vars = Record<string, string | number>;
export type T = (key: string, vars?: Vars) => string;

export function parseLocale(v: string | undefined | null): Locale {
  return v === 'en' ? 'en' : 'ar';
}

export function hasKey(locale: Locale, key: string): boolean {
  return key in merged[locale] || key in merged.en;
}

export function translate(locale: Locale, key: string, vars?: Vars): string {
  const s = merged[locale][key] ?? merged.en[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function translator(locale: Locale): T {
  return (key, vars) => translate(locale, key, vars);
}
