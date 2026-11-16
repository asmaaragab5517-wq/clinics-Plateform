import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Alert, I18nManager } from 'react-native';
import { reloadAppAsync } from 'expo';
import * as Localization from 'expo-localization';
import { catalogs, type I18nKey, type Locale } from '@hf/shared';
import appAr from '../i18n/ar.json';
import appEn from '../i18n/en.json';
import { KEYS, getSecretSync, setSecret } from './storage';

/**
 * LOC-1: Arabic is the default. App strings (i18n/{ar,en}.json, identical key sets) are merged over the shared
 * catalogue (packages/shared/src/i18n), so shared keys (status.*, booking.*, emr.* …) are reused as-is.
 * LOC-2: RTL is applied with I18nManager.forceRTL, which only takes effect after a JS reload.
 */
export type AppKey = keyof typeof appEn;
export type TKey = AppKey | I18nKey;

const merged: Record<Locale, Record<string, string>> = {
  ar: { ...catalogs.ar, ...(appAr as Record<string, string>) },
  en: { ...catalogs.en, ...(appEn as Record<string, string>) },
};

export function translate(locale: Locale, key: TKey, vars?: Record<string, string | number>): string {
  const s = merged[locale][key] ?? merged.en[key] ?? key;
  return vars ? s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : '')) : s;
}

/** True when a key exists (used to map API error codes to messages). */
export const hasKey = (key: string): key is TKey => key in merged.en;

export function initialLocale(): Locale {
  const stored = getSecretSync(KEYS.locale);
  if (stored === 'ar' || stored === 'en') return stored;
  // Arabic unless the device's primary language is English.
  const first = Localization.getLocales()[0]?.languageCode;
  return first === 'en' ? 'en' : 'ar';
}

/** Align the native layout direction with the locale. Returns true when a reload is required. */
export function applyDirection(locale: Locale): boolean {
  const rtl = locale === 'ar';
  I18nManager.allowRTL(true);
  I18nManager.swapLeftAndRightInRTL(true);
  if (I18nManager.isRTL !== rtl) {
    I18nManager.forceRTL(rtl);
    return true;
  }
  return false;
}

interface I18nValue {
  locale: Locale;
  isRTL: boolean;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  /** Pick name_ar / name_en (falls back to Arabic, the canonical name). */
  pick: (o: { name_ar?: string | null; name_en?: string | null } | null | undefined) => string;
  setLocale: (l: Locale) => Promise<void>;
}

const Ctx = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLoc] = useState<Locale>(initialLocale);
  const t = useCallback((key: TKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
  const setLocale = useCallback(
    async (l: Locale) => {
      await setSecret(KEYS.locale, l);
      setLoc(l);
      if (applyDirection(l)) {
        Alert.alert(translate(l, 'settings.reloadTitle'), translate(l, 'settings.reloadBody'), [
          { text: translate(l, 'settings.reloadLater'), style: 'cancel' },
          { text: translate(l, 'settings.reloadNow'), onPress: () => void reloadAppAsync('locale') },
        ]);
      }
    },
    [],
  );
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      isRTL: locale === 'ar',
      t,
      pick: (o) => (o ? (locale === 'en' && o.name_en ? o.name_en : o.name_ar ?? o.name_en ?? '') : ''),
      setLocale,
    }),
    [locale, t, setLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
