import ar from './ar.json';
import en from './en.json';
import { renderTemplate } from '../sms';

export type Locale = 'ar' | 'en';
export type I18nKey = keyof typeof en;
export const catalogs: Record<Locale, Record<string, string>> = { ar, en };
export const DEFAULT_LOCALE: Locale = 'ar';

export function t(locale: Locale, key: I18nKey | string, vars?: Record<string, string | number>): string {
  const s = catalogs[locale][key] ?? catalogs.en[key] ?? key;
  return vars ? renderTemplate(s, vars) : s;
}

export function dir(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
