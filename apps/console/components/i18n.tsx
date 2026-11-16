'use client';

import { createContext, useContext, useMemo } from 'react';
import type { Locale } from '@hf/shared';
import { ApiError } from '@/lib/api';
import { hasKey, translator, type T } from '@/lib/i18n';

interface I18nValue {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  t: T;
  /** Map an API error (code) to a catalogue message. */
  err: (e: unknown) => string;
}

const Ctx = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo<I18nValue>(() => {
    const t = translator(locale);
    const err = (e: unknown) => {
      if (e instanceof ApiError) {
        const code = e.code.split(':')[0] ?? e.code;
        if (hasKey(locale, `err.${code}`)) {
          if (code === 'not_found' && typeof e.details === 'string') return t('err.not_found');
          return t(`err.${code}`);
        }
        if (e.status === 403) return t('err.forbidden');
        if (e.status === 404) return t('err.not_found');
        if (e.status >= 500) return t('err.internal_error');
      }
      return t('common.error');
    };
    return { locale, dir: locale === 'ar' ? 'rtl' : 'ltr', t, err };
  }, [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}
